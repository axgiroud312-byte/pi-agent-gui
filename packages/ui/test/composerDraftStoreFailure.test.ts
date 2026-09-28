import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import {
  clearV4ComposerDraft,
  clearV4ComposerWorkspaceDrafts,
  persistV4ComposerDraft,
  readDamagedV4ComposerDraftRecord,
  readV4ComposerDraft,
  seedPiForkComposerDraft,
} from "../src/v4/composer/composerDraftStore.js";

class FailingStorage implements Storage {
  private readonly data = new Map<string, string>();
  failAllWrites = false;
  failAggregateWrites = true;
  failFallbackRemove = false;
  get length() { return this.data.size; }
  clear() { this.data.clear(); }
  getItem(key: string) { return this.data.get(key) ?? null; }
  key(index: number) { return [...this.data.keys()][index] ?? null; }
  removeItem(key: string) {
    if (this.failAllWrites) throw new Error("storage denied");
    if (this.failFallbackRemove && key.startsWith("zcode-v4-composer-scope-drafts:v1:")) {
      throw new Error("fallback cleanup denied");
    }
    this.data.delete(key);
  }
  setItem(key: string, value: string) {
    if (this.failAllWrites || (this.failAggregateWrites && key.startsWith("zcode-v4-composer-drafts:v1:"))) {
      throw new Error("workspace draft file is full");
    }
    this.data.set(key, value);
  }
}

test("a one-sided workspace text write failure retains the matching image draft text", () => {
  const storage = new FailingStorage();
  Object.assign(globalThis, { window: { localStorage: storage } });
  const workspace = `C:\\fixture-${randomUUID()}`;
  assert.equal(persistV4ComposerDraft(workspace, undefined, "session-1", {
    text: "Do not lose this prompt", mode: "build",
  }), true);
  assert.equal(readV4ComposerDraft(workspace, undefined, "session-1")?.text,
    "Do not lose this prompt");
  assert.equal(clearV4ComposerDraft(workspace, undefined, "session-1"), true);
  assert.equal(readV4ComposerDraft(workspace, undefined, "session-1"), null);
});

test("complete text storage failure is reported to the composer caller", () => {
  const storage = new FailingStorage();
  storage.failAllWrites = true;
  Object.assign(globalThis, { window: { localStorage: storage } });
  assert.equal(persistV4ComposerDraft(`C:\\fixture-${randomUUID()}`, undefined, "session-1", {
    text: "Cannot safely persist this", mode: "build",
  }), false);
});

test("project removal clears its text scopes without touching a prefix lookalike project", () => {
  const storage = new FailingStorage();
  Object.assign(globalThis, { window: { localStorage: storage } });
  const workspace = `C:\\fixture-${randomUUID()}`;
  const other = `${workspace}-other`;
  for (const [path, scope] of [[workspace, "__draft__"], [workspace, "session-1"], [other, "session-1"]]) {
    assert.equal(persistV4ComposerDraft(path!, undefined, scope!, { text: `${path}:${scope}`, mode: "build" }), true);
  }
  assert.equal(clearV4ComposerWorkspaceDrafts(workspace, undefined), true);
  assert.equal(readV4ComposerDraft(workspace, undefined, "__draft__"), null);
  assert.equal(readV4ComposerDraft(workspace, undefined, "session-1"), null);
  assert.equal(readV4ComposerDraft(other, undefined, "session-1")?.text, `${other}:session-1`);
});

test("a stale fallback cannot resurrect text after primary recovery and send cleanup", () => {
  const storage = new FailingStorage();
  Object.assign(globalThis, { window: { localStorage: storage } });
  const workspace = `C:\\fixture-${randomUUID()}`;
  assert.equal(persistV4ComposerDraft(workspace, undefined, "session-1", { text: "old", mode: "build" }), true);
  storage.failAggregateWrites = false;
  storage.failFallbackRemove = true;
  assert.equal(persistV4ComposerDraft(workspace, undefined, "session-1", { text: "new", mode: "build" }), true);
  assert.equal(readV4ComposerDraft(workspace, undefined, "session-1")?.text, "new");
  assert.equal(persistV4ComposerDraft(workspace, undefined, "session-1", { text: "" }), true);
  assert.equal(readV4ComposerDraft(workspace, undefined, "session-1"), null);
});

test("Pi fork text is stored in the new session scope before navigation without replacing an existing draft", () => {
  const storage = new FailingStorage();
  Object.assign(globalThis, { window: { localStorage: storage } });
  const workspace = `C:\\fixture-${randomUUID()}`;
  assert.equal(seedPiForkComposerDraft(workspace, undefined, "child", "restored Pi text"), "stored");
  assert.equal(readV4ComposerDraft(workspace, undefined, "child")?.text, "restored Pi text");
  assert.equal(readV4ComposerDraft(workspace, undefined, "source"), null);
  assert.equal(seedPiForkComposerDraft(workspace, undefined, "child", "different text"), "conflict");
  assert.equal(readV4ComposerDraft(workspace, undefined, "child")?.text, "restored Pi text");
  storage.failAllWrites = true;
  assert.equal(seedPiForkComposerDraft(workspace, undefined, "another child", "retain me"), "failed");
});

test("a damaged workspace draft record cannot be replaced by a new session draft", () => {
  const storage = new FailingStorage();
  storage.failAggregateWrites = false;
  Object.assign(globalThis, { window: { localStorage: storage } });
  const workspace = `C:\\fixture-${randomUUID()}`;
  const key = `zcode-v4-composer-drafts:v1:${encodeURIComponent(workspace)}`;
  assert.equal(persistV4ComposerDraft(workspace, undefined, "session-A", {
    text: "A private unsent draft", mode: "build",
  }), true);
  assert.equal(persistV4ComposerDraft(workspace, undefined, "session-B", {
    text: "B private unsent draft", mode: "build",
  }), true);
  const damaged = `${storage.getItem(key)!.slice(0, -3)}`;
  storage.setItem(key, damaged);

  assert.equal(readV4ComposerDraft(workspace, undefined, "session-B"), null);
  assert.equal(persistV4ComposerDraft(workspace, undefined, "session-B", {
    text: "B newer text", mode: "build",
  }), false, "corrupt workspace data must not be treated as an empty file");
  assert.equal(storage.getItem(key), damaged, "preserve the exact original record for recovery");
  assert.equal(readDamagedV4ComposerDraftRecord(workspace), damaged,
    "the GUI export must receive the exact original record");
  const other = `${workspace}-other`;
  assert.equal(persistV4ComposerDraft(other, undefined, "session-A", {
    text: "other project's draft", mode: "build",
  }), true);
  assert.equal(readV4ComposerDraft(other, undefined, "session-A")?.text, "other project's draft");
});

test("one malformed scope cannot erase otherwise intact session drafts", () => {
  const storage = new FailingStorage();
  storage.failAggregateWrites = false;
  Object.assign(globalThis, { window: { localStorage: storage } });
  const workspace = `C:\\fixture-${randomUUID()}`;
  const key = `zcode-v4-composer-drafts:v1:${encodeURIComponent(workspace)}`;
  const damaged = JSON.stringify({ version: 1, scopes: {
    "session-A": { text: "A private unsent draft", updatedAt: 1 },
    "session-B": { missingText: "B private unsent draft", updatedAt: 2 },
  } });
  storage.setItem(key, damaged);

  assert.equal(clearV4ComposerDraft(workspace, undefined, "session-A"), false,
    "clearing one draft cannot discard the damaged record and another scope");
  assert.equal(storage.getItem(key), damaged);
  assert.equal(readDamagedV4ComposerDraftRecord(workspace), damaged);
});
