import assert from "node:assert/strict";
import { test } from "node:test";
import type { ConversationRow, SessionControl } from "@zcode/shared/zcode-protocol-v4";
import { hasInlinePiModelError } from "../src/v4/piInlineModelError.js";

test("only the matching current model failure replaces a composer error", () => {
  const error: NonNullable<SessionControl["lastError"]> = { code: "pi.runtimeError", message: "fetch failed",
    recoverable: true, at: 2, source: "runtime" };
  const rows: ConversationRow[] = [
    { kind: "turnHeader", rowId: 1, turnId: "a", createdAt: 1, createdAtSeq: 1,
      origin: "userInput", state: "failed", startedAt: 1 },
    { kind: "assistantText", rowId: 2, turnId: "a", createdAt: 2, createdAtSeq: 2,
      text: "", state: "failed", error: { code: "pi.modelError", message: "fetch failed" } },
  ];
  assert.equal(hasInlinePiModelError(error, rows), true);
  assert.equal(hasInlinePiModelError({ ...error, code: "pi.deliveryUnknown" }, rows), false);
  assert.equal(hasInlinePiModelError({ ...error, message: "extension failed" }, rows), false);
  assert.equal(hasInlinePiModelError(error, []), false);
  assert.equal(hasInlinePiModelError(error, [...rows, { ...rows[0]!, rowId: 3, turnId: "b" }]), false);
});
