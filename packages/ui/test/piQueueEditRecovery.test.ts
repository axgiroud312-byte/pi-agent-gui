import assert from "node:assert/strict";
import { test } from "node:test";
import { v4AttachmentReadParamsSchema } from "@zcode/shared/zcode-protocol-v4";
import { decidePiQueueEditRestore, preparePiQueueEditRecovery,
  readPiQueueEditRecoveries, restorePiQueueEditRecoveryRefs,
  discardPiQueueEditRecovery, forgetPiQueueEditRecoveriesForSession,
  retryPendingPiQueueRecoveryPurges, settlePiQueueEditDelete,
  shouldDiscardPiQueueRecoveryAfterSend, markPiSessionRecoveryDeletionIntent,
  retryPendingPiQueueRecoveryDeletions } from "../src/v4/piQueueEditRecovery.js";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

test("queue media reads require a Pi item, exact ref and image index", () => {
  const params = { sessionId: "pi-session", ref: "opaque-queue-ref", queueItemId: "pi-item",
    attachmentIndex: 0, offset: 0, limit: 1024 };
  assert.equal(v4AttachmentReadParamsSchema.parse(params).queueItemId, "pi-item");
  assert.equal(v4AttachmentReadParamsSchema.safeParse({ ...params, attachmentIndex: undefined }).success, false);
  assert.equal(v4AttachmentReadParamsSchema.safeParse({ ...params, target: {
    rowId: "row", entityId: "entity" },
  }).success, false);
});

test("queue edit recovery keeps original image bytes and text before Pi deletion", async () => {
  const storage = new MemoryStorage();
  const image = Uint8Array.from([1, 2, 3, 4, 5]);
  const saved: Array<{ scope: string; id: string; bytes: Uint8Array }> = [];
  const target = { queueItemId: "queue-one", inputKind: "sendText" as const,
    text: "reorder me", attachments: [{ ref: "opaque-ref", fileName: "one.png",
      mime: "image/png", bytes: image.length }] };
  const prepared = await preparePiQueueEditRecovery({ storage, workspaceKey: "workspace-a",
    sessionId: "session-a", target,
    readImage: async (_attachment, index) => {
      assert.equal(index, 0);
      return { bytes: image, mediaType: "image/png" };
    },
    saveImage: async (scope, id, file) => saved.push({ scope, id,
      bytes: new Uint8Array(await file.arrayBuffer()) }),
  });
  assert.equal(prepared.text, target.text);
  assert.deepEqual(saved.map(item => [...item.bytes]), [[1, 2, 3, 4, 5]]);
  assert.deepEqual(readPiQueueEditRecoveries(storage, "workspace-a", "session-a"), [prepared]);
  assert.deepEqual(readPiQueueEditRecoveries(storage, "workspace-b", "session-a"), []);
});

test("a failed durable image write prevents queue deletion admission", async () => {
  const storage = new MemoryStorage();
  let deletes = 0;
  const edit = async () => {
    await preparePiQueueEditRecovery({ storage, workspaceKey: "workspace-a", sessionId: "session-a",
      target: { queueItemId: "queue-one", inputKind: "sendText", text: "text",
        attachments: [{ ref: "opaque-ref", fileName: "one.png", mime: "image/png", bytes: 1 }] },
      readImage: async () => ({ bytes: Uint8Array.from([1]), mediaType: "image/png" }),
      saveImage: async () => { throw new Error("IndexedDB unavailable"); },
    });
    deletes += 1;
  };
  await assert.rejects(edit(), /IndexedDB unavailable/);
  assert.equal(deletes, 0);
  assert.deepEqual(readPiQueueEditRecoveries(storage, "workspace-a", "session-a"), []);
});

test("late ACK never overwrites another session or a newly entered draft", () => {
  const requested = { sessionId: "session-a", workspaceKey: "workspace-a" };
  assert.equal(decidePiQueueEditRestore("accepted", requested,
    { sessionId: "session-b", workspaceKey: "workspace-a" }, false), "backup-only");
  assert.equal(decidePiQueueEditRestore("accepted", requested, requested, true), "backup-only");
  assert.equal(decidePiQueueEditRestore("accepted", requested, requested, false), "restore");
  assert.equal(decidePiQueueEditRestore("stale", requested, requested, false), "queue-retained");
});

