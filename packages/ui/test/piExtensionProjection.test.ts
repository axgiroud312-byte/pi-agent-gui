import assert from "node:assert/strict";
import { test } from "node:test";
import type { PendingInteraction, UserInputRequestPayload } from "@zcode/shared/zcode-protocol-v4";
import { pendingUserInputToViewModel } from "../src/v4/pendingInteractionAdapter.js";

test("native Pi input projection retains the exact method, placeholder and multiline prefill", () => {
  const interaction = {
    interactionId: "request-1",
    payload: { kind: "userInput", prompt: "Edit multiple lines", freeText: true,
      input: { method: "editor", prefill: "original\nvalue" } },
  } as PendingInteraction & { payload: UserInputRequestPayload };
  assert.deepEqual(pendingUserInputToViewModel(interaction), {
    interactionId: "request-1", prompt: "Edit multiple lines", freeText: true,
    sensitive: undefined, options: [], method: "editor", prefill: "original\nvalue",
    placeholder: undefined, message: undefined,
  });
});
