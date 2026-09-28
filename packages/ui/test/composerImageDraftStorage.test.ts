import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { test } from "node:test";
import {
  beginComposerImageDraftPromotion,
  finishComposerImageDraftPromotion,
  forgetComposerImageDraftScope,
  forgetComposerImageDrafts,
  markFailedComposerImageDraftPromotion,
  forgetComposerWorkspaceImageDrafts,
  moveComposerImageDrafts,
  readComposerImageDrafts,
  saveComposerImageDraft,
} from "../src/v4/composer/composerImageDraftStorage.js";
import { persistV4ComposerDraft, readV4ComposerDraft } from "../src/v4/composer/composerDraftStore.js";
import { cleanupConfirmedPiSessionDraft } from "../src/v4/composer/composerSessionCleanup.js";
import { restorePiForkComposerDraft } from "../src/v4/composer/piForkComposerRestore.js";

class MemoryStorage implements Storage {
  private readonly entries = new Map<string, string>();
  get length() { return this.entries.size; }
  clear() { this.entries.clear(); }
  getItem(key: string) { return this.entries.get(key) ?? null; }
  key(index: number) { return [...this.entries.keys()][index] ?? null; }
  removeItem(key: string) { this.entries.delete(key); }
  setItem(key: string, value: string) { this.entries.set(key, value); }
}

function installMemoryIndexedDb(): Map<string, unknown> {
  const rows = new Map<string, unknown>();
  const names = new Set<string>();
  const database = {
    objectStoreNames: { contains: (name: string) => names.has(name) },
    createObjectStore(name: string) { names.add(name); },
    transaction(_name: string, _mode: string) {
      const before = new Map(rows);
      let pending = 0;
      let completed = false;
      let aborted = false;
      const tx: Record<string, unknown> = {
        oncomplete: null, onerror: null, onabort: null,
        abort() {
          if (aborted || completed) return;
          aborted = true;
          rows.clear();
          for (const [key, value] of before) rows.set(key, value);
          queueMicrotask(() => (tx.onabort as (() => void) | null)?.());
        },
      };
      const check = () => {
        if (!pending && !completed && !aborted) {
          completed = true;
          (tx.oncomplete as (() => void) | null)?.();
        }
      };
      const schedule = (run: () => void) => {
        pending += 1;
        queueMicrotask(() => {
          if (!aborted) run();
          pending -= 1;
          queueMicrotask(check);
        });
      };
      const store = {
        put(value: { id: string }) { schedule(() => rows.set(value.id, value)); },
        delete(id: string) { schedule(() => rows.delete(id)); },
        get(id: string) {
          const request: Record<string, unknown> = { result: undefined, onsuccess: null };
          schedule(() => {
            request.result = rows.get(id);
            (request.onsuccess as (() => void) | null)?.();
          });
          return request;
        },
        openCursor() {
          const request: Record<string, unknown> = { result: null, onsuccess: null };
          const keys = [...rows.keys()];
          let index = 0;
          const next = () => schedule(() => {
            const key = keys[index++];
            request.result = key === undefined ? null : {
              key,
              value: rows.get(key),
              continue: next,
              delete: () => schedule(() => rows.delete(key)),
              update: (value: unknown) => schedule(() => rows.set(key, value)),
            };
            (request.onsuccess as (() => void) | null)?.();
          });
          next();
          return request;
        },
      };
      tx.objectStore = () => store;
      return tx;
    },
  };
  const factory = {
    open(_name: string, _version: number) {
      const request: Record<string, unknown> = {
        result: database, error: null, onupgradeneeded: null, onsuccess: null, onerror: null, onblocked: null,
      };
      queueMicrotask(() => {
        if (!names.size) (request.onupgradeneeded as (() => void) | null)?.();
        (request.onsuccess as (() => void) | null)?.();
      });
      return request;
    },
  };
  Object.assign(globalThis, { window: { localStorage: new MemoryStorage() }, indexedDB: factory });
  return rows;
}

const rows = installMemoryIndexedDb();

