import { useState } from "react";
import type { PiExtensionUiState } from "@zcode/shared/zcode-protocol-v4";
import { Button } from "@/components/ui/button.js";

/** Fixed Pi RPC string UI only. React escapes extension text; no TUI component factory runs in the renderer. */
export function PiExtensionUiPanel({ state, placement, onApplyEditorText }: {
  state: PiExtensionUiState;
  placement: "aboveEditor" | "belowEditor";
  onApplyEditorText?: (text: string) => void;
}) {
  const [appliedEditorId, setAppliedEditorId] = useState<string | null>(null);
  const [applyError, setApplyError] = useState<string | null>(null);
  const widgets = state.widgets.filter(widget => widget.placement === placement);
  if (placement === "belowEditor" && widgets.length === 0) return null;
  if (placement === "aboveEditor" && widgets.length === 0 &&
    state.statuses.length === 0 && state.notices.length === 0 &&
    !state.title && !state.editorText) return null;
  return <section className="mx-3 mb-2 max-h-40 space-y-1 overflow-auto rounded-md border border-border bg-background/80 px-3 py-2 text-xs"
    data-testid={`pi-extension-ui-${placement}`} aria-label="Pi 扩展信息">
    {placement === "aboveEditor" && state.title ? <div className="font-medium"
      data-testid="pi-extension-title">{state.title.text}</div> : null}
    {placement === "aboveEditor" && state.statuses.length > 0 ? <div className="flex flex-wrap gap-1.5" role="status">
      {state.statuses.map(status => <span key={status.key} className="rounded bg-surface px-2 py-1"
        data-testid={`pi-extension-status-${status.key}`}>
        <strong>{status.key}</strong>：{status.text}
      </span>)}
    </div> : null}
    {widgets.map(widget => <div key={widget.key} className="rounded border border-border/70 px-2 py-1"
      data-testid={`pi-extension-widget-${widget.key}`}>
      <div className="font-medium text-foreground-subtle">{widget.key}</div>
      <pre className="whitespace-pre-wrap break-words font-mono">{widget.lines.join("\n")}</pre>
    </div>)}
    {placement === "aboveEditor" && state.notices.map(notice => <p key={notice.id}
      className={notice.type === "error" ? "text-destructive" : "text-foreground-subtle"}
      data-testid="pi-extension-notice">{notice.message}</p>)}
    {placement === "aboveEditor" && state.editorText && appliedEditorId !== state.editorText.id ? <div className="space-y-1.5">
      <p>Pi 扩展请求设置输入区文本。请先发送或清空当前草稿，再应用：</p>
      {applyError ? <p role="alert" className="text-destructive">{applyError}</p> : null}
      {onApplyEditorText ? <Button type="button" variant="outline" size="sm" onClick={() => {
        try { onApplyEditorText(state.editorText!.text); setAppliedEditorId(state.editorText!.id); setApplyError(null); }
        catch (error) { setApplyError(error instanceof Error ? error.message : String(error)); }
      }}>应用到输入框</Button> : null}
      <textarea readOnly value={state.editorText.text} className="h-16 w-full resize-y rounded border border-border bg-background p-2"
        data-testid="pi-extension-editor-text" />
    </div> : null}
  </section>;
}
