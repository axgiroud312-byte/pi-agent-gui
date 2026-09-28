import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { readPiPromptImages } from "../src/pi-agent/pi-prompt-images.js";

test("local image attachments become exact Pi image blocks and reject stale metadata", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-images-"));
  const path = join(root, "图 像.png");
  const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3]);
  await writeFile(path, bytes);
  try {
    const [image] = await readPiPromptImages([{ ref: path, fileName: "图 像.png", mime: "image/png", bytes: bytes.length }]);
    assert.deepEqual(image, { type: "image", data: bytes.toString("base64"), mimeType: "image/png" });
    await assert.rejects(readPiPromptImages([{ ref: path, fileName: "stale.png", mime: "image/png", bytes: 999 }]), /changed before send/);
    await assert.rejects(readPiPromptImages([{ ref: path, fileName: "wrong.txt", mime: "text/plain", bytes: bytes.length }]), /not an image/);
    await assert.rejects(readPiPromptImages([{ ref: path, fileName: "vector.svg", mime: "image/svg+xml", bytes: bytes.length }]), /unsupported/);
    await assert.rejects(readPiPromptImages([{ ref: "relative.png", fileName: "relative.png", mime: "image/png", bytes: 0 }]), /staged attachment/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("aggregate image bytes must fit one bounded Pi JSONL prompt record", { timeout: 30_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-images-limit-"));
  const bytes = Buffer.alloc(13 * 1024 * 1024, 0x7f);
  const paths = [join(root, "first.png"), join(root, "second.png")];
  try {
    await Promise.all(paths.map(path => writeFile(path, bytes)));
    await assert.rejects(readPiPromptImages(paths.map(path => ({
      ref: path, fileName: path, mime: "image/png", bytes: bytes.length,
    }))), /aggregate.*JSONL/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
