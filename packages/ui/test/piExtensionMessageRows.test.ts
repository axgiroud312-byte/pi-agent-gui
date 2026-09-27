import assert from "node:assert/strict";
import { test } from "node:test";
import { conversationRowSchema } from "@zcode/shared/zcode-protocol-v4";
import { buildConversationTurnRenderUnits } from "../src/v4/conversationTurnRenderUnits.js";

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