test("restart recovery reuploads exact saved image bytes and keeps copy until explicit discard", async () => {
  const storage = new MemoryStorage();
  const bytes = Uint8Array.from([1, 2, 3, 4, 5]);
  const files = new Map<string, File>();
  const entry = await preparePiQueueEditRecovery({ storage, workspaceKey: "workspace-a",
    sessionId: "session-a", target: { queueItemId: "queue-one", inputKind: "sendText", text: "recover",
      attachments: [{ ref: "old-queue-ref", fileName: "one.png", mime: "image/png", bytes: bytes.length }] },
    readImage: async () => ({ bytes, mediaType: "image/png" }),
    saveImage: async (_scope, id, file) => { files.set(id, file); },
  });
  const recovered = readPiQueueEditRecoveries(storage, "workspace-a", "session-a")[0]!;
  const uploads: Array<{ sessionId: string; bytes: number[] }> = [];
  const refs = await restorePiQueueEditRecoveryRefs({ entry: recovered, workspaceKey: "workspace-a",
    readFiles: async () => recovered.attachments.map(attachment => ({ id: attachment.draftId,
      fileName: attachment.fileName, mimeType: attachment.mime, file: files.get(attachment.draftId)! })),
    upload: async input => {
      uploads.push({ sessionId: input.sessionId, bytes: [...new Uint8Array(await input.file.arrayBuffer())] });
      return { ref: "new-session-ref" };
    },
  });
  assert.deepEqual(uploads, [{ sessionId: "session-a", bytes: [...bytes] }]);
  assert.equal(refs[0]?.ref, "new-session-ref");
  assert.deepEqual(readPiQueueEditRecoveries(storage, "workspace-a", "session-a"), [entry]);
  await discardPiQueueEditRecovery({ storage, workspaceKey: "workspace-a", sessionId: "session-a",
    queueItemId: "queue-one", forgetImages: async () => {} });
  assert.deepEqual(readPiQueueEditRecoveries(storage, "workspace-a", "session-a"), []);
});

test("damaged recovered image blocks restore and leaves durable copy visible", async () => {
  const storage = new MemoryStorage();
  const entry = await preparePiQueueEditRecovery({ storage, workspaceKey: "workspace-a",
    sessionId: "session-a", target: { queueItemId: "queue-one", inputKind: "sendText", text: "recover",
      attachments: [{ ref: "old-queue-ref", fileName: "one.png", mime: "image/png", bytes: 2 }] },
    readImage: async () => ({ bytes: Uint8Array.from([1, 2]), mediaType: "image/png" }),
    saveImage: async () => {},
  });
  let uploads = 0;
  await assert.rejects(restorePiQueueEditRecoveryRefs({ entry, workspaceKey: "workspace-a",
    readFiles: async () => [{ id: entry.attachments[0]!.draftId, fileName: "one.png",
      mimeType: "image/png", file: new File([Uint8Array.from([1])], "one.png", { type: "image/png" }) }],
    upload: async () => { uploads += 1; return { ref: "bad" }; },
  }), /changed|damaged/);
  assert.equal(uploads, 0);
  assert.deepEqual(readPiQueueEditRecoveries(storage, "workspace-a", "session-a"), [entry]);
});

test("same-size image tampering and an older index without SHA fail closed", async () => {
  const storage = new MemoryStorage();
  const entry = await preparePiQueueEditRecovery({ storage, workspaceKey: "workspace-a",
    sessionId: "session-a", target: { queueItemId: "queue-one", inputKind: "sendText", text: "recover",
      attachments: [{ ref: "old-ref", fileName: "one.png", mime: "image/png", bytes: 2 }] },
    readImage: async () => ({ bytes: Uint8Array.from([1, 2]), mediaType: "image/png" }),
    saveImage: async () => {},
  });
  let uploads = 0;
  await assert.rejects(restorePiQueueEditRecoveryRefs({ entry, workspaceKey: "workspace-a",
    readFiles: async () => [{ id: entry.attachments[0]!.draftId, fileName: "one.png",
      mimeType: "image/png", file: new File([Uint8Array.from([3, 4])], "one.png", { type: "image/png" }) }],
    upload: async () => { uploads += 1; return { ref: "bad" }; },
  }), /SHA|changed|damaged/);
  assert.equal(uploads, 0);
  const key = storage.key(0)!;
  const old = JSON.parse(storage.getItem(key)!) as { attachments: Array<{ sha256?: string }> };
  delete old.attachments[0]!.sha256;
  storage.setItem(key, JSON.stringify(old));
  assert.throws(() => readPiQueueEditRecoveries(storage, "workspace-a", "session-a"), /damaged/);
});

test("parallel withdrawals of different Pi items retain both independent recovery copies", async () => {
  const storage = new MemoryStorage();
  const releases: Array<() => void> = [];
  let bothReady!: () => void;
  const ready = new Promise<void>(resolve => { bothReady = resolve; });
  const saveImage = async () => new Promise<void>(resolve => {
    releases.push(resolve);
    if (releases.length === 2) bothReady();
  });
  const prepare = (queueItemId: string) => preparePiQueueEditRecovery({ storage,
    workspaceKey: "workspace-a", sessionId: "session-a",
    target: { queueItemId, inputKind: "sendText", text: queueItemId,
      attachments: [{ ref: `${queueItemId}-ref`, fileName: "one.png", mime: "image/png", bytes: 1 }] },
    readImage: async () => ({ bytes: Uint8Array.from([1]), mediaType: "image/png" }),
    saveImage,
  });
  const first = prepare("first");
  const second = prepare("second");
  await ready;
  assert.equal(releases.length, 2);
  releases.forEach(release => release());
  await Promise.all([first, second]);
  assert.deepEqual(readPiQueueEditRecoveries(storage, "workspace-a", "session-a")
    .map(entry => entry.queueItemId).sort(), ["first", "second"]);
});