test("damaged text draft record does not erase saved image bytes or another workspace", async () => {
  rows.clear();
  window.localStorage.clear();
  const workspace = `C:\\fixture-${randomUUID()}`;
  const scopeKey = `${workspace}\0session-A`;
  const imageId = randomUUID();
  await saveComposerImageDraft(scopeKey, { id: imageId, fileName: "unsent.png", mimeType: "image/png",
    file: new File([new Uint8Array([1, 2, 3, 4])], "unsent.png", { type: "image/png" }) });
  const textKey = `zcode-v4-composer-drafts:v1:${encodeURIComponent(workspace)}`;
  window.localStorage.setItem(textKey, '{"version":1,"scopes":');

  assert.equal(persistV4ComposerDraft(workspace, undefined, "session-A", { text: "new text" }), false);
  assert.equal(window.localStorage.getItem(textKey), '{"version":1,"scopes":');
  const restored = await readComposerImageDrafts(scopeKey);
  assert.deepEqual(restored.map(item => item.id), [imageId]);
  assert.equal("error" in restored[0]!, false);
  const other = `${workspace}-other`;
  assert.equal(persistV4ComposerDraft(other, undefined, "session-A", { text: "other" }), true);
  assert.equal(readV4ComposerDraft(other, undefined, "session-A")?.text, "other");
});

test("profile-wide image count is bounded without silently evicting any project", async () => {
  rows.clear();
  window.localStorage.clear();
  const prefix = randomUUID();
  for (let index = 0; index < 64; index++) {
    await saveComposerImageDraft(`${prefix}:project-${index}\0__draft__`, {
      id: `${prefix}-image-${index}`, fileName: `${index}.png`, mimeType: "image/png",
      file: new File([new Uint8Array([index])], `${index}.png`, { type: "image/png" }),
    });
  }
  await assert.rejects(saveComposerImageDraft(`${prefix}:overflow\0__draft__`, {
    id: `${prefix}-overflow`, fileName: "overflow.png", mimeType: "image/png",
    file: new File([new Uint8Array([65])], "overflow.png", { type: "image/png" }),
  }), /profile.*limit|global.*limit|capacity/i);
  assert.equal((await readComposerImageDrafts(`${prefix}:project-0\0__draft__`)).length, 1);
});

test("deleting one session and then a project reclaims only their image bytes", async () => {
  rows.clear();
  window.localStorage.clear();
  const project = `C:\\fixture-${randomUUID()}`;
  const other = `${project}-other`;
  const scopes = [
    { scope: `${project}\0session-a`, id: "session-a" },
    { scope: `${project}\0__draft__`, id: "draft" },
    { scope: `${other}\0session-a`, id: "other" },
  ];
  for (const item of scopes) {
    await saveComposerImageDraft(item.scope, { id: item.id, fileName: `${item.id}.png`, mimeType: "image/png",
      file: new File([new Uint8Array([1, 2, 3])], `${item.id}.png`, { type: "image/png" }) });
  }
  await forgetComposerImageDraftScope(scopes[0]!.scope);
  assert.deepEqual(await readComposerImageDrafts(scopes[0]!.scope), []);
  assert.equal(rows.has(scopes[0]!.id), false);
  assert.equal((await readComposerImageDrafts(scopes[1]!.scope)).length, 1);
  await forgetComposerWorkspaceImageDrafts(project);
  assert.deepEqual(await readComposerImageDrafts(scopes[1]!.scope), []);
  assert.equal(rows.has(scopes[1]!.id), false);
  assert.equal((await readComposerImageDrafts(scopes[2]!.scope)).length, 1,
    "a project whose path only shares a prefix must retain its draft");
  assert.equal(rows.has(scopes[2]!.id), true);
});

test("profile image byte budget is enforced independently of the image count", async () => {
  rows.clear();
  window.localStorage.clear();
  const prefix = randomUUID();
  // The fake store preserves Blob identity; the large size models real image
  // metadata without allocating hundreds of MiB in this contract test.
  const large = new File([new Uint8Array([1])], "large.png", { type: "image/png" });
  Object.defineProperty(large, "size", { value: 20 * 1024 * 1024 });
  for (let index = 0; index < 12; index++) {
    await saveComposerImageDraft(`${prefix}-${index}\0__draft__`, {
      id: `${prefix}-${index}`, fileName: "large.png", mimeType: "image/png", file: large,
    });
  }
  await assert.rejects(saveComposerImageDraft(`${prefix}-overflow\0__draft__`, {
    id: `${prefix}-overflow`, fileName: "large.png", mimeType: "image/png", file: large,
  }), /capacity|limit/i);
  assert.equal(rows.size, 12);
});

