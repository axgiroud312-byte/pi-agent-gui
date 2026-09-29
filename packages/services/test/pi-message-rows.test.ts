import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { conversationDeltaSchema, conversationRowSchema } from "@zcode/shared/zcode-protocol-v4";
import { PiMessageRows } from "../src/pi-agent/pi-message-rows.js";
import { buildConversationSharePublicProjection } from "../src/conversation-share/conversationSharePublicProjection.js";

test("empty model failures appear in their conversation turn, survive restart, and reconcile after recovery", () => {
  const user = { role: "user", content: "hello", timestamp: 1000 };
  const failed = { role: "assistant", content: [], timestamp: 2000, model: "test-model",
    stopReason: "error", errorMessage: "fetch failed" };
  const projection = new PiMessageRows();
  for (const message of [user, failed]) {
    projection.apply({ type: "message_start", message });
    projection.apply({ type: "message_end", message });
  }
  const rows = projection.getRows();
  const failure = rows.find(row => row.kind === "assistantText" && row.state === "failed");
  assert(failure && failure.kind === "assistantText", "an empty failed reply must not disappear");
  assert.equal(failure.text, "", "an error must not masquerade as generated assistant text");
  assert.deepEqual((failure as unknown as { error: unknown }).error,
    { code: "pi.modelError", message: "fetch failed" });
  assert.equal(failure.turnId, rows.find(row => row.kind === "userInput")?.turnId);
  conversationRowSchema.parse(failure);
  const restored = new PiMessageRows().restore([user, failed], [], projection.getRowIds());
  assert.deepEqual(restored.find(row => row.rowId === failure.rowId), failure);
  projection.reconcile([user, { ...failed, content: [{ type: "text", text: "recovered" }],
    stopReason: "stop", errorMessage: undefined }]);
  assert(!projection.getRows().some(row => row.kind === "assistantText" && row.state === "failed"));
});

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

