import assert from "node:assert/strict";
import { test } from "node:test";
import { preparePromotedComposerAttachment } from "../src/v4/composer/composerAttachmentPromotion.js";
import type { ComposerAttachmentUploadItem } from "../src/store/composerAttachmentUploadStore.js";

function item(status: ComposerAttachmentUploadItem["uploadStatus"]): ComposerAttachmentUploadItem {
  return { id: "image", filename: "image.png", mimeType: "image/png", sizeBytes: 1,
    referenceOwnership: "composer", uploadStatus: status, uploadProgress: 40,
    operationId: "op", autoRetryCount: 0, runtimeRebuildRetryCount: 0,
    staged: false, adopted: false, showComplete: false, localZeroCopy: false };
}

test("scope promotion never makes an unsaved failed image ready to send", () => {
  const failed = { ...item("failed"), uploadError: "Image draft admission failed: storage full",
    uploadErrorKind: "permanent" as const };
  assert.deepEqual(preparePromotedComposerAttachment(failed), failed);
  assert.equal(preparePromotedComposerAttachment(item("uploading")).uploadStatus, "waitingSession");
});
