import { PRODUCT_CAPABILITIES } from "@zcode/shared";

/** GitHub receives no draft, screenshot or diagnostic payload from FeedbackHost. */
export function feedbackOpenedMessageId(
  nativeMessageId: "chat.error.feedbackOpened" | "taskList.feedbackOpened",
): string {
  return PRODUCT_CAPABILITIES.vendorFeedback
    ? nativeMessageId
    : "feedback.external.manualCopyHint";
}
