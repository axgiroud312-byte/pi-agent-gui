import assert from "node:assert/strict";
import { test } from "node:test";
import { piFileReferenceFailureMessageId } from "../src/v4/piFileReferenceFailure.js";

test("file-reference rejection maps stable Host codes to actionable native feedback", () => {
  assert.equal(piFileReferenceFailureMessageId("pi.fileReference.FILE_NOT_FOUND"),
    "chat.error.piFileReference.missing");
  assert.equal(piFileReferenceFailureMessageId("pi.fileReference.FILE_TOO_LARGE"),
    "chat.error.piFileReference.large");
  assert.equal(piFileReferenceFailureMessageId("pi.fileReference.OUTSIDE_WORKSPACE"),
    "chat.error.piFileReference.outside");
  assert.equal(piFileReferenceFailureMessageId("pi.commandFailed"), undefined);
  assert.equal(piFileReferenceFailureMessageId("pi.fileReference.UNKNOWN"), undefined);
});