test("first-send promotion moves only retained image IDs to the new session", async () => {
  rows.clear();
  window.localStorage.clear();
  const project = `C:\\fixture-${randomUUID()}`;
  const source = `${project}\0__draft__`;
  const target = `${project}\0session-created`;
  for (const id of ["submitted", "added-during-ack"]) {
    await saveComposerImageDraft(source, { id, fileName: `${id}.png`, mimeType: "image/png",
      file: new File([new Uint8Array([1])], `${id}.png`, { type: "image/png" }) });
  }
  // The accepted submission clears its frozen ID before the remaining draft moves.
  await forgetComposerImageDrafts(source, ["submitted"]);
  await moveComposerImageDrafts(source, target, ["added-during-ack"]);
  assert.deepEqual(await readComposerImageDrafts(source), []);
  const restored = await readComposerImageDrafts(target);
  assert.deepEqual(restored.map(item => item.id), ["added-during-ack"]);
  assert.equal("error" in restored[0]!, false);
  assert.equal(rows.has("submitted"), false);
});

test("new session hydration waits for accepted-send draft promotion", async () => {
  rows.clear();
  window.localStorage.clear();
  const source = `${randomUUID()}\0__draft__`;
  const target = source.replace("__draft__", "session-created");
  await saveComposerImageDraft(source, { id: "new-after-send", fileName: "new.png", mimeType: "image/png",
    file: new File([new Uint8Array([9])], "new.png", { type: "image/png" }) });
  beginComposerImageDraftPromotion(source, target);
  let settled = false;
  const hydration = readComposerImageDrafts(target).then(value => { settled = true; return value; });
  await Promise.resolve();
  assert.equal(settled, false);
  await moveComposerImageDrafts(source, target, ["new-after-send"]);
  finishComposerImageDraftPromotion(source);
  assert.deepEqual((await hydration).map(item => item.id), ["new-after-send"]);
});

test("removing a failed target chip cannot delete still-owned source bytes", async () => {
  rows.clear();
  window.localStorage.clear();
  const source = `${randomUUID()}\0__draft__`;
  const target = source.replace("__draft__", "session-created");
  await saveComposerImageDraft(source, { id: "source-owned", fileName: "source.png", mimeType: "image/png",
    file: new File([new Uint8Array([7])], "source.png", { type: "image/png" }) });
  markFailedComposerImageDraftPromotion(target, ["source-owned"]);
  assert.equal("error" in (await readComposerImageDrafts(target))[0]!, true);
  await forgetComposerImageDrafts(target, ["source-owned"]);
  assert.equal("error" in (await readComposerImageDrafts(source))[0]!, false);
  assert.equal(rows.has("source-owned"), true);
});

test("Pi fork copies exact historical image bytes into the child IndexedDB scope", async () => {
  rows.clear();
  window.localStorage.clear();
  const workspacePath = `C:\\fixture-${randomUUID()}`;
  const original = Uint8Array.from([137, 80, 78, 71, 1, 2, 3, 4]);
  const image = { ref: "pi-entry-image:abc12345:1", fileName: "image-2.png", mimeType: "image/png" as const,
    bytes: original.length, sha256: createHash("sha256").update(original).digest("hex") };
  await restorePiForkComposerDraft({ workspacePath, sourceSessionId: "parent", childSessionId: "child",
    restoredText: "original image turn", images: [image], readImage: async request => {
      assert.deepEqual(request, { sessionId: "parent", ref: image.ref, mediaType: image.mimeType });
      return { bytes: original, mediaType: image.mimeType };
    } });
  assert.equal(readV4ComposerDraft(workspacePath, undefined, "child")?.text, "original image turn");
  assert.equal(readV4ComposerDraft(workspacePath, undefined, "parent"), null);
  const restored = await readComposerImageDrafts(`${workspacePath}\0child`);
  assert.equal(restored.length, 1);
  assert.equal("error" in restored[0]!, false);
  if ("error" in restored[0]!) throw new Error(restored[0]!.error);
  assert.deepEqual(new Uint8Array(await restored[0]!.file.arrayBuffer()), original);
});

