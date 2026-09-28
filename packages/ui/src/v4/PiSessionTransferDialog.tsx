import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Download, RefreshCw } from "lucide-react";
import type { IServiceAccessor } from "@zcode/services";
import { Button } from "@/components/ui/button.js";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog.js";
import { useOptionalPlatform } from "@/hooks/usePlatform.js";
import { useServices } from "@/hooks/useServices.js";
import { PiSessionDialogGuard, type PiSessionDialogTicket } from "@/v4/piSessionDialogGuard.js";

type Preview = Awaited<ReturnType<IServiceAccessor["zcodeAgentService"]["readPiSessionTransfer"]>>;
type SharePreview = Awaited<ReturnType<IServiceAccessor["zcodeAgentService"]["preparePiSessionShare"]>>;
type TransferTarget = Parameters<IServiceAccessor["zcodeAgentService"]["readPiSessionTransfer"]>[0];
interface TransferUiState {
  scope: number;
  open: boolean;
  preview: Preview | null;
  busy: boolean;
  error: string | null;
  notice: string | null;
  share: { target: TransferTarget; value: SharePreview } | null;
  shareConfirmed: boolean;
}
const emptyState = (scope: number): TransferUiState => ({ scope, open: false, preview: null,
  busy: false, error: null, notice: null, share: null, shareConfirmed: false });

