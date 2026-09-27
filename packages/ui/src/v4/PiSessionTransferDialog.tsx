import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, RefreshCw } from "lucide-react";
import type { IServiceAccessor } from "@zcode/services";
import { Button } from "@/components/ui/button.js";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog.js";
import { useOptionalPlatform } from "@/hooks/usePlatform.js";
import { useServices } from "@/hooks/useServices.js";

type Preview = Awaited<ReturnType<IServiceAccessor["zcodeAgentService"]["readPiSessionTransfer"]>>;
type SharePreview = Awaited<ReturnType<IServiceAccessor["zcodeAgentService"]["preparePiSessionShare"]>>;

export function PiSessionTransferDialog({ sessionId, workspacePath, workspaceIdentity,
  beforeSwitch, onImported }: {
  sessionId: string;
  workspacePath: string;
  workspaceIdentity?: string;
  beforeSwitch(): void;
  onImported?: (sessionId: string) => void;
}) {
  const { zcodeAgentService } = useServices();
  const platform = useOptionalPlatform();
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [sharePreview, setSharePreview] = useState<SharePreview | null>(null);
  const [shareConfirmed, setShareConfirmed] = useState(false);
  const target = useMemo(() => ({ workspacePath, sessionId,
    ...(workspaceIdentity ? { workspaceIdentity } : {}) }),
  [workspacePath, sessionId, workspaceIdentity]);

  const refresh = useCallback(async () => {
    setBusy(true); setError(null);
    try { setPreview(await zcodeAgentService.readPiSessionTransfer(target)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  }, [target, zcodeAgentService]);
  useEffect(() => { if (open) void refresh(); }, [open, refresh]);
  useEffect(() => {
    setPreview(null); setSharePreview(null); setShareConfirmed(false);
    setError(null); setNotice(null);
  }, [sessionId]);
  useEffect(() => () => {
    if (sharePreview) void zcodeAgentService.discardPiSessionShare({ ...target, token: sharePreview.token });
  }, [sharePreview, target, zcodeAgentService]);

  const exportSession = async (format: "html" | "jsonl") => {
    if (!platform || !preview || busy) return;
    setError(null); setNotice(null);
    try {
      const directory = await platform.selectDirectory();
      if (!directory) return;
      setBusy(true);
      const result = await zcodeAgentService.exportPiSession({ ...target, expectedRevision: preview.revision,
        directory, format });
      setNotice(`已由 Pi ${format === "html" ? "渲染 HTML" : "复制原始 JSONL"}：${result.path}`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };

  const importSession = async () => {
    if (!platform || !onImported || busy) return;
    setError(null); setNotice(null);
    try {
      const sourcePath = await platform.selectFile();
      if (!sourcePath) return;
      beforeSwitch();
      setBusy(true);
      const imported = await zcodeAgentService.importPiSession({ workspacePath,
        ...(workspaceIdentity ? { workspaceIdentity } : {}), sourcePath });
      setSharePreview(null); setShareConfirmed(false);
      onImported(imported.sessionId);
      setOpen(false);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };

  const copyLast = async () => {
    if (!preview?.lastAssistantText || busy) return;
    try { await navigator.clipboard.writeText(preview.lastAssistantText); setNotice("已复制 Pi 最近一条助手回复。"); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };

  const prepareShare = async () => {
    if (!preview || busy) return;
    setBusy(true); setError(null); setNotice(null); setSharePreview(null); setShareConfirmed(false);
    try { setSharePreview(await zcodeAgentService.preparePiSessionShare({ ...target,
      expectedRevision: preview.revision })); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };

  const publishShare = async () => {
    if (!sharePreview || !shareConfirmed || busy) return;
    setBusy(true); setError(null);
    try {
      const result = await zcodeAgentService.publishPiSessionShare({ ...target,
        token: sharePreview.token, confirmed: true });
      setSharePreview(null); setShareConfirmed(false);
      setNotice(`已创建秘密链接（持链接者可访问）：${result.viewerUrl}；Gist：${result.gistUrl}`);
    } catch (cause) {
      setSharePreview(null); setShareConfirmed(false);
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally { setBusy(false); }
  };

  const setDialogOpen = (next: boolean) => {
    if (!next && busy) return;
    if (!next) { setSharePreview(null); setShareConfirmed(false); }
    setOpen(next);
  };

  return <>
    <Button type="button" variant="outline" size="icon-md" title="Pi 导入与导出" aria-label="Pi 导入与导出"
      className="pointer-events-auto bg-[var(--color-popover)] shadow-md" data-testid="pi-transfer-open"
      onClick={() => setOpen(true)}><Download className="size-4" /></Button>
    <Dialog open={open} onOpenChange={setDialogOpen}>
      <DialogContent data-testid="pi-transfer-dialog" className="max-h-[85vh] max-w-[min(36rem,calc(100vw-2rem))] overflow-auto">
        <DialogHeader>
          <DialogTitle>Pi 会话导入与导出</DialogTitle>
          <DialogDescription>读取当前固定 Pi 会话的真实 JSONL。导入仅接受 Pi 0.87 的当前 JSONL 版本，生成新的 Pi 会话 ID，不改选中的源文件。</DialogDescription>
        </DialogHeader>
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        {notice ? <p role="status" className="break-all text-sm">{notice}</p> : null}
        {preview ? <div className="space-y-2 rounded border border-border p-3 text-sm">
          <p>会话 ID：<code className="break-all">{preview.sessionId}</code></p>
          <p>原始历史：{preview.messageCount} 条消息，{preview.bytes.toLocaleString()} 字节。</p>
          <p className="text-xs text-foreground-subtle">JSONL 包含原始消息、工具结果和可能的敏感内容；HTML 是 Pi 渲染的当前分支。Windows 导出文件继承所选目录的访问权限。</p>
          <div><p className="mb-1">最近一条助手回复</p>
            <pre className="max-h-32 overflow-auto whitespace-pre-wrap rounded bg-muted p-2 text-xs"
              data-testid="pi-transfer-last-answer">{preview.lastAssistantText ?? "暂无助手回复"}</pre></div>
        </div> : <p className="text-sm text-foreground-subtle">正在读取 Pi 会话…</p>}
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void refresh()}>
            <RefreshCw className="size-3" />刷新</Button>
          <Button type="button" variant="outline" size="sm" disabled={busy || !platform || !preview}
            data-testid="pi-export-jsonl" onClick={() => void exportSession("jsonl")}>导出原始 JSONL</Button>
          <Button type="button" variant="outline" size="sm" disabled={busy || !platform || !preview}
            data-testid="pi-export-html" onClick={() => void exportSession("html")}>导出 Pi HTML</Button>
          <Button type="button" variant="outline" size="sm" disabled={busy || !preview?.lastAssistantText}
            data-testid="pi-copy-last-answer" onClick={() => void copyLast()}>复制最近回复</Button>
          <Button type="button" size="sm" disabled={busy || !platform || !onImported}
            title={onImported ? undefined : "此窗格不能切换到导入会话"}
            data-testid="pi-import-jsonl" onClick={() => void importSession()}>导入 Pi JSONL</Button>
          <Button type="button" variant="outline" size="sm" disabled={busy || !preview}
            data-testid="pi-share-preview" onClick={() => void prepareShare()}>预览分享内容</Button>
        </div>
        {sharePreview ? <section className="space-y-2 rounded border border-border p-3 text-sm"
          data-testid="pi-share-confirmation">
          <p>下面是 Pi 生成的 HTML 中内嵌的完整会话数据（HTML 共 {sharePreview.bytes.toLocaleString()} 字节）。预览不执行 HTML 脚本。</p>
          <p className="text-xs text-foreground-subtle">外发内容包含原始消息、工具输出、system prompt、工具定义，以及其中可能出现的凭据。GitHub 秘密 Gist 不会出现在搜索中；任何持有链接的人都能访问，没有私有访问控制。</p>
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded bg-muted p-2 text-xs"
            data-testid="pi-share-content-preview">{sharePreview.sessionDataJson}</pre>
          <details><summary>查看即将外发的完整 HTML 源码</summary>
            <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all text-xs">{sharePreview.html}</pre>
          </details>
          <label className="flex items-start gap-2">
            <input type="checkbox" checked={shareConfirmed} onChange={event => setShareConfirmed(event.target.checked)}
              data-testid="pi-share-confirm-checkbox" />
            <span>我已检查上述实际外发内容，确认创建持链接者可访问的秘密 Gist。</span>
          </label>
          <Button type="button" size="sm" disabled={busy || !shareConfirmed}
            data-testid="pi-share-publish" onClick={() => void publishShare()}>确认创建秘密链接</Button>
        </section> : null}
      </DialogContent>
    </Dialog>
  </>;
}
