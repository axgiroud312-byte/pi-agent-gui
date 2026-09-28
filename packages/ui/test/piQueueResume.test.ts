import assert from "node:assert/strict";
import { test } from "node:test";
import type { CommandAck, ConversationSnapshot } from "@zcode/shared/zcode-protocol-v4";
import { resumeUnchangedPiQueue, type PiQueueResumeScope } from "../src/v4/piQueueResume.js";

const queue = (ids: string[]) => ({ autoDrain: false,
  items: ids.map(queueItemId => ({ queueItemId, text: queueItemId })) }) as ConversationSnapshot["queue"];
const scope = (revision = 5, ids = ["image", "text"]): PiQueueResumeScope => ({
  sessionId: "session-a", generation: 1,
  snapshot: { sessionId: "session-a", revision, queue: queue(ids) },
});
const ack = (status: CommandAck["status"], revisionAtDecision: number,
  reasonCode?: string) => ({ commandId: "test", status, revisionAtDecision,
    ...(reasonCode ? { reasonCode } : {}) }) as CommandAck;

test("paused Pi queue retries a stale snapshot only after the same queue projection catches up", async () => {
  let current = scope();
  const bases: number[] = [];
  let waits = 0;
  const result = await resumeUnchangedPiQueue({
    targetSessionId: "session-a",
    getCurrent: () => current,
    dispatch: async revision => {
      bases.push(revision);
      return bases.length === 1 ? ack("stale", 6, "pi.queueSnapshotChanged") : ack("accepted", 7);
    },
    waitForUpdate: async () => { waits++; current = scope(6); },
  });
  assert.equal(result, "accepted");
  assert.deepEqual(bases, [5, 6]);
  assert.equal(waits, 1);
});

test("a changed Pi queue or session cannot receive a stale resume retry", async () => {
  for (const next of [
    { ...scope(6, ["text", "image"]) },
    { ...scope(6), snapshot: { sessionId: "session-a", revision: 6, queue: queue(["image", "new"]) } },
    { ...scope(6), snapshot: { sessionId: "session-a", revision: 6,
      queue: { ...queue(["image", "text"]), items: [
        { queueItemId: "image", text: "edited while waiting" },
        { queueItemId: "text", text: "text" },
      ] } as ConversationSnapshot["queue"] } },
    { ...scope(6), snapshot: { sessionId: "session-a", revision: 6,
      queue: { ...queue(["image", "text"]), autoDrain: true } } },
    { ...scope(6), sessionId: "session-b" },
    { ...scope(6), generation: 2 },
  ]) {
    let current = scope();
    const bases: number[] = [];
    const result = await resumeUnchangedPiQueue({
      targetSessionId: "session-a",
      getCurrent: () => current,
      dispatch: async revision => { bases.push(revision); current = next;
        return ack("stale", 6, "pi.queueSnapshotChanged"); },
      waitForUpdate: async () => {},
    });
    assert.equal(result, "changed");
    assert.deepEqual(bases, [5]);
  }
});

test("an old pane callback cannot resume another selected Pi session", async () => {
  let dispatched = 0;
  const result = await resumeUnchangedPiQueue({
    targetSessionId: "session-a",
    getCurrent: () => ({ ...scope(), sessionId: "session-b" }),
    dispatch: async () => { dispatched++; return ack("accepted", 6); },
  });
  assert.equal(result, "changed");
  assert.equal(dispatched, 0);
});

test("missing authoritative revision and Pi queue mutation do not trigger blind retries", async () => {
  let calls = 0;
  const unsynchronized = await resumeUnchangedPiQueue({
    targetSessionId: "session-a",
    getCurrent: () => scope(),
    dispatch: async () => { calls++; return ack("stale", 6, "pi.queueSnapshotChanged"); },
    waitForUpdate: async () => {},
  });
  assert.equal(unsynchronized, "changed");
  assert.equal(calls, 1);
  const piChanged = await resumeUnchangedPiQueue({
    targetSessionId: "session-a",
    getCurrent: () => scope(),
    dispatch: async () => { calls++; return ack("stale", 6, "pi.queueChanged"); },
  });
  assert.equal(piChanged, "failed");
  assert.equal(calls, 2);
});

test("persistent stale and failed Pi ACKs never become visible success", async () => {
  let current = scope();
  const bases: number[] = [];
  const staleResult = await resumeUnchangedPiQueue({
    targetSessionId: "session-a",
    getCurrent: () => current,
    dispatch: async revision => { bases.push(revision); current = scope(revision + 1);
      return ack("stale", revision + 1, "pi.queueSnapshotChanged"); },
    waitForUpdate: async () => {},
  });
  assert.equal(staleResult, "failed");
  assert.deepEqual(bases, [5, 6, 7]);
  for (const status of ["failed", "noop", "duplicate"] as const) {
    let calls = 0;
    const failedResult = await resumeUnchangedPiQueue({
      targetSessionId: "session-a",
      getCurrent: () => scope(),
      dispatch: async () => { calls++; return ack(status, 5, "pi.commandFailed"); },
    });
    assert.equal(failedResult, "failed");
    assert.equal(calls, 1);
  }
});