interface PublishedShareReceipt { viewerUrl: string; gistUrl: string }
// A confirmed remote write can finish after navigation. Keep only its returned
// links in this renderer, under the exact source workspace/session identity.
// Nothing is written to settings, drafts, diagnostics, or another session.
const publishedShareReceipts = new Map<string, PublishedShareReceipt[]>();
const sharePublishFailures = new Map<string, string>();

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
  const [state, setState] = useState<TransferUiState>(() => emptyState(0));
  const guard = useRef(new PiSessionDialogGuard()).current;
  const publishingTokens = useRef(new Set<string>());
  const target = useMemo(() => ({ workspacePath, sessionId,
    ...(workspaceIdentity ? { workspaceIdentity } : {}) }),
  [workspacePath, sessionId, workspaceIdentity]);
  const targetKey = JSON.stringify([workspacePath, sessionId, workspaceIdentity]);
  const scope = guard.syncContext(targetKey);
  const { open, preview, busy, error, notice, share, shareConfirmed } =
    state.scope === scope ? state : emptyState(scope);
  const sharePreview = share?.value ?? null;
  const receipts = publishedShareReceipts.get(targetKey) ?? [];
  const publishFailure = sharePublishFailures.get(targetKey) ?? null;

  const write = useCallback((ticket: PiSessionDialogTicket,
    update: (current: TransferUiState) => TransferUiState) => {
    if (!guard.isCurrent(ticket)) return;
    setState(current => guard.isCurrent(ticket)
      ? update(current.scope === ticket.scope ? current : emptyState(ticket.scope)) : current);
  }, [guard]);

  const refresh = useCallback(async () => {
    const actionTarget = { ...target };
    const ticket = guard.begin(targetKey);
    write(ticket, current => ({ ...current, busy: true, preview: null, error: null,
      share: null, shareConfirmed: false }));
    try {
      const next = await zcodeAgentService.readPiSessionTransfer(actionTarget);
      write(ticket, current => ({ ...current, preview: next }));
    } catch (cause) {
      write(ticket, current => ({ ...current,
        error: cause instanceof Error ? cause.message : String(cause) }));
    } finally { write(ticket, current => ({ ...current, busy: false })); }
  }, [guard, target, targetKey, write, zcodeAgentService]);
  useEffect(() => { if (open) void refresh(); }, [open, refresh]);
  // The saved preview carries its source target. Cleanup must never send an A
  // token to the currently rendered B session after a navigation.
  useEffect(() => () => {
    if (share && !publishingTokens.current.has(share.value.token)) void zcodeAgentService.discardPiSessionShare({
      ...share.target, token: share.value.token });
  }, [share, zcodeAgentService]);

  const exportSession = async (format: "html" | "jsonl") => {
    if (!platform || !preview || busy) return;
    const actionTarget = { ...target };
    const revision = preview.revision;
    const ticket = guard.begin(targetKey);
    write(ticket, current => ({ ...current, busy: true, error: null, notice: null }));
    try {
      const directory = await platform.selectDirectory();
      if (!directory || !guard.isCurrent(ticket)) return;
      const result = await zcodeAgentService.exportPiSession({ ...actionTarget, expectedRevision: revision,
        directory, format });
      write(ticket, current => ({ ...current,
        notice: `已由 Pi ${format === "html" ? "渲染 HTML" : "复制原始 JSONL"}：${result.path}` }));
    } catch (cause) {
      write(ticket, current => ({ ...current,
        error: cause instanceof Error ? cause.message : String(cause) }));
    } finally { write(ticket, current => ({ ...current, busy: false })); }
  };

  const importSession = async () => {
    if (!platform || !onImported || busy) return;
    const actionTarget = { ...target };
    const ticket = guard.begin(targetKey);
    write(ticket, current => ({ ...current, busy: true, error: null, notice: null }));
    try {
      const sourcePath = await platform.selectFile();
      if (!sourcePath || !guard.isCurrent(ticket)) return;
      beforeSwitch();
      const imported = await zcodeAgentService.importPiSession({
        workspacePath: actionTarget.workspacePath,
        ...(actionTarget.workspaceIdentity ? { workspaceIdentity: actionTarget.workspaceIdentity } : {}),
        sourcePath });
      if (guard.isCurrent(ticket)) {
        write(ticket, current => ({ ...current, share: null, shareConfirmed: false, open: false }));
        onImported(imported.sessionId);
      }
    } catch (cause) {
      write(ticket, current => ({ ...current,
        error: cause instanceof Error ? cause.message : String(cause) }));
    } finally { write(ticket, current => ({ ...current, busy: false })); }
  };

  const copyLast = async () => {
    if (!preview?.lastAssistantText || busy) return;
    const text = preview.lastAssistantText;
    const ticket = guard.begin(targetKey);
    try {
      await navigator.clipboard.writeText(text);
      write(ticket, current => ({ ...current, notice: "已复制 Pi 最近一条助手回复。" }));
    } catch (cause) {
      write(ticket, current => ({ ...current,
        error: cause instanceof Error ? cause.message : String(cause) }));
    }
  };

  const prepareShare = async () => {
    if (!preview || busy) return;
    const actionTarget = { ...target };
    const revision = preview.revision;
    const ticket = guard.begin(targetKey);
    write(ticket, current => ({ ...current, busy: true, error: null, notice: null,
      share: null, shareConfirmed: false }));
    try {
      const next = await zcodeAgentService.preparePiSessionShare({ ...actionTarget,
        expectedRevision: revision });
      if (guard.isCurrent(ticket)) {
        write(ticket, current => ({ ...current, share: { target: actionTarget, value: next } }));
      } else {
        await zcodeAgentService.discardPiSessionShare({ ...actionTarget, token: next.token });
      }
    } catch (cause) {
      write(ticket, current => ({ ...current,
        error: cause instanceof Error ? cause.message : String(cause) }));
    } finally { write(ticket, current => ({ ...current, busy: false })); }
  };

  const publishShare = async () => {
    if (!share || !shareConfirmed || busy) return;
    const actionShare = share;
    if (publishingTokens.current.has(actionShare.value.token)) return;
    const ticket = guard.begin(targetKey);
    // The publisher owns this token until it settles. A navigation cleanup
    // must not race its one explicitly confirmed external request.
    publishingTokens.current.add(actionShare.value.token);
    write(ticket, current => ({ ...current, busy: true, error: null }));
    try {
      const result = await zcodeAgentService.publishPiSessionShare({ ...actionShare.target,
        token: actionShare.value.token, confirmed: true });
      publishedShareReceipts.set(targetKey, [
        ...(publishedShareReceipts.get(targetKey) ?? []),
        { viewerUrl: result.viewerUrl, gistUrl: result.gistUrl },
      ]);
      sharePublishFailures.delete(targetKey);
      write(ticket, current => ({ ...current, share: null, shareConfirmed: false }));
    } catch (cause) {
      sharePublishFailures.set(targetKey, cause instanceof Error ? cause.message : String(cause));
      write(ticket, current => ({ ...current, share: null, shareConfirmed: false }));
    } finally {
      publishingTokens.current.delete(actionShare.value.token);
      write(ticket, current => ({ ...current, busy: false }));
    }
  };

  const setDialogOpen = (next: boolean) => {
    if (!next && busy) return;
    if (!next) {
      guard.invalidate();
      setState(emptyState(scope));
    } else {
      setState(current => ({ ...(current.scope === scope ? current : emptyState(scope)), open: true }));
    }
  };

  const clearReceipt = (index: number) => {
    const current = publishedShareReceipts.get(targetKey) ?? [];
    const next = current.filter((_item, position) => position !== index);
    if (next.length) publishedShareReceipts.set(targetKey, next);
    else publishedShareReceipts.delete(targetKey);
    setState(previous => ({ ...previous }));
  };
  const clearPublishFailure = () => {
    sharePublishFailures.delete(targetKey);
    setState(previous => ({ ...previous }));
  };

  return <>
    <Button type="button" variant="outline" size="icon-md" title="Pi 导入与导出" aria-label="Pi 导入与导出"
      className="pointer-events-auto bg-[var(--color-popover)] shadow-md" data-testid="pi-transfer-open"
      onClick={() => setDialogOpen(true)}><Download className="size-4" /></Button>
    <Dialog open={open} onOpenChange={setDialogOpen}>
      <DialogContent data-testid="pi-transfer-dialog" className="max-h-[85vh] max-w-[min(36rem,calc(100vw-2rem))] overflow-auto">
        <DialogHeader>
          <DialogTitle>Pi 会话导入与导出</DialogTitle>
          <DialogDescription>读取当前固定 Pi 会话的真实 JSONL。导入仅接受 Pi 0.87 的当前 JSONL 版本，生成新的 Pi 会话 ID，不改选中的源文件。</DialogDescription>
        </DialogHeader>
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        {publishFailure ? <p role="alert" data-testid="pi-share-publish-error" className="text-sm text-destructive">
          分享请求未确认成功：{publishFailure} 请检查 GitHub Gist 列表后再决定是否重试。
          <Button type="button" variant="outline" size="sm" onClick={clearPublishFailure}>清除发布提示</Button>
        </p> : null}
        {notice ? <p role="status" className="break-all text-sm">{notice}</p> : null}
        {receipts.length ? <section data-testid="pi-share-receipts" className="space-y-2 rounded border border-border p-3 text-sm">
          <p>本会话已创建的秘密链接（仅在本次应用运行期间保留）。清除本地收据不会删除 GitHub Gist。</p>
          {receipts.map((receipt, index) => <div key={`${receipt.gistUrl}:${index}`} className="space-y-1">
            <p role="status" className="break-all">查看链接：{receipt.viewerUrl}</p>
            <p className="break-all">Gist：{receipt.gistUrl}</p>
            <Button type="button" variant="outline" size="sm" onClick={() => clearReceipt(index)}>清除本地收据</Button>
          </div>)}
        </section> : null}
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
            <input type="checkbox" checked={shareConfirmed} onChange={event => setState(current => ({
              ...(current.scope === scope ? current : emptyState(scope)),
              shareConfirmed: event.target.checked,
            }))}
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
