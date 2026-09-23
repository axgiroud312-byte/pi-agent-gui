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

test("Pi native draft and run facts produce schema-valid v4 snapshots without advertising missing capabilities", () => {
  const state = { sessionId: view.sessionId, model: { provider: "openai", id: "gpt-test" }, thinkingLevel: "medium", messageCount: 0 };
  const draft = conversationSnapshotSchema.parse(createPiV4Snapshot(view, state, "pi-epoch-a"));
  assert.equal(draft.control.phase, "draft");
  assert.equal(draft.config.provider, "openai");
  assert.equal(draft.inputRouting.mode, "startNow");
  assert.equal(draft.availability.fork.allowed, false);

  const running = conversationSnapshotSchema.parse(createPiV4Snapshot({ ...view, phase: "running" }, { ...state, messageCount: 1 }, "pi-epoch-a"));
  assert.equal(running.control.phase, "running");
  assert.equal(running.control.canStop, true);
  assert.equal(running.inputRouting.mode, "reject");

  const stopped = conversationSnapshotSchema.parse(createPiV4Snapshot({ ...view, phase: "stopped" }, { ...state, messageCount: 2 }, "pi-epoch-a"));
  assert.equal(stopped.control.phase, "completedInterrupted");
  assert.equal(stopped.control.canStop, false);
});
