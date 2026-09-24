import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { conversationDeltaSchema, conversationRowSchema } from "@zcode/shared/zcode-protocol-v4";
import { PiMessageRows } from "../src/pi-agent/pi-message-rows.js";

test("Pi stream and final history produce native text/tool rows with cumulative output replacement", () => {
  const projection = new PiMessageRows();
  const user = { role: "user", content: "检查文件", timestamp: 1000 };
  const assistant = {
    role: "assistant", timestamp: 2000, model: "fixture-model", stopReason: "stop",
    content: [
      { type: "text", text: "最终答复" },
      { type: "toolCall", id: "call-1", name: "bash", arguments: { command: "echo ok" } },
    ],
  };
  const toolResult = { role: "toolResult", toolCallId: "call-1", content: [{ type: "text", text: "ok\n" }], isError: false, timestamp: 3000 };
  projection.expectUserCommand("native-command-1");
  projection.apply({ type: "message_start", message: user });
  projection.apply({ type: "message_end", message: user });
  projection.apply({ type: "message_start", message: { ...assistant, content: [] } });
  projection.apply({ type: "message_update", assistantMessageEvent: { type: "text_start", contentIndex: 0 } });
  const firstText = projection.apply({ type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "临时" } });
  assert.equal(firstText[0]?.op, "row.appended");
  const secondText = projection.apply({ type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "正文" } });
  assert.deepEqual(secondText.map(delta => delta.op), ["row.delta"]);
  projection.apply({ type: "message_update", assistantMessageEvent: { type: "toolcall_start", contentIndex: 1, id: "call-1", toolName: "bash" } });
  projection.apply({ type: "message_update", assistantMessageEvent: { type: "toolcall_end", contentIndex: 1, toolCall: assistant.content[1] } });
  projection.apply({ type: "tool_execution_start", toolCallId: "call-1", toolName: "bash" });
  projection.apply({ type: "tool_execution_update", toolCallId: "call-1", partialResult: { content: [{ type: "text", text: "o" }] } });
  projection.apply({ type: "tool_execution_update", toolCallId: "call-1", partialResult: { content: [{ type: "text", text: "ok" }] } });
  const partial = projection.getRows().find(row => row.kind === "toolCall");
  assert.equal(partial?.kind === "toolCall" ? partial.output?.text : undefined, "ok");
  projection.apply({ type: "tool_execution_end", toolCallId: "call-1", result: { content: [{ type: "text", text: "ok\n" }] }, isError: false });
  const finalCorrection = projection.apply({ type: "message_end", message: assistant });
  assert.ok(finalCorrection.some(delta => delta.op === "row.upserted" && delta.row.kind === "assistantText" && delta.row.text === "最终答复"));
  projection.apply({ type: "message_start", message: toolResult });
  projection.apply({ type: "message_end", message: toolResult });
  projection.apply({ type: "agent_settled" });
  const live = projection.getRows();
  for (const row of live) conversationRowSchema.parse(row);
  for (const delta of [...firstText, ...secondText, ...finalCorrection]) conversationDeltaSchema.parse(delta);
  assert.equal(live.find(row => row.kind === "turnHeader")?.state, "completedSuccess");
  assert.equal(live.find(row => row.kind === "userInput")?.sourceCommandId, "native-command-1");
  assert.equal(live.find(row => row.kind === "toolCall")?.status, "success");

  const restored = new PiMessageRows().restore([user, assistant, toolResult]);
  assert.deepEqual(restored.map(row => [row.kind, row.rowId]), live.map(row => [row.kind, row.rowId]));
  assert.equal(restored.find(row => row.kind === "assistantText")?.text, "最终答复");
  assert.equal(restored.find(row => row.kind === "toolCall")?.status, "success");
  assert.equal(restored.find(row => row.kind === "toolCall")?.output?.text, "ok\n");
});

test("a delayed Stop projection only interrupts its captured command, never a subsequent turn", () => {
  const projection = new PiMessageRows();
  const input = (commandId: string) => {
    const message = { role: "user", content: commandId, timestamp: Date.now() };
    projection.expectUserCommand(commandId);
    projection.apply({ type: "message_start", message });
    projection.apply({ type: "message_end", message });
  };
  input("run-A");
  const stoppedCommand = projection.currentCommandId();
  input("run-B");
  projection.markStopped(stoppedCommand);
  const turns = projection.getRows().filter(row => row.kind === "turnHeader");
  assert.equal(turns[0]?.sourceCommandId, "run-A");
  assert.equal(turns[0]?.state, "completedInterrupted");
  assert.equal(turns[1]?.sourceCommandId, "run-B");
  assert.equal(turns[1]?.state, "running");
  assert.deepEqual(projection.markStopped(undefined), []);
});

test("retry/compaction reconciliation converges live and restored rows while preserving a native command anchor", () => {
  const projection = new PiMessageRows();
  const user = { role: "user", content: "retry once", timestamp: 1000 };
  const failed = { role: "assistant", content: [{ type: "text", text: "overloaded" }], stopReason: "error", timestamp: 1001 };
  const final = { role: "assistant", content: [{ type: "text", text: "done" }], stopReason: "stop", timestamp: 1002 };
  projection.expectUserCommand("native-retry");
  projection.apply({ type: "message_start", message: user });
  projection.apply({ type: "message_end", message: user });
  projection.apply({ type: "message_start", message: failed });
  projection.apply({ type: "message_end", message: failed });
  projection.apply({ type: "agent_settled" });
  const changes = projection.reconcile([user, final]);
  assert.ok(changes.some(change => change.op === "row.upserted"));
  const live = projection.getRows();
  const anchors = [{ textHash: createHash("sha256").update("retry once").digest("hex"), commandId: "native-retry" }];
  const restored = new PiMessageRows().restore([user, final], anchors);
  assert.deepEqual(live, restored);
  assert.equal(live.find(row => row.kind === "userInput")?.sourceCommandId, "native-retry");
});

test("Pi read card opens the same workspace file that Pi read from its cwd", () => {
  const workspacePath = join(tmpdir(), "pi-read-workspace");
  const piUser = { role: "user", content: "read README", timestamp: 1000 };
  const piAssistant = { role: "assistant", content: [
    { type: "toolCall", id: "read-1", name: "read", arguments: { path: "README.md" } },
  ], timestamp: 2000 };
  const projection = new PiMessageRows(workspacePath);
  projection.apply({ type: "message_start", message: piUser });
  projection.apply({ type: "message_end", message: piUser });
  projection.apply({ type: "message_start", message: piAssistant });
  projection.apply({ type: "message_end", message: piAssistant });
  const live = projection.getRows().find(row => row.kind === "toolCall");
  const cold = new PiMessageRows(workspacePath).restore([piUser, piAssistant])
    .find(row => row.kind === "toolCall");
  for (const row of [live, cold]) {
    assert.equal(row?.kind === "toolCall" ? (row.input as { path: string }).path : null,
      join(workspacePath, "README.md"));
    assert.equal(row?.kind === "toolCall" ? row.inputText : null, '{"path":"README.md"}');
  }
});
