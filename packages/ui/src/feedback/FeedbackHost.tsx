import { useEffect, type ComponentProps } from "react";
import { PRODUCT_CAPABILITIES, PRODUCT_ISSUES_URL } from "@zcode/shared";
import { FeedbackCenter } from "@/feedback/FeedbackCenter.js";
import { useFeedbackStore } from "@/feedback/feedbackStore.js";

/** Keep all native feedback entry points, but direct them to this project's issue tracker.
 * No draft, screenshot, log or account token is sent to the external page.
 */
export function FeedbackHost(props: ComponentProps<typeof FeedbackCenter>) {
  const open = useFeedbackStore((state) => state.open || state.featureRequestOpen);
  const tab = useFeedbackStore((state) => state.tab);
  const close = useFeedbackStore((state) => state.close);
  useEffect(() => {
    if (PRODUCT_CAPABILITIES.vendorFeedback || !open) return;
    close();
    props.platform.openExternal(tab === "tickets" ? PRODUCT_ISSUES_URL : `${PRODUCT_ISSUES_URL}/new`);
  }, [close, open, props.platform, tab]);
  return PRODUCT_CAPABILITIES.vendorFeedback ? <FeedbackCenter {...props} /> : null;
}
