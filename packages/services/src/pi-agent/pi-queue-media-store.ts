import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AttachmentRef } from "@zcode/shared/zcode-protocol-v4";
import type { PiQueueItemV1 } from "./pi-queue-compat.js";

const extensions: Record<string, string> = {
  "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp",
};

/** Durable readback copies of Pi-owned queued images for native edit/preview. */
export class PiQueueMediaStore {
  constructor(private readonly directory: string) {}

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