test("confirmed Pi session deletion purges only its copies and retries failed private-byte cleanup", async () => {
  const storage = new MemoryStorage();
  const prepare = (workspaceKey: string, sessionId: string, queueItemId: string) =>
    preparePiQueueEditRecovery({ storage, workspaceKey, sessionId,
      target: { queueItemId, inputKind: "sendText", text: queueItemId, attachments: [] },
      readImage: async () => { throw new Error("unexpected"); },
    });
  await prepare("workspace-a", "session-a", "first");
  await prepare("workspace-a", "session-b", "second");
  let first = true;
  const forgetImages = async () => { if (first) { first = false; throw new Error("IDB locked"); } };
  await assert.rejects(forgetPiQueueEditRecoveriesForSession({ storage,
    workspaceKey: "workspace-a", sessionId: "session-a", forgetImages }), /IDB locked/);
  assert.equal(readPiQueueEditRecoveries(storage, "workspace-a", "session-a").length, 1);
  await retryPendingPiQueueRecoveryPurges({ storage, forgetImages });
  assert.deepEqual(readPiQueueEditRecoveries(storage, "workspace-a", "session-a"), []);
  assert.equal(readPiQueueEditRecoveries(storage, "workspace-a", "session-b").length, 1);
});

test("explicit delete rejection retires prepared copy and allows safe retry; uncertain ACK retains it", async () => {
  const storage = new MemoryStorage();
  const target = { queueItemId: "first", inputKind: "sendText" as const, text: "original",
    attachments: [] };
  const prepare = () => preparePiQueueEditRecovery({ storage, workspaceKey: "workspace-a",
    sessionId: "session-a", target, readImage: async () => { throw new Error("unexpected"); } });
  await prepare();
  assert.equal(readPiQueueEditRecoveries(storage, "workspace-a", "session-a")[0]?.state, "prepared");
  // A missing/failed ACK intentionally does not settle the backup.
  assert.equal(readPiQueueEditRecoveries(storage, "workspace-a", "session-a").length, 1);
  await settlePiQueueEditDelete({ storage, workspaceKey: "workspace-a", sessionId: "session-a",
    queueItemId: "first", status: "rejected", forgetImages: async () => {} });
  assert.deepEqual(readPiQueueEditRecoveries(storage, "workspace-a", "session-a"), []);
  await prepare();
  await settlePiQueueEditDelete({ storage, workspaceKey: "workspace-a", sessionId: "session-a",
    queueItemId: "first", status: "accepted", forgetImages: async () => {} });
  assert.equal(readPiQueueEditRecoveries(storage, "workspace-a", "session-a")[0]?.state, "withdrawn");
});

test("only an accepted send of the exact restored text and image refs can retire its backup", () => {
  const saved = { sessionId: "session-a", text: "exact text",
    refs: [{ ref: "fresh-ref", fileName: "one.png", mime: "image/png", bytes: 1 }] };
  assert.equal(shouldDiscardPiQueueRecoveryAfterSend(saved, { sessionId: "session-a", text: "exact text",
    attachments: saved.refs, result: "sent" }), true);
  assert.equal(shouldDiscardPiQueueRecoveryAfterSend(saved, { sessionId: "session-a", text: "edited",
    attachments: saved.refs, result: "sent" }), false);
  assert.equal(shouldDiscardPiQueueRecoveryAfterSend(saved, { sessionId: "session-b", text: "exact text",
    attachments: saved.refs, result: "sent" }), false);
  assert.equal(shouldDiscardPiQueueRecoveryAfterSend(saved, { sessionId: "session-a", text: "exact text",
    attachments: [], result: "sent" }), false);
  assert.equal(shouldDiscardPiQueueRecoveryAfterSend(saved, { sessionId: "session-a", text: "exact text",
    attachments: saved.refs, result: "blocked" }), false);
});

test("session delete intent resolves crash before cleanup without deleting a surviving Pi session", async () => {
  const storage = new MemoryStorage();
  await preparePiQueueEditRecovery({ storage, workspaceKey: "workspace-a", sessionId: "session-a",
    target: { queueItemId: "first", inputKind: "sendText", text: "unsent", attachments: [] },
    readImage: async () => { throw new Error("unexpected"); },
  });
  const target = { workspaceKey: "workspace-a", workspacePath: "C:/workspace-a",
    sessionId: "session-a" };
  markPiSessionRecoveryDeletionIntent(storage, target);
  await retryPendingPiQueueRecoveryDeletions({ storage,
    sessionExists: async () => true, forgetImages: async () => {} });
  assert.equal(readPiQueueEditRecoveries(storage, "workspace-a", "session-a").length, 1,
    "a failed Pi JSONL delete must preserve the only unsent backup");
  await retryPendingPiQueueRecoveryDeletions({ storage,
    sessionExists: async () => false, forgetImages: async () => {} });
  assert.deepEqual(readPiQueueEditRecoveries(storage, "workspace-a", "session-a"), [],
    "a confirmed missing Pi JSONL retires its private backup after restart");
});
