import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { access } from "node:fs/promises";
import { test } from "node:test";
import { PiImageUploads } from "../src/pi-agent/pi-image-upload.js";

function input(sessionId: string) {
  const bytes = Buffer.from("image bytes owned by a workspace");
  return { bytes, uploadId: `upload-${randomUUID()}`, sessionId, fileName: "image.png", mime: "image/png",
    totalBytes: bytes.length, totalChunks: 1,
    checksum: `sha256:${createHash("sha256").update(bytes).digest("hex")}` };
}

test("closing one workspace releases only its image staging, including an in-flight commit", async () => {
  const uploads = new PiImageUploads();
  const first = input("session-a");
  const second = input("session-b");
  try {
    for (const [workspaceKey, item] of [["workspace-a", first], ["workspace-b", second]] as const) {
      uploads.begin(workspaceKey, item);
      uploads.chunk(workspaceKey, { uploadId: item.uploadId, sessionId: item.sessionId,
        chunkIndex: 0, dataBase64: item.bytes.toString("base64") });
    }
    const b = await uploads.commit("workspace-b", second);
    const committing = uploads.commit("workspace-a", first);
    await uploads.releaseWorkspace("workspace-a");
    const a = await Promise.allSettled([committing]);
    if (a[0]?.status === "fulfilled") await assert.rejects(access(a[0].value.ref), /ENOENT/u);
    await assert.rejects(uploads.commit("workspace-a", first), /owned/u);
    await access(b.ref);
    await uploads.releaseWorkspace("workspace-b");
    await assert.rejects(access(b.ref), /ENOENT/u);
  } finally { await uploads.dispose(); }
});
