import { useEffect, useState, type ComponentProps } from "react";
import { PRODUCT_CAPABILITIES, PRODUCT_ISSUES_URL, ZCODE_COMMIT, ZCODE_VERSION } from "@zcode/shared";
import { Button } from "@/components/ui/button.js";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog.js";
import { FeedbackCenter } from "@/feedback/FeedbackCenter.js";
import { buildPiDiagnosticPreview } from "@/feedback/piDiagnosticPreview.js";
import { useFeedbackStore } from "@/feedback/feedbackStore.js";
import { useServices } from "@/hooks/useServices.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { useTabStore } from "@/store/TabStoreProvider.js";
import { useZCodeSessionStore } from "@/store/zcodeSessionStore.js";

/** Native feedback entry, backed by a local allowlisted diagnostic preview. */
function PiFeedbackPreview({ platform }: Pick<ComponentProps<typeof FeedbackCenter>, "platform">) {
  const { zcodeAgentService } = useServices();
  const { intl } = useZCodeIntl();
  const open = useFeedbackStore((state) => state.open);
  const featureRequestOpen = useFeedbackStore((state) => state.featureRequestOpen);
  const tab = useFeedbackStore((state) => state.tab);
  const close = useFeedbackStore((state) => state.close);
  const workspacePath = useTabStore((state) => state.activeWorkspacePath);
  const workspaceIdentity = useTabStore((state) => state.activeWorkspaceIdentity ?? undefined);
  const sessionId = useZCodeSessionStore((state) => workspacePath
    ? state.getWorkspaceState(workspacePath, workspaceIdentity).activeTaskId : null);
  const [bridgeInfo, setBridgeInfo] = useState<{ scope: string; value: unknown } | null>(null);
  const [checking, setChecking] = useState(false);
  const [copied, setCopied] = useState(false);
  const [actionError, setActionError] = useState("");
  const dialogOpen = open && tab === "submit";
  const scope = JSON.stringify([workspacePath, workspaceIdentity, sessionId]);

  // These two menu commands explicitly request an external page, not a report.
  useEffect(() => {
    if (!featureRequestOpen && !(open && tab === "tickets")) return;
    close();
    void platform.openExternal(featureRequestOpen ? `${PRODUCT_ISSUES_URL}/new` : PRODUCT_ISSUES_URL);
  }, [close, featureRequestOpen, open, platform, tab]);

  useEffect(() => {
    if (!dialogOpen) return;
    let current = true;
    setBridgeInfo(null);
    setCopied(false);
    setActionError("");
    if (!workspacePath || !sessionId) { setChecking(false); return; }
    setChecking(true);
    void zcodeAgentService.readPiControlTree({ workspacePath, sessionId,
      ...(workspaceIdentity ? { workspaceIdentity } : {}) })
      .then((view) => { if (current) setBridgeInfo({ scope, value: view.info }); })
      .catch(() => { if (current) setBridgeInfo(null); })
      .finally(() => { if (current) setChecking(false); });
    return () => { current = false; };
  }, [dialogOpen, scope, sessionId, workspaceIdentity, workspacePath, zcodeAgentService]);

  const preview = buildPiDiagnosticPreview({ guiVersion: ZCODE_VERSION,
    buildCommit: ZCODE_COMMIT, piBridge: bridgeInfo?.scope === scope ? bridgeInfo.value : null });
  const copy = () => {
    setActionError("");
    void navigator.clipboard.writeText(preview)
      .then(() => setCopied(true))
      .catch(() => setActionError(intl.formatMessage({ id: "feedback.piDiagnostics.copyFailed" })));
  };
  const openIssue = () => {
    setActionError("");
    void Promise.resolve().then(() => platform.openExternal(`${PRODUCT_ISSUES_URL}/new`))
      .then(() => close())
      .catch(() => setActionError(intl.formatMessage({ id: "feedback.piDiagnostics.openFailed" })));
  };

  return <Dialog open={dialogOpen} onOpenChange={(next) => { if (!next) close(); }}>
    <DialogContent data-testid="pi-diagnostics-preview-dialog" className="max-w-[min(38rem,calc(100vw-2rem))]">
      <DialogHeader>
        <DialogTitle>{intl.formatMessage({ id: "feedback.piDiagnostics.title" })}</DialogTitle>
        <DialogDescription>{intl.formatMessage({ id: "feedback.piDiagnostics.description" })}</DialogDescription>
      </DialogHeader>
      <pre data-testid="pi-diagnostics-preview" className="max-h-[35vh] overflow-auto rounded-lg border border-border bg-background p-3 text-xs whitespace-pre-wrap select-text">{preview}</pre>
      {checking ? <p className="text-ui-sm text-foreground-subtle">{intl.formatMessage({ id: "feedback.piDiagnostics.checking" })}</p> : null}
      {actionError ? <p role="alert" className="text-ui-sm text-destructive">{actionError}</p> : null}
      <p className="text-ui-sm text-foreground-subtle">{intl.formatMessage({ id: "feedback.piDiagnostics.manual" })}</p>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={close}>{intl.formatMessage({ id: "common.cancel" })}</Button>
        <Button type="button" variant="outline" disabled={checking} onClick={copy} data-testid="pi-diagnostics-copy">
          {intl.formatMessage({ id: copied ? "feedback.piDiagnostics.copied" : "feedback.piDiagnostics.copy" })}
        </Button>
        <Button type="button" onClick={openIssue} data-testid="pi-diagnostics-open-issue">
          {intl.formatMessage({ id: "feedback.piDiagnostics.openIssue" })}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}

/** Vendor feedback service is retired; no report or draft is sent automatically. */
export function FeedbackHost(props: ComponentProps<typeof FeedbackCenter>) {
  return PRODUCT_CAPABILITIES.vendorFeedback ? <FeedbackCenter {...props} />
    : <PiFeedbackPreview platform={props.platform} />;
}
