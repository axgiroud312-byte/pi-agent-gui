import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { piFilePromptTitle, piFileSnapshotEpilogueStart, snapshotPiFileMentions } from "../src/pi-agent/pi-file-references.js";
import { PiMessageRows } from "../src/pi-agent/pi-message-rows.js";

test("file mention captures UTF-8 Chinese/space path and immutable send-time bytes", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "pi-file-ref-"));
  try {
    const path = join(workspace, "中文 空格.md");
    await writeFile(path, "最初内容\n", "utf8");
    const prompt = "检查 [中文 空格.md](<./中文 空格.md>)";
    const captured = await snapshotPiFileMentions(workspace, prompt);
    assert.equal(captured.images.length, 0);
    assert(captured.text.startsWith(prompt));
    assert.match(captured.text, /最初内容/);
    assert.match(captured.text, new RegExp(createHash("sha256").update("最初内容\n").digest("hex")));
    const row = new PiMessageRows().restore([{ role: "user", timestamp: 1,
      content: [{ type: "text", text: captured.text }] }]).find(item => item.kind === "userInput");
    assert(row?.kind === "userInput");
    assert.equal(row.epilogueStart, prompt.length);
    assert.equal((row as { epilogueKind?: string }).epilogueKind, "piFileSnapshots");
    assert.equal(piFilePromptTitle(captured.text), prompt,
      "Pi's complete first message must yield only the authored session title");
    assert.equal(piFileSnapshotEpilogueStart(`${prompt}\n\n---\nPi file snapshots captured at send time (image data is in this Pi message):\n{broken`), undefined,
      "damaged Pi history must remain visible in the user row");
    await writeFile(path, "后来内容\n", "utf8");
    assert.doesNotMatch(captured.text, /后来内容/);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("image file mention pins original image bytes and MIME for Pi", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "pi-image-ref-"));
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRhsAAAAASUVORK5CYII=", "base64");
  try {
    const path = join(workspace, "图 像.png");
    await writeFile(path, png);
    const captured = await snapshotPiFileMentions(workspace, "看 [图 像.png](<./图 像.png>)");
    assert.deepEqual(captured.images, [{ type: "image", data: png.toString("base64"), mimeType: "image/png" }]);
    assert.match(captured.text, /image\/png/);
    await writeFile(path, Buffer.from("changed"));
    assert.equal(captured.images[0]?.data, png.toString("base64"));
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("image reference budget extends beyond the small text limit", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "pi-large-image-ref-"));
  try {
    const image = Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), Buffer.alloc(300_000)]);
    await writeFile(join(workspace, "large.png"), image);
    const captured = await snapshotPiFileMentions(workspace, "[large.png](./large.png)");
    assert.equal(captured.images[0]?.data, image.toString("base64"));
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("directory mention captures a bounded listing, while web and arbitrary links stay untouched", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "pi-dir-ref-"));
  try {
    await mkdir(join(workspace, "资料"));
    await writeFile(join(workspace, "资料", "a.txt"), "A");
    const prompt = "目录 [资料](<./资料/>) 和 [网站](https://example.com) 与 [自定义](./资料/a.txt)";
    const captured = await snapshotPiFileMentions(workspace, prompt);
    assert.match(captured.text, /a\.txt/);
    assert.doesNotMatch(captured.text, /"content":"A"/);
    assert.equal(captured.images.length, 0);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("unsafe, missing, oversized and unsupported references fail before Pi admission", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "pi-unsafe-ref-"));
  const outside = await mkdtemp(join(tmpdir(), "pi-outside-ref-"));
  try {
    await writeFile(join(outside, "secret.txt"), "outside");
    await writeFile(join(workspace, "huge.txt"), "x".repeat(300_000));
    await writeFile(join(workspace, "binary.bin"), Buffer.from([0, 1, 2]));
    await assert.rejects(snapshotPiFileMentions(workspace, "[secret.txt](<../secret.txt>)"), /OUTSIDE_WORKSPACE/);
    await assert.rejects(snapshotPiFileMentions(workspace, "[missing.txt](<./missing.txt>)"), /FILE_NOT_FOUND/);
    await assert.rejects(snapshotPiFileMentions(workspace, "[huge.txt](<./huge.txt>)"), /FILE_TOO_LARGE/);
    await assert.rejects(snapshotPiFileMentions(workspace, "[binary.bin](<./binary.bin>)"), /UNSUPPORTED_FILE_REFERENCE/);
    assert.equal(await readFile(join(outside, "secret.txt"), "utf8"), "outside");
  } finally {
    await rm(workspace, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});