test("Pi image-only fork leaves an unsent image draft without inventing text", async () => {
  rows.clear();
  window.localStorage.clear();
  const workspacePath = `C:\\fixture-${randomUUID()}`;
  const bytes = Uint8Array.from([137, 80, 78, 71, 7, 8]);
  const image = { ref: "pi-entry-image:abc12345:0", fileName: "image-1.png", mimeType: "image/png" as const,
    bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
  await restorePiForkComposerDraft({ workspacePath, sourceSessionId: "parent", childSessionId: "child",
    restoredText: "", images: [image], readImage: async () => ({ bytes, mediaType: "image/png" }) });
  assert.equal(readV4ComposerDraft(workspacePath, undefined, "child"), null);
  const restored = await readComposerImageDrafts(`${workspacePath}\0child`);
  assert.equal(restored.length, 1);
  assert.equal("error" in restored[0]!, false);
  if ("error" in restored[0]!) throw new Error(restored[0]!.error);
  assert.deepEqual(new Uint8Array(await restored[0]!.file.arrayBuffer()), bytes);
});

test("Pi fork image mismatch leaves a blocking child chip and intact source scope", async () => {
  rows.clear();
  window.localStorage.clear();
  const workspacePath = `C:\\fixture-${randomUUID()}`;
  const original = Uint8Array.from([1, 2, 3]);
  const image = { ref: "pi-entry-image:abc12345:1", fileName: "image-2.png", mimeType: "image/png" as const,
    bytes: original.length, sha256: createHash("sha256").update(original).digest("hex") };
  await assert.rejects(restorePiForkComposerDraft({ workspacePath, sourceSessionId: "parent",
    childSessionId: "child", restoredText: "do not send without image", images: [image],
    readImage: async () => ({ bytes: Uint8Array.from([3, 2, 1]), mediaType: image.mimeType }),
  }), /differs from.*JSONL/);
  assert.equal(readV4ComposerDraft(workspacePath, undefined, "child")?.text,
    "do not send without image");
  const restored = await readComposerImageDrafts(`${workspacePath}\0child`);
  assert.equal(restored.length, 1);
  assert.equal("error" in restored[0]!, true,
    "an interrupted or mismatched copy must block a text-only submission after restart");
  assert.equal(readV4ComposerDraft(workspacePath, undefined, "parent"), null);
});

test("confirmed cold Pi child deletion clears only that child's persisted image and text", async () => {
  rows.clear();
  window.localStorage.clear();
  const workspacePath = `C:\\fixture-${randomUUID()}`;
  for (const sessionId of ["child", "other"]) {
    assert.equal(persistV4ComposerDraft(workspacePath, undefined, sessionId, {
      text: `${sessionId} unsent text`,
    }), true);
    await saveComposerImageDraft(`${workspacePath}\0${sessionId}`, { id: sessionId,
      fileName: `${sessionId}.png`, mimeType: "image/png",
      file: new File([Uint8Array.from([1, 2, 3])], `${sessionId}.png`, { type: "image/png" }) });
  }
  assert.equal((await readComposerImageDrafts(`${workspacePath}\0child`)).length, 1);
  const errors = await cleanupConfirmedPiSessionDraft(workspacePath, undefined, "child");
  assert.deepEqual(errors, []);
  assert.deepEqual(await readComposerImageDrafts(`${workspacePath}\0child`), []);
  assert.equal(readV4ComposerDraft(workspacePath, undefined, "child"), null);
  assert.equal(rows.has("child"), false);
  assert.equal((await readComposerImageDrafts(`${workspacePath}\0other`)).length, 1);
  assert.equal(readV4ComposerDraft(workspacePath, undefined, "other")?.text, "other unsent text");
  assert.equal(rows.has("other"), true);
});
