import { createHash, randomUUID } from "node:crypto";
import { link, mkdir, open, readFile, unlink } from "node:fs/promises";
import { dirname } from "node:path";

interface Owner { pid: number; token: string }

function isOwner(value: unknown): value is Owner {
  return typeof value === "object" && value !== null &&
    Number.isSafeInteger((value as Owner).pid) && (value as Owner).pid > 0 &&
    typeof (value as Owner).token === "string" && (value as Owner).token.length > 0;
}

async function readOwner(path: string): Promise<Owner | null> {
  let contents: string;
  try { contents = await readFile(path, "utf8"); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  try {
    const owner: unknown = JSON.parse(contents);
    if (isOwner(owner)) return owner;
  } catch { /* An old process may still be writing this file. */ }
  throw new Error(`Pi session lease has an incomplete or ambiguous owner: ${path}`);
}

function isAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  // A recycled PID (or an inaccessible process) is treated as alive: this
  // sacrifices recovery, never exclusivity. Tokens distinguish lock generations.
  catch (error) { return (error as NodeJS.ErrnoException).code !== "ESRCH"; }
}

function isExists(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === "EEXIST";
}

// The file is complete before it becomes visible under its final name. Never
// publish an empty wx lock: a legacy empty lock cannot prove its writer died.
async function publish(path: string, owner: Owner, durable = false): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`;
  const handle = await open(temporary, "wx");
  try {
    try {
      await handle.writeFile(JSON.stringify(owner));
      if (durable) await handle.sync();
    } finally { await handle.close(); }
    await link(temporary, path); // Atomic create-if-absent, not rename/replace.
  } finally {
    await unlink(temporary).catch(() => {}); // An orphan temp is not a lease.
  }
}

async function refuseQuarantined(path: string): Promise<void> {
  // Check even when the main lock is missing: an orphan marker is not proof
  // that the old Pi/tool tree died. Only a verified owner may clear it.
  if (await readOwner(`${path}.runtime-uncertain`)) {
    throw new Error(`Pi session runtime is quarantined; verify the process tree and recover manually: ${path}`);
  }
}

function claimPath(path: string, generation: string): string {
  return `${path}.recover-${createHash("sha256").update(generation).digest("hex")}`;
}

/** Advisory across product Host processes; external Pi CLI does not acquire this lock. */
export class PiSessionLease {
  private released = false;
  private markPending?: Promise<void>;
  private releasePending?: Promise<void>;
  private constructor(private readonly path: string, private readonly owner: Owner) {}

  static async acquire(sessionFile: string): Promise<PiSessionLease> {
    const path = `${sessionFile}.pi-agent-ide.lock`;
    await mkdir(dirname(path), { recursive: true });
    await refuseQuarantined(path);
    const owner = { pid: process.pid, token: randomUUID() };
    const create = async (): Promise<PiSessionLease> => {
      await publish(path, owner);
      await refuseQuarantined(path);
      return new PiSessionLease(path, owner);
    };
    try { return await create(); }
    catch (error) { if (!isExists(error)) throw error; }

    await refuseQuarantined(path);
    const locked = await readOwner(path);
    if (!locked || isAlive(locked.pid)) throw new Error(`Pi session is already owned: ${sessionFile}`);

    // Old versions used a bare .recover file. We cannot safely reclaim one
    // without an owner (it may still be in its wx -> write gap). A valid live
    // legacy claimant must also finish before we attempt recovery.
    const legacy = await readOwner(`${path}.recover`);
    if (legacy && isAlive(legacy.pid)) {
      throw new Error(`Pi session is already owned or recovering: ${sessionFile}`);
    }

    // Each crashed claimant leaves an immutable, owner-bearing claim. The next
    // claim uses a NEW name derived from that claimant's token; no process can
    // unlink/recreate a claim pathname another contender has already observed.
    // Claims intentionally remain on disk: deleting one reintroduces an ABA race.
    let generation = locked.token;
    for (;;) {
      const recoveryPath = claimPath(path, generation);
      try {
        await publish(recoveryPath, owner);
        break;
      } catch (error) { if (!isExists(error)) throw error; }
      const claimant = await readOwner(recoveryPath);
      if (!claimant || isAlive(claimant.pid)) {
        throw new Error(`Pi session is already owned or recovering: ${sessionFile}`);
      }
      generation = `${locked.token}\0${claimant.token}`;
    }

    // The claim is ours until this process exits. A different owner generation
    // must never be unlinked (including after a direct create won the gap).
    await refuseQuarantined(path);
    const current = await readOwner(path);
    if (current?.pid !== locked.pid || current.token !== locked.token) {
      throw new Error(`Pi session lease changed while recovering: ${sessionFile}`);
    }
    await unlink(path);
    try { return await create(); }
    catch (error) {
      if (isExists(error)) throw new Error(`Pi session is already owned: ${sessionFile}`);
      throw error;
    }
  }

  /** Call and await BEFORE starting Pi or any process that may spawn tools. */
  markRuntimeUncertain(): Promise<void> {
    if (this.released || this.releasePending) return Promise.reject(new Error("Pi session lease is releasing or released"));
    if (this.markPending) return this.markPending;
    this.markPending = (async () => {
      const current = await readOwner(this.path);
      if (current?.pid !== this.owner.pid || current.token !== this.owner.token) {
        throw new Error("Pi session lease changed before runtime quarantine");
      }
      const markerPath = `${this.path}.runtime-uncertain`;
      let marker = await readOwner(markerPath);
      if (!marker) {
        try { await publish(markerPath, this.owner, true); }
        catch (error) { if (!isExists(error)) throw error; }
        marker = await readOwner(markerPath);
      }
      if (marker?.pid !== this.owner.pid || marker.token !== this.owner.token) {
        throw new Error("Pi session runtime quarantine belongs to another owner");
      }
    })().finally(() => { this.markPending = undefined; });
    return this.markPending;
  }

  // Small fault seams for the unlink/retry regressions.
  private async unlinkRuntimeMarker(): Promise<void> { await unlink(`${this.path}.runtime-uncertain`); }
  private async unlinkOwned(): Promise<void> { await unlink(this.path); }

  /** Caller MUST first verify its Pi and tool process tree is empty. */
  async release(): Promise<void> {
    if (this.released) return;
    if (this.releasePending) return this.releasePending;
    this.releasePending = (async () => {
      // A concurrent mark must finish before any lock can be released. A failed
      // mark leaves an uncertain result for the caller to inspect/retry.
      await this.markPending;
      const current = await readOwner(this.path);
      const marker = await readOwner(`${this.path}.runtime-uncertain`);
      if (marker && (marker.pid !== this.owner.pid || marker.token !== this.owner.token)) {
        throw new Error("Pi session runtime quarantine belongs to another owner");
      }
      if (marker && (current?.pid !== this.owner.pid || current.token !== this.owner.token)) {
        throw new Error("Pi session runtime quarantine has no matching owned lock");
      }
      if (current?.pid === this.owner.pid && current.token === this.owner.token) {
        // Once the caller has verified the tree is empty, this order is safe
        // even if the Host crashes between the two unlinks. On failure a retry
        // can finish; a different owner's marker/lock is never removed.
        if (marker) await this.unlinkRuntimeMarker();
        try { await this.unlinkOwned(); }
        catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
      }
      this.released = true;
    })().finally(() => { this.releasePending = undefined; });
    return this.releasePending;
  }
}
