import { open, realpath, stat } from "node:fs/promises";
import { isAbsolute } from "node:path";
import type { AttachmentRef } from "@zcode/shared/zcode-protocol-v4";

export interface PiPromptImage {
  type: "image";
  data: string;
  mimeType: string;
}

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

/** Materialize trusted desktop local-path image refs immediately before RPC delivery. */
export async function readPiPromptImages(attachments: readonly AttachmentRef[] = []): Promise<PiPromptImage[]> {
  return Promise.all(attachments.map(async attachment => {
    if (!attachment.mime.startsWith("image/")) {
      throw new Error(`Pi prompt attachment is not an image: ${attachment.fileName}`);
    }
    if (!["image/png", "image/jpeg", "image/gif", "image/webp"].includes(attachment.mime)) {
      throw new Error(`Pi prompt image format is unsupported: ${attachment.fileName}`);
    }
    if (!isAbsolute(attachment.ref)) {
      throw new Error(`Pi cannot read staged attachment ref: ${attachment.fileName}`);
    }
    const canonical = await realpath(attachment.ref);
    const before = await stat(canonical);
    if (!before.isFile()) throw new Error(`Pi prompt attachment is not a file: ${attachment.fileName}`);
    if (before.size > MAX_IMAGE_BYTES) throw new Error(`Pi prompt image exceeds 20 MiB: ${attachment.fileName}`);
    if (attachment.bytes > 0 && attachment.bytes !== before.size) {
      throw new Error(`Pi prompt attachment changed before send: ${attachment.fileName}`);
    }
    const handle = await open(canonical, "r");
    try {
      const data = await handle.readFile();
      const after = await handle.stat();
      if (after.size !== before.size || after.mtimeMs !== before.mtimeMs) {
        throw new Error(`Pi prompt attachment changed while reading: ${attachment.fileName}`);
      }
      return { type: "image" as const, data: data.toString("base64"), mimeType: attachment.mime };
    } finally {
      await handle.close();
    }
  }));
}