test("Pi read tool rows expose actual plain and rich results even for a same-name override", () => {
  const image = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC";
  const user = { role: "user", content: [{ type: "text", text: "call read" }], timestamp: 1 };
  const assistant = { role: "assistant", content: [{ type: "toolCall", id: "override-read",
    name: "read", arguments: { path: "sentinel.txt" } }], timestamp: 2 };
  const plain = { role: "toolResult", toolCallId: "override-read", isError: false,
    content: [{ type: "text", text: "EXTENSION_READ_OVERRIDE_MARKER" }], timestamp: 3 };
  const plainRows = new PiMessageRows().restore([user, assistant, plain]);
  const plainRead = plainRows.find(row => row.kind === "toolCall");
  assert(plainRead && plainRead.kind === "toolCall");
  assert.deepEqual(plainRead.piResult?.parts, [{ type: "text", text: "EXTENSION_READ_OVERRIDE_MARKER" }]);
  const rich = { ...plain, isError: true,
    content: [{ type: "text", text: "Pi extension read failed" },
      { type: "image", mimeType: "image/png", data: image },
      { type: "text", text: "keep details" }], details: { source: "extension" } };
  const richRows = new PiMessageRows().restore([user, assistant, rich]);
  const richRead = richRows.find(row => row.kind === "toolCall");
  assert(richRead && richRead.kind === "toolCall");
  assert.equal(richRead.status, "error");
  assert.match(richRead.error?.message ?? "", /Pi extension read failed/u);
  assert.deepEqual(richRead.piResult?.parts.map(part => part.type), ["text", "image", "text"]);
  assert.deepEqual(richRead.piResult?.details, { source: "extension" });
  assert.equal(new PiMessageRows().restore([user, assistant, rich]).find(row => row.kind === "toolCall")?.status,
    "error", "cold restoration must retain Pi's error status");
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

test("visible Pi custom message keeps ordered text, image bytes by ref, and renderer-independent details", () => {
  const imageData = Buffer.from("original custom image bytes").toString("base64");
  const custom = { role: "custom", customType: "fixture.card", display: true, timestamp: 1234,
    content: [{ type: "text", text: "before" }, { type: "image", mimeType: "image/png", data: imageData },
      { type: "text", text: "after" }], details: { nested: { count: 2 }, marker: "original" } };
  const projection = new PiMessageRows();
  projection.apply({ type: "message_start", message: custom });
  projection.apply({ type: "message_end", message: custom });
  const row = projection.getRows().find(item => String(item.kind) === "extensionMessage") as unknown as {
    customType: string; parts: unknown[]; details: unknown; attachments: Array<{ ref: string; bytes: number }> } | undefined;
  assert(row, "custom message must be visible even without its TUI renderer");
  conversationRowSchema.parse(row);
  assert.equal(row.customType, "fixture.card");
  assert.deepEqual(row.parts, [{ type: "text", text: "before" },
    { type: "image", ref: "pi-image:0:1", mimeType: "image/png", bytes: 27, attachmentIndex: 0 },
    { type: "text", text: "after" }]);
  assert.deepEqual(row.details, custom.details);
  assert.deepEqual(projection.image(row.attachments[0]!.ref), { data: imageData, mimeType: "image/png" });
  const restored = new PiMessageRows().restore([custom]);
  assert.deepEqual(restored, projection.getRows());
  const hidden = new PiMessageRows().restore([{ ...custom, display: false }]);
  assert.equal(hidden.some(item => String(item.kind) === "extensionMessage"), false);
});

test("unknown assistant content and message roles retain a bounded, private structural fallback", () => {
  const imageData = Buffer.from("PRIVATE_UNKNOWN_IMAGE_BYTES").toString("base64");
  const assistant = { role: "assistant", timestamp: 12, content: [
    { type: "text", text: "known text" },
    { type: "future_block", label: "reference", nested: {
      apiKey: "sk-private-unknown-assistant", image: { mimeType: "image/png", data: imageData },
    } },
  ] };
  const future = { role: "futureDiagnostic", timestamp: 13,
    content: [{ type: "event", token: "private-unknown-message", payload: imageData }] };
  const messages = [{ role: "system", content: "private Pi system prompt", timestamp: 10,
    sections: [{ name: "tools", token: "system-secret" }] },
  { role: "user", content: "inspect", timestamp: 11 }, assistant, future];
  const restored = new PiMessageRows().restore(messages);
  const unknown = restored.filter(row => row.kind === "extensionMessage");
  assert.deepEqual(unknown.map(row => row.kind === "extensionMessage" ? row.customType : ""),
    ["pi.unknown-assistant-content", "pi.unknown-message"]);
  for (const row of unknown) {
    conversationRowSchema.parse(row);
    const transport = JSON.stringify(row);
    assert.ok(transport.length < 1_500, "unknown Pi data must be bounded before renderer transport");
    assert.doesNotMatch(transport, /sk-private-unknown-assistant|private-unknown-message|PRIVATE_UNKNOWN_IMAGE_BYTES|"data":"/u);
    assert.equal(transport.includes(imageData), false, "unknown image base64 must stay in Pi JSONL only");
    assert.equal(row.kind === "extensionMessage" ? row.attachments?.length ?? 0 : -1, 0,
      "unknown image data must not receive a readable attachment ref");
  }
  assert.match(JSON.stringify(unknown[0]), /"type"|"label"/u);
  assert.match(JSON.stringify(unknown[1]), /"role"|"content"/u);
  assert.doesNotMatch(JSON.stringify(unknown), /futureDiagnostic|future_block|reference/u,
    "unknown free-form labels can themselves contain private data");
  const live = new PiMessageRows();
  for (const message of messages) {
    live.apply({ type: "message_start", message });
    live.apply({ type: "message_end", message });
  }
  live.apply({ type: "agent_settled" });
  assert.deepEqual(live.getRows(), restored, "stream and cold JSONL must display the same fallback");
  assert.equal(JSON.stringify(restored).includes("private Pi system prompt"), false,
    "Pi's internal system message belongs to context inspection, not the timeline");
});

test("unknown user parts are visible without changing the Pi user turn or image attachment", () => {
  const imageData = Buffer.from("PRIVATE_USER_IMAGE_BYTES").toString("base64");
  const user = { role: "user", timestamp: 20, content: [
    { type: "text", text: "hello" }, { type: "image", mimeType: "image/png", data: imageData },
    { type: "future_input", secret: "private-user-part", children: [{ type: "reference", label: "fixture" }] },
  ] };
  const rows = new PiMessageRows().restore([user]);
  assert.deepEqual(rows.map(row => row.kind), ["turnHeader", "userInput", "extensionMessage"]);
  const input = rows.find(row => row.kind === "userInput");
  assert(input && input.kind === "userInput");
  assert.equal(input.text, "hello");
  assert.equal(input.attachments?.[0]?.ref, "pi-image:0:1");
  const fallback = rows.find(row => row.kind === "extensionMessage");
  assert(fallback && fallback.kind === "extensionMessage");
  assert.equal(fallback.customType, "pi.unknown-user-content");
  assert.equal(fallback.turnId, input.turnId);
  assert.equal(JSON.stringify(fallback).includes("private-user-part"), false);
  assert.equal(JSON.stringify(fallback).includes(imageData), false);
  assert.ok(JSON.stringify(fallback).length < 1_500);
  for (const row of rows) conversationRowSchema.parse(row);
  const live = new PiMessageRows();
  live.apply({ type: "message_start", message: user });
  live.apply({ type: "message_end", message: user });
  assert.deepEqual(live.getRows(), rows);
});

test("large unknown Pi structures become a bounded structural summary", () => {
  const secret = "PRIVATE_LARGE_UNKNOWN_VALUE";
  const future = { role: "futureDiagnostic", timestamp: 21,
    content: Array.from({ length: 500 }, (_, index) => ({ type: "item", index, token: secret,
      children: Array.from({ length: 10 }, (_, nestedIndex) => ({ nestedIndex, label: secret })) })) };
  const row = new PiMessageRows().restore([future]).find(item => item.kind === "extensionMessage");
  assert(row);
  const transport = JSON.stringify(row);
  assert.ok(transport.length < 1_500, `unknown fallback has ${transport.length} chars`);
  assert.ok(JSON.stringify(row.kind === "extensionMessage" ? row.parts[0] : null).length < 950,
    "one unknown part must stay under the UI structure budget");
  assert.equal(transport.includes(secret), false);
});

test("Pi extension details and local image refs cannot leak through public sharing", () => {
  const row = conversationRowSchema.parse({ kind: "extensionMessage", rowId: 1, turnId: "pi-turn-1",
    productTurnId: "product-1", createdAt: 1000, createdAtSeq: 1, customType: "private.fixture",
    parts: [{ type: "text", text: "visible" }, { type: "image", ref: "pi-image:0:1",
      mimeType: "image/png", bytes: 10, attachmentIndex: 0 }],
    attachments: [{ ref: "pi-image:0:1", fileName: "image.png", mime: "image/png", bytes: 10 }],
    details: { secret: "private extension data" } });
  assert.throws(() => buildConversationSharePublicProjection({ rows: [row],
    selectedProductTurnIds: ["product-1"] }), /Pi extension messages cannot be shared yet/);
});

test("Pi tool result keeps ordered text, image and details from the authoritative message", () => {
  const imageData = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRhsAAAAASUVORK5CYII=";
  const user = { role: "user", content: "use rich tool", timestamp: 1000 };
  const assistant = { role: "assistant", timestamp: 1001,
    content: [{ type: "toolCall", id: "rich-call", name: "extension_probe", arguments: { value: 1 } }] };
  const result = { role: "toolResult", toolCallId: "rich-call", toolName: "extension_probe", timestamp: 1002,
    content: [{ type: "text", text: "before" }, { type: "image", mimeType: "image/png", data: imageData },
      { type: "text", text: "after" }, { type: "reference", label: "unrecognized block" }],
    details: { source: "fixed Pi", marker: "private tool detail" }, isError: false };
  const projection = new PiMessageRows();
  for (const message of [user, assistant, result]) {
    projection.apply({ type: "message_start", message });
    projection.apply({ type: "message_end", message });
  }
  projection.apply({ type: "agent_settled" });
  const live = projection.getRows();
  const row = live.find(item => item.kind === "toolCall");
  assert(row && row.kind === "toolCall");
  const parsed = conversationRowSchema.parse(row);
  assert(parsed.kind === "toolCall");
  assert.deepEqual(parsed.piResult, row.piResult, "transport validation must retain Pi result blocks");
  assert.equal(row.status, "success");
  assert.deepEqual(row.piResult?.parts, [
    { type: "text", text: "before" },
    { type: "image", ref: "pi-image:2:1", mimeType: "image/png", bytes: 68, attachmentIndex: 0 },
    { type: "text", text: "after" },
    { type: "unknown", value: { type: "reference", label: "unrecognized block" } },
  ]);
  assert.deepEqual(row.piResult?.details, result.details);
  assert.equal(row.piResult?.attachments?.[0]?.ref, "pi-image:2:1");
  assert.deepEqual(projection.image("pi-image:2:1"), { data: imageData, mimeType: "image/png" });
  assert.deepEqual(new PiMessageRows().restore([user, assistant, result]), live);
  assert.deepEqual(new PiMessageRows().reconcile([user, assistant, result]).length > 0, true);

  const publicRow = conversationRowSchema.parse({ ...row, productTurnId: "private-turn" });
  assert.throws(() => buildConversationSharePublicProjection({ rows: [publicRow],
    selectedProductTurnIds: ["private-turn"] }), /Pi tool results cannot be shared yet/u);
});

test("Pi direct bash history preserves command, output, exit and context choice across reconciliation", () => {
  const withContext = { role: "bashExecution", command: "printf first", output: "first",
    exitCode: 7, cancelled: false, truncated: false, timestamp: 1000,
    excludeFromContext: false };
  const withoutContext = { role: "bashExecution", command: "printf second", output: "second",
    exitCode: 0, cancelled: false, truncated: true, fullOutputPath: "C:/tmp/pi-output.log",
    timestamp: 2000, excludeFromContext: true };
  const projection = new PiMessageRows();
  const deltas = projection.reconcile([withContext, withoutContext]);
  assert.equal(deltas.filter(delta => delta.op === "row.appended").length, 2);
  const live = projection.getRows().filter(row => String(row.kind) === "bashExecution");
  assert.equal(live.length, 2, "standalone Pi bash messages must stay visible without a user turn");
  for (const row of live) conversationRowSchema.parse(row);
  assert.deepEqual(live.map(row => ({
    command: (row as { command?: string }).command,
    output: (row as { output?: string }).output,
    exitCode: (row as { exitCode?: number }).exitCode,
    excludeFromContext: (row as { excludeFromContext?: boolean }).excludeFromContext,
  })), [
    { command: "printf first", output: "first", exitCode: 7, excludeFromContext: false },
    { command: "printf second", output: "second", exitCode: 0, excludeFromContext: true },
  ]);
  assert.equal((live[1] as { fullOutputPath?: string }).fullOutputPath, "C:/tmp/pi-output.log");
  assert.equal((live[1] as { truncated?: boolean }).truncated, true);
  assert.deepEqual(new PiMessageRows().restore([withContext, withoutContext]), projection.getRows());
  const stopped = new PiMessageRows().restore([{ ...withContext, cancelled: true, exitCode: undefined }]);
  const bash = stopped.find(row => String(row.kind) === "bashExecution") as { cancelled?: boolean,
    exitCode?: number } | undefined;
  assert.equal(bash?.cancelled, true);
  assert.equal(bash?.exitCode, undefined);
});

test("public Pi bash projection omits the local full-output path", () => {
  const rows = [
    conversationRowSchema.parse({ kind: "turnHeader", rowId: 1, turnId: "pi-turn-0",
      productTurnId: "pi-product-0", createdAt: 1, createdAtSeq: 1,
      origin: "userInput", executionKind: "agent", state: "completedSuccess", startedAt: 1 }),
    conversationRowSchema.parse({ kind: "bashExecution", rowId: 2, turnId: "pi-turn-0",
      productTurnId: "pi-product-0", createdAt: 2, createdAtSeq: 2,
      command: "echo secret", output: "visible", exitCode: 0, cancelled: false,
      truncated: true, fullOutputPath: "C:/private/pi-output.log", excludeFromContext: true }),
  ];
  const shared = buildConversationSharePublicProjection({ rows, selectedProductTurnIds: ["pi-product-0"] });
  const bash = shared.rows.find(row => row.kind === "bashExecution");
  assert(bash && bash.kind === "bashExecution");
  assert.equal(bash.fullOutputPath, undefined);
  assert.equal(bash.command, "echo secret");
  assert.equal(bash.excludeFromContext, true);
});
