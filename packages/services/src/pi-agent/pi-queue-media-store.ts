import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, mkdir, readFile, readdir, realpath, rename, rmdir, stat, unlink, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import type { AttachmentRef } from "@zcode/shared/zcode-protocol-v4";
import type { PiQueueItemV1 } from "./pi-queue-compat.js";

const extensions: Record<string, string> = {
  "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp",
};
const ownedFile = /^[a-f0-9]{64}-\d+-[a-f0-9]{64}\.(?:png|jpg|gif|webp)(?:\.[a-f0-9-]{36}\.tmp)?$/iu;

async function historyMentionedFiles(historyFile: string, names: readonly string[]): Promise<Set<string>> {
  const mentioned = new Set<string>();
  if (names.length === 0) return mentioned;
  const longest = names.reduce((length, name) => Math.max(length, name.length), 0);
  let overlap = "";
  // A Pi JSONL can be large; scan bounded chunks before removing any cache byte.
  // Hexadecimal basenames appear unchanged even when their containing path is JSON-escaped.
  for await (const chunk of createReadStream(historyFile)) {
    const text = overlap + (chunk as Buffer).toString("utf8");
    for (const name of names) if (text.includes(name)) mentioned.add(name);
    overlap = text.slice(1 - longest);
  }
  return mentioned;
}

/** Durable readback copies of Pi-owned queued images for native edit/preview. */
export class PiQueueMediaStore {
  constructor(private readonly directory: string) {}

  /** A confirmed cold-session deletion must also remove its private image readback. */
  async removeSession(sessionId: string): Promise<void> {
    if (!/^[a-f0-9-]{36}$/iu.test(sessionId)) throw new Error("Invalid Pi session ID");
    const sessionDirectory = join(this.directory, sessionId);
    let entries;
    try { entries = await readdir(sessionDirectory, { withFileTypes: true }); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    if (!(await lstat(this.directory)).isDirectory() || !(await lstat(sessionDirectory)).isDirectory()) {
      throw new Error("Pi queue media directory is a reparse point");
    }
    const root = await realpath(this.directory);
    const target = await realpath(sessionDirectory);
    if (relative(root, target).toLowerCase() !== sessionId.toLowerCase()) {
      throw new Error("Pi queue media session directory escaped its catalog");
    }
    // Only files this store itself names may be removed. Unknown files or a
    // reparse point leave the deletion uncommitted for inspection.
    if (entries.some(entry => !entry.isFile() || !ownedFile.test(entry.name))) {
      throw new Error("Pi queue media directory contains an unknown file");
    }
    for (const entry of entries) await unlink(join(sessionDirectory, entry.name));
    await rmdir(sessionDirectory);
  }

  /** Reclaim only finished copies that no durable Pi/session consumer can still name. */
  async pruneUnreferenced(sessionId: string, retained: readonly AttachmentRef[], historyFile: string,
    stillUnreferenced?: () => Promise<boolean>): Promise<number> {
    if (!/^[a-f0-9-]{36}$/iu.test(sessionId)) throw new Error("Invalid Pi session ID");
    const sessionDirectory = join(this.directory, sessionId);
    let entries;
    try { entries = await readdir(sessionDirectory, { withFileTypes: true }); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0;
      throw error;
    }
    if (!(await lstat(this.directory)).isDirectory() || !(await lstat(sessionDirectory)).isDirectory()) {
      throw new Error("Pi queue media directory is a reparse point");
    }
    const root = await realpath(this.directory);
    const target = await realpath(sessionDirectory);
    if (relative(root, target).toLowerCase() !== sessionId.toLowerCase()) {
      throw new Error("Pi queue media session directory escaped its catalog");
    }
    if (entries.some(entry => !entry.isFile() || !ownedFile.test(entry.name))) {
      throw new Error("Pi queue media directory contains an unknown file");
    }
    const retainedPaths = new Set(retained.map(item => resolve(item.ref).toLowerCase()));
    // A .tmp may belong to a concurrent materialize; full session deletion
    // can remove it only after the Pi session has been closed.
    const candidates = entries.filter(entry => !entry.name.endsWith(".tmp") &&
      !retainedPaths.has(resolve(sessionDirectory, entry.name).toLowerCase()));
    const historyBefore = await stat(historyFile);
    if (!historyBefore.isFile()) throw new Error("Pi history is not a regular file");
    const mentioned = await historyMentionedFiles(historyFile, candidates.map(entry => entry.name));
    const historyAfter = await stat(historyFile);
    if (historyBefore.size !== historyAfter.size || historyBefore.mtimeMs !== historyAfter.mtimeMs ||
      historyBefore.ctimeMs !== historyAfter.ctimeMs || !historyAfter.isFile()) return 0;
    if (stillUnreferenced && !await stillUnreferenced()) return 0;
    let removed = 0;
    for (const entry of candidates) {
      if (mentioned.has(entry.name)) continue;
      if (stillUnreferenced && !await stillUnreferenced()) return removed;
      // A concurrent writer or an unexpected replacement must not turn a
      // proven regular file into a deletion through a reparse point.
      if (!(await lstat(sessionDirectory)).isDirectory() ||
        relative(root, await realpath(sessionDirectory)).toLowerCase() !== sessionId.toLowerCase() ||
        !(await lstat(join(sessionDirectory, entry.name))).isFile()) {
        throw new Error("Pi queue media changed during cleanup");
      }
      try { await unlink(join(sessionDirectory, entry.name)); removed++; }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    }
    return removed;
  }

  private path(sessionId: string, queueItemId: string, index: number, mime: string, dataHash: string): string {
    if (!/^[a-f0-9-]{36}$/iu.test(sessionId) || !Number.isSafeInteger(index) || index < 0 || !extensions[mime]) {
      throw new Error("Invalid Pi queued image identity");
    }
    const identity = createHash("sha256").update(queueItemId).digest("hex");
    return join(this.directory, sessionId, `${identity}-${index}-${dataHash}.${extensions[mime]}`);
  }

  async materialize(sessionId: string, item: PiQueueItemV1): Promise<AttachmentRef[]> {
    const refs: AttachmentRef[] = [];
    for (const [index, image] of item.images.entries()) {
      const data = Buffer.from(image.data, "base64");
      if (data.length > 20 * 1024 * 1024) throw new Error("Pi queued image exceeds 20 MiB");
      const dataHash = createHash("sha256").update(data).digest("hex");
      const path = this.path(sessionId, item.id, index, image.mimeType, dataHash);
      await mkdir(join(this.directory, sessionId), { recursive: true });
      let valid = false;
      try {
        if ((await stat(path)).size === data.length) {
          const existing = await readFile(path);
          valid = existing.equals(data);
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      if (!valid) {
        const temp = `${path}.${randomUUID()}.tmp`;
        try {
          await writeFile(temp, data, { flag: "wx", mode: 0o600 });
          await rename(temp, path);
        } finally { await unlink(temp).catch(() => {}); }
      }
      refs.push({ ref: path, fileName: `queued-image-${index + 1}.${extensions[image.mimeType]}`,
        mime: image.mimeType, bytes: data.length });
    }
    return refs;
  }
}
