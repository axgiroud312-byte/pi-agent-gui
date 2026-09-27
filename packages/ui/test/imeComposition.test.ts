import assert from "node:assert/strict";
import { test } from "node:test";
import { isImeComposingKeyEvent } from "../src/lib/imeComposition.js";

test("IME candidate Enter remains an edit when Chromium reports keyCode 229", () => {
  assert.equal(isImeComposingKeyEvent({ key: "Enter", keyCode: 229, isComposing: false }), true);
  assert.equal(isImeComposingKeyEvent({ key: "Process", isComposing: false }), true);
  assert.equal(isImeComposingKeyEvent({ key: "Dead", isComposing: false }), true);
});

test("the Enter immediately after compositionend cannot submit the just committed text", () => {
  assert.equal(
    isImeComposingKeyEvent({
      key: "Enter",
      isComposing: false,
      compositionEndAt: 1000,
      timeStamp: 1030,
    }),
    true,
  );
  assert.equal(
    isImeComposingKeyEvent({
      key: "Enter",
      isComposing: false,
      compositionEndAt: 1000,
      timeStamp: 1150,
    }),
    false,
    "a later deliberate Enter still sends",
  );
  assert.equal(
    isImeComposingKeyEvent({
      key: "ArrowDown",
      isComposing: false,
      compositionEndAt: 1000,
      timeStamp: 1030,
    }),
    false,
    "the grace period does not consume navigation",
  );
});
