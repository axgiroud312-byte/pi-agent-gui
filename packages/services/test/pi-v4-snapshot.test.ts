import assert from "node:assert/strict";
import { test } from "node:test";
import { conversationSnapshotSchema } from "@zcode/shared/zcode-protocol-v4";
import { createPiV4Snapshot } from "../src/pi-agent/pi-v4-snapshot.js";
import type { PiSessionView } from "../src/pi-agent/pi-session-supervisor.js";

const view: PiSessionView = {
  sessionId: "pi-session-a",
  sessionFile: "C:\\sessions\\a.jsonl",
  workspacePath: "C:\\work",
  pid: 1234,
  phase: "idle",
  uncertainDelivery: false,
};

test("Pi native draft and run facts expose implemented queue, model, compaction and usage capabilities", () => {
  const state = { sessionId: view.sessionId, model: { provider: "openai", id: "gpt-test" }, thinkingLevel: "medium", messageCount: 0,
    piThinkingLevels: ["off", "medium"], piSessionStats: { tokens: { input: 12, output: 3, cacheRead: 4, cacheWrite: 1 },
      contextUsage: { tokens: 20, contextWindow: 200 } } };
  const draft = conversationSnapshotSchema.parse(createPiV4Snapshot(view, state, "pi-epoch-a"));
  assert.equal(draft.control.phase, "draft");
  assert.equal(draft.config.provider, "openai");
  assert.equal(draft.inputRouting.mode, "startNow");
  assert.equal(draft.availability.fork.allowed, false);
  assert.equal(draft.availability.compact.allowed, true);
  assert.deepEqual(draft.config.thoughtLevels, ["off", "medium"]);
  assert.equal(draft.usage.contextWindow?.usedTokens, 20);
  assert.equal(draft.usage.cumulative.cacheReadTokens, 4);

  const running = conversationSnapshotSchema.parse(createPiV4Snapshot({ ...view, phase: "running" }, { ...state, messageCount: 1 }, "pi-epoch-a"));
  assert.equal(running.control.phase, "running");
  assert.equal(running.control.canStop, true);
  assert.equal(running.inputRouting.mode, "enqueue");
  const guiding = conversationSnapshotSchema.parse(createPiV4Snapshot({ ...view, phase: "running" },
    { ...state, messageCount: 1, piDeliveryMode: "guide" }, "pi-epoch-a"));
  assert.equal(guiding.inputRouting.mode, "guide");

  const stopped = conversationSnapshotSchema.parse(createPiV4Snapshot({ ...view, phase: "stopped" }, { ...state, messageCount: 2 }, "pi-epoch-a"));
  assert.equal(stopped.control.phase, "completedInterrupted");
  assert.equal(stopped.control.canStop, false);
});

test("a settled user-only Pi turn cannot be projected as completed success or accept another input", () => {
  const snapshot = conversationSnapshotSchema.parse(createPiV4Snapshot(
    { ...view, phase: "settled" },
    { messageCount: 1, piIncompleteTurn: true, piPendingIntent: { textHash: "test" } },
    "pi-epoch-incomplete",
  ));
  assert.equal(snapshot.control.phase, "error");
  assert.equal(snapshot.control.sessionEnded, false);
  assert.equal(snapshot.control.lastError?.code, "pi.historyUnresolved");
  assert.equal(snapshot.inputRouting.mode, "reject");
});

test("Pi reports unknown effective context after compaction without inventing zero tokens", () => {
  const snapshot = conversationSnapshotSchema.parse(createPiV4Snapshot(view, {
    messageCount: 3,
    piSessionStats: {
      tokens: { input: 50, output: 20, cacheRead: 7, cacheWrite: 2 },
      contextUsage: { tokens: null, contextWindow: 128_000, percent: null },
    },
  }, "pi-epoch-after-compact"));
  assert.equal(snapshot.usage.contextWindow, null);
  assert.deepEqual(snapshot.usage.cumulative, {
    inputTokens: 50,
    outputTokens: 20,
    cacheReadTokens: 7,
    cacheWriteTokens: 2,
  });
  const knownEmpty = conversationSnapshotSchema.parse(createPiV4Snapshot(view, {
    piSessionStats: { contextUsage: { tokens: 0, contextWindow: 128_000 } },
  }, "pi-epoch-empty"));
  assert.equal(knownEmpty.usage.contextWindow?.usedTokens, 0);
});

test("Pi keeps billed session totals including compacted history separate from effective context", () => {
  const snapshot = conversationSnapshotSchema.parse(createPiV4Snapshot(view, {
    piSessionStats: {
      tokens: { input: 900, output: 120, cacheRead: 400, cacheWrite: 30 },
      cost: 0.1234,
      contextUsage: { tokens: null, contextWindow: 128_000 },
    },
  }, "pi-epoch-cost"));
  assert.equal(snapshot.usage.contextWindow, null);
  assert.equal(snapshot.usage.cumulative.costUSD, 0.1234);
  const unavailable = conversationSnapshotSchema.parse(createPiV4Snapshot(view, {}, "pi-epoch-no-stats"));
  assert.equal(unavailable.usage.cumulative.costUSD, undefined);
  const freeModel = conversationSnapshotSchema.parse(createPiV4Snapshot(view, {
    piSessionStats: { cost: 0 },
  }, "pi-epoch-free-model"));
  assert.equal(freeModel.usage.cumulative.costUSD, 0);
});
