import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, realpath, rename, rmdir, stat, unlink, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import type { AttachmentRef } from "@zcode/shared/zcode-protocol-v4";
import type { PiQueueItemV1 } from "./pi-queue-compat.js";

const extensions: Record<string, string> = {
  "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp",
};

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
    const root = await realpath(this.directory);
    const target = await realpath(sessionDirectory);
    if (relative(root, target).toLowerCase() !== sessionId.toLowerCase()) {
      throw new Error("Pi queue media session directory escaped its catalog");
    }
    // Only files this store itself names may be removed. Unknown files or a
    // reparse point leave the deletion uncommitted for inspection.
    const ownedFile = /^[a-f0-9]{64}-\d+-[a-f0-9]{64}\.(?:png|jpg|gif|webp)(?:\.[a-f0-9-]{36}\.tmp)?$/iu;
    if (entries.some(entry => !entry.isFile() || !ownedFile.test(entry.name))) {
      throw new Error("Pi queue media directory contains an unknown file");
    }
    for (const entry of entries) await unlink(join(sessionDirectory, entry.name));
    await rmdir(sessionDirectory);
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
