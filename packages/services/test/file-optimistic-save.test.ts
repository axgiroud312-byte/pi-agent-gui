import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createFileService } from "../src/file/fileService.js";

test("workspace text save preserves Unicode and rejects same-size external changes", async () => {
  const rootPath = await mkdtemp(join(tmpdir(), "pi-file-save-"));
  const path = join(rootPath, "中文 文件.md");
  const fileService = createFileService();
  try {
    await writeFile(path, "first\n", "utf8");
    const opened = await fileService.readEditableText({ rootPath, path });
    assert.equal(opened.content, "first\n");
    const saved = await fileService.saveEditableText({
      rootPath,
      path,
      expectedVersion: opened.version,
      content: "你好\n",
    });
    assert.equal(await readFile(path, "utf8"), "你好\n");
    assert.notEqual(saved.version, opened.version);
    await writeFile(path, "外部\n", "utf8");
    await assert.rejects(
      fileService.saveEditableText({
        rootPath,
        path,
        expectedVersion: saved.version,
        content: "内部\n",
      }),
      /FILE_CHANGED/,
    );
    assert.equal(await readFile(path, "utf8"), "外部\n");
  } finally {
    await rm(rootPath, { recursive: true, force: true });
  }
});

test("workspace text save rejects binary, oversized, and paths outside the project", async () => {
  const rootPath = await mkdtemp(join(tmpdir(), "pi-file-save-"));
  const outsidePath = await mkdtemp(join(tmpdir(), "pi-file-outside-"));
  const fileService = createFileService();
  try {
    const binaryPath = join(rootPath, "binary.dat");
    const largePath = join(rootPath, "large.txt");
    const unrelatedPath = join(outsidePath, "other.txt");
    await writeFile(binaryPath, Buffer.from([0, 1, 2]));
    await writeFile(largePath, Buffer.alloc(256 * 1024 + 1, 0x61));
    await writeFile(unrelatedPath, "untouched", "utf8");
    await assert.rejects(fileService.readEditableText({ rootPath, path: binaryPath }), /NOT_TEXT/);
    await assert.rejects(
      fileService.readEditableText({ rootPath, path: largePath }),
      /FILE_TOO_LARGE/,
    );
    await assert.rejects(
      fileService.readEditableText({ rootPath, path: unrelatedPath }),
      /OUTSIDE_WORKSPACE/,
    );
    assert.equal(await readFile(unrelatedPath, "utf8"), "untouched");
  } finally {
    await rm(rootPath, { recursive: true, force: true });
    await rm(outsidePath, { recursive: true, force: true });
  }
});
