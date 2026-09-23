import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, unlink } from "node:fs/promises";
import { dirname } from "node:path";

interface Owner { pid: number; token: string }

function isOwner(value: unknown): value is Owner {
  return typeof value === "object" && value !== null &&
    Number.isInteger((value as Owner).pid) && typeof (value as Owner).token === "string";
}

async function readOwner(path: string): Promise<Owner | null> {
  try {
    const owner: unknown = JSON.parse(await readFile(path, "utf8"));
    return isOwner(owner) ? owner : null;
  } catch { return null; }
}

function isAlive(pid: number): boolean {
  if (pid <= 0) return true;
  try { process.kill(pid, 0); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code !== "ESRCH"; }
}

/** Advisory across product Host processes; Pi CLI itself does not acquire this lock. */
export class PiSessionLease {
  private released = false;
  private constructor(private readonly path: string, private readonly owner: Owner) {}

  static async acquire(sessionFile: string): Promise<PiSessionLease> {
    const path = `${sessionFile}.pi-agent-ide.lock`;
    const recoveryPath = `${path}.recover`;
    await mkdir(dirname(path), { recursive: true });
    const owner = { pid: process.pid, token: randomUUID() };
    const create = async (): Promise<PiSessionLease> => {
      const handle = await open(path, "wx");
      try { await handle.writeFile(JSON.stringify(owner)); }
      catch (error) { await handle.close(); await unlink(path).catch(() => {}); throw error; }
      await handle.close();
      return new PiSessionLease(path, owner);
    };
    try { return await create(); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    // Never steal a live owner's session or replay any command. A dead owner may
    // leave a lock after a crash. The recovery claim serializes stale-lock removal.
    let recovery;
    try { recovery = await open(recoveryPath, "wx"); }
    catch { throw new Error(`Pi session is already owned or recovering: ${sessionFile}`); }
    try {
      const locked = await readOwner(path);
      if (!locked || isAlive(locked.pid)) throw new Error(`Pi session is already owned: ${sessionFile}`);
      // Under the recovery claim nobody else can perform stale reclamation.
      const stillLocked = await readOwner(path);
      if (stillLocked?.token !== locked.token || stillLocked.pid !== locked.pid) {
        throw new Error(`Pi session lease changed while recovering: ${sessionFile}`);
      }
      await unlink(path);
      return await create();
    } finally {
      await recovery.close();
      await unlink(recoveryPath).catch(() => {});
    }
  }

  async release(): Promise<void> {
    if (this.released) return;
    this.released = true;
    const current = await readOwner(this.path);
    if (current?.pid === this.owner.pid && current.token === this.owner.token) {
      await unlink(this.path).catch(error => {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      });
    }
  }
}
