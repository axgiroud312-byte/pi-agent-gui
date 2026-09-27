import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { test } from "node:test";
import { PiQueueMediaStore } from "../src/pi-agent/pi-queue-media-store.js";

const sessionId = "2dc46960-e831-4074-83d2-e8cf5464913f";
const otherSessionId = "54a3dd9b-a501-4eba-b36f-84600483f99e";

function imageItem(id: string, bytes: Uint8Array) {
  return { id, text: id, images: [{ mimeType: "image/png", data: Buffer.from(bytes).toString("base64") }] };
}

test("queue media GC removes only orphaned store images, retaining queue, recovery, history and other sessions", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-queue-media-gc-"));
  try {
    const store = new PiQueueMediaStore(join(root, "queue-media"));
    const [orphan] = await store.materialize(sessionId, imageItem("deleted-item", Uint8Array.from([1, 2, 3])));
    const [queued] = await store.materialize(sessionId, imageItem("pi-still-queued", Uint8Array.from([4, 5, 6])));
    const [recovery] = await store.materialize(sessionId, imageItem("recovery-copy", Uint8Array.from([7, 8, 9])));
    const [historical] = await store.materialize(sessionId, imageItem("history-ref", Uint8Array.from([10, 11, 12])));
    const [other] = await store.materialize(otherSessionId, imageItem("other-session", Uint8Array.from([13])));
    const historyFile = join(root, "session.jsonl");
    await writeFile(historyFile, JSON.stringify({ text: historical!.ref }));

    assert.equal(await store.pruneUnreferenced(sessionId, [queued!, recovery!], historyFile), 1);
    await assert.rejects(readFile(orphan!.ref), { code: "ENOENT" });
    for (const [ref, bytes] of [[queued!, [4, 5, 6]], [recovery!, [7, 8, 9]],
      [historical!, [10, 11, 12]], [other!, [13]]] as const) {
      assert.deepEqual([...await readFile(ref.ref)], bytes);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("queue media GC fails closed on an unreadable history or unknown directory entry", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-queue-media-gc-"));
  try {
    const store = new PiQueueMediaStore(join(root, "queue-media"));
    const [orphan] = await store.materialize(sessionId, imageItem("deleted-item", Uint8Array.from([21])));
    const historyFile = join(root, "session.jsonl");
    await assert.rejects(store.pruneUnreferenced(sessionId, [], historyFile), { code: "ENOENT" });
    assert.deepEqual([...await readFile(orphan!.ref)], [21]);
    await writeFile(historyFile, "");
    await writeFile(join(root, "queue-media", sessionId, "unknown.private"), "protected");
    await assert.rejects(store.pruneUnreferenced(sessionId, [], historyFile), /unknown file/i);
    assert.deepEqual([...await readFile(orphan!.ref)], [21]);
    assert.deepEqual((await readdir(join(root, "queue-media", sessionId))).sort(),
      [basename(orphan!.ref), "unknown.private"].sort());
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("queue media GC recognizes a history reference across stream chunks and retains in-flight temp files", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-queue-media-gc-"));
  try {
    const store = new PiQueueMediaStore(join(root, "queue-media"));
    const [historical] = await store.materialize(sessionId, imageItem("history-ref", Uint8Array.from([31])));
    const [orphan] = await store.materialize(sessionId, imageItem("orphan", Uint8Array.from([32])));
    const temporary = `${orphan!.ref}.e21bcb99-04ea-4771-9efa-4252c89082a7.tmp`;
    await writeFile(temporary, "write in progress");
    const historyFile = join(root, "session.jsonl");
    await writeFile(historyFile, "x".repeat(65520) + basename(historical!.ref));

    assert.equal(await store.pruneUnreferenced(sessionId, [], historyFile), 1);
    assert.deepEqual([...await readFile(historical!.ref)], [31]);
    await assert.rejects(readFile(orphan!.ref), { code: "ENOENT" });
    assert.equal((await readFile(temporary, "utf8")), "write in progress");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("queue media cleanup refuses a session directory reparse point", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-queue-media-gc-"));
  try {
    const store = new PiQueueMediaStore(join(root, "queue-media"));
    const [other] = await store.materialize(otherSessionId, imageItem("other-session", Uint8Array.from([41])));
    await symlink(join(root, "queue-media", otherSessionId),
      join(root, "queue-media", sessionId), process.platform === "win32" ? "junction" : "dir");
    const historyFile = join(root, "session.jsonl");
    await writeFile(historyFile, "");
    await assert.rejects(store.pruneUnreferenced(sessionId, [], historyFile), /reparse point/i);
    await assert.rejects(store.removeSession(sessionId), /reparse point/i);
    assert.deepEqual([...await readFile(other!.ref)], [41]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("queue media GC cancels deletion if Pi changes while history is checked", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-queue-media-gc-"));
  try {
    const store = new PiQueueMediaStore(join(root, "queue-media"));
    const [ref] = await store.materialize(sessionId, imageItem("race", Uint8Array.from([51])));
    const historyFile = join(root, "session.jsonl");
    await writeFile(historyFile, "");
    let validated = false;
    assert.equal(await store.pruneUnreferenced(sessionId, [], historyFile, async () => {
      validated = true;
      return false;
    }), 0);
    assert.equal(validated, true);
    assert.deepEqual([...await readFile(ref!.ref)], [51]);
  } finally { await rm(root, { recursive: true, force: true }); }
});
