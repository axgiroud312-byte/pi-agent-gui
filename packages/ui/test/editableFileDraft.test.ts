import assert from "node:assert/strict";
import { test } from "node:test";
import {
  clearEditableFileDraft,
  loadEditableFileDraft,
  saveEditableFileDraft,
} from "../src/lib/editableFileDraft.js";

function memoryStorage(): Pick<Storage, "getItem" | "setItem" | "removeItem"> {
  const entries = new Map<string, string>();
  return {
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => {
      entries.set(key, value);
    },
    removeItem: (key) => {
      entries.delete(key);
    },
  };
}

test("file editor draft survives reopen and stays scoped to its project", () => {
  const storage = memoryStorage();
  const target = { rootPath: "C:\\项目 一", path: "C:\\项目 一\\笔记.md" };
  saveEditableFileDraft(storage, target, { baseVersion: "disk-1", content: "本地草稿" });
  assert.deepEqual(loadEditableFileDraft(storage, target), {
    baseVersion: "disk-1",
    content: "本地草稿",
  });
  assert.equal(
    loadEditableFileDraft(storage, { rootPath: "C:\\项目 二", path: target.path }),
    null,
  );
  clearEditableFileDraft(storage, target);
  assert.equal(loadEditableFileDraft(storage, target), null);
});

test("corrupt file editor draft is explicit instead of silently discarded", () => {
  const storage = memoryStorage();
  const target = { rootPath: "/project", path: "/project/a.md" };
  saveEditableFileDraft(storage, target, { baseVersion: "disk-1", content: "draft" });
  const poisoned = {
    ...storage,
    getItem: () => "{broken",
  };
  assert.throws(() => loadEditableFileDraft(poisoned, target), /INVALID_FILE_DRAFT/);
});
