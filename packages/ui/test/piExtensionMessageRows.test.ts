import assert from "node:assert/strict";
import { test } from "node:test";
import { conversationRowSchema } from "@zcode/shared/zcode-protocol-v4";
import { buildConversationTurnRenderUnits } from "../src/v4/conversationTurnRenderUnits.js";
import { toolCallRowToLegacyNode } from "../src/v4/toolCallRowAdapter.js";

test("a Pi extension message without a user turn stays in the native timeline", () => {
  const row = conversationRowSchema.parse({ kind: "extensionMessage", rowId: 1, turnId: "pi-turn-0",
    createdAt: 1, createdAtSeq: 1, customType: "fixture.card",
    parts: [{ type: "text", text: "original extension result" }], details: { value: 2 } });
  const units = buildConversationTurnRenderUnits([row]);
  assert.equal(units.length, 1);
  assert.equal(units[0]?.renderRows[0]?.kind, "extensionMessage");
  assert.equal(units[0]?.assistantWorkRows[0]?.kind, "extensionMessage");
});

test("a Pi direct bash result without a user turn stays in the native timeline", () => {
  const row = conversationRowSchema.parse({ kind: "bashExecution", rowId: 2, turnId: "pi-turn-0",
    createdAt: 2, createdAtSeq: 2, command: "printf ok", output: "ok", exitCode: 0,
    cancelled: false, truncated: false, excludeFromContext: true });
  const units = buildConversationTurnRenderUnits([row]);
  assert.equal(units.length, 1);
  assert.equal(units[0]?.renderRows[0]?.kind, "bashExecution");
  assert.equal(units[0]?.assistantWorkRows[0]?.kind, "bashExecution");
});

test("a Pi rich tool result stays on its native tool row without duplicated flattened output", () => {
  const row = conversationRowSchema.parse({ kind: "toolCall", rowId: 3, turnId: "pi-turn-1",
    createdAt: 3, createdAtSeq: 3, toolCallId: "rich-call", toolName: "extension_probe",
    status: "success", inputText: "{}", output: { text: "beforeafter" },
    piResult: { parts: [{ type: "text", text: "before" },
      { type: "image", ref: "pi-image:2:1", mimeType: "image/png", bytes: 68, attachmentIndex: 0 },
      { type: "text", text: "after" }],
      attachments: [{ ref: "pi-image:2:1", fileName: "tool-image-1.png", mime: "image/png", bytes: 68 }],
      details: { source: "Pi" } } });
  assert(row.kind === "toolCall");
  const units = buildConversationTurnRenderUnits([row]);
  assert.equal(units[0]?.assistantWorkRows[0], row);
  assert.equal(toolCallRowToLegacyNode(row).toolCall.output, undefined);
  assert.deepEqual(row.piResult?.parts.map(part => part.type), ["text", "image", "text"]);
});

test("a Pi read override keeps the native read card and displays Pi's actual result separately", () => {
  const row = conversationRowSchema.parse({ kind: "toolCall", rowId: 4, turnId: "pi-turn-2",
    createdAt: 4, createdAtSeq: 4, toolCallId: "override-read", toolName: "read",
    status: "error", inputText: '{"path":"sentinel.txt"}', input: { path: "sentinel.txt" },
    output: { text: "Pi extension read failed" }, error: { code: "pi.toolError", message: "Pi extension read failed" },
    piResult: { parts: [{ type: "text", text: "Pi extension read failed" },
      { type: "image", ref: "pi-image:3:1", mimeType: "image/png", bytes: 68, attachmentIndex: 0 }],
      attachments: [{ ref: "pi-image:3:1", fileName: "tool-image-1.png", mime: "image/png", bytes: 68 }],
      details: { source: "extension" } } });
  assert(row.kind === "toolCall");
  const units = buildConversationTurnRenderUnits([row]);
  assert.equal(units[0]?.assistantWorkRows[0], row);
  const native = toolCallRowToLegacyNode(row).toolCall;
  assert.equal(native.toolName, "read");
  assert.equal(native.status, "failed");
  assert.equal(native.output, undefined, "native card must not duplicate the Pi result panel");
  assert.deepEqual(row.piResult?.parts.map(part => part.type), ["text", "image"]);
  assert.equal(row.piResult?.details?.source, "extension");
});
