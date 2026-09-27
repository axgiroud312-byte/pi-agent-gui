import type { ComposerAttachmentUploadItem } from "@/store/composerAttachmentUploadStore.js";

/** A failed admission remains failed after navigation; it cannot become sendable by moving scopes. */
export function preparePromotedComposerAttachment(
  item: ComposerAttachmentUploadItem,
): ComposerAttachmentUploadItem {
  if (item.referenceOwnership === "session" || item.localZeroCopy || item.uploadStatus === "failed") {
    return item;
  }
  return { ...item, uploadStatus: "waitingSession", uploadProgress: 0,
    attachmentRef: undefined, staged: false, adopted: false, showComplete: false };
}
