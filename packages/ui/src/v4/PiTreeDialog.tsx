import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GitBranch, RefreshCw } from "lucide-react";
import type { IServiceAccessor } from "@zcode/services";
import { Button } from "@/components/ui/button.js";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog.js";
import { useServices } from "@/hooks/useServices.js";
import { PiSessionDialogGuard, type PiSessionDialogTicket } from "@/v4/piSessionDialogGuard.js";

type TreeView = Awaited<ReturnType<IServiceAccessor["zcodeAgentService"]["readPiControlTree"]>>;
type TreeNode = TreeView["tree"][number];
type TreeTarget = Parameters<IServiceAccessor["zcodeAgentService"]["readPiControlTree"]>[0];
type TreeBusy = "load" | "navigate" | "label" | "reload" | "set_tools" | "branch" | "retry" | null;
interface TreeUiState {
  contextScope: number;
  view: TreeView | null;
  selectedId: string | null;
  label: string;
  summarize: boolean;
  busy: TreeBusy;
  error: string | null;
  pendingText: string | null;
  selectedTools: string[];
}
const emptyState = (contextScope: number): TreeUiState => ({ contextScope, view: null, selectedId: null,
  label: "", summarize: false, busy: null, error: null, pendingText: null, selectedTools: [] });

function entryTitle(node: TreeNode): string {
  const entry = node.entry;
  if (node.label) return node.label;
  if (entry.type === "message") {
    const content = "content" in entry.message ? entry.message.content : undefined;
    const text = typeof content === "string" ? content : Array.isArray(content)
      ? content.filter(part => part.type === "text").map(part => part.text).join("") : "";
    const images = Array.isArray(content) ? content.filter(part => part.type === "image").length : 0;
    const title = text.trim().slice(0, 100);
    return `${entry.message.role}: ${title || (images ? `图片 ×${images}` : "(empty)")}` +
      (title && images ? ` · 图片 ×${images}` : "");
  }
  return `${entry.type} · ${entry.id.slice(0, 8)}`;
}

function flatten(nodes: TreeView["tree"], depth = 0): Array<{ node: TreeNode; depth: number }> {
  return nodes.flatMap(node => [{ node, depth }, ...flatten(node.children, depth + 1)]);
}

export function PiTreeDialog({ sessionId, workspacePath, workspaceIdentity, remoteSessionId,
  beforeNavigate, onRestoredText, onBranch, onRetry }: {
  sessionId: string;
  workspacePath: string;
  workspaceIdentity?: string;
  remoteSessionId?: string | null;
  beforeNavigate(): void;
  onRestoredText(text: string): void;
  onBranch(operation: "fork" | "clone", entryId?: string): Promise<boolean>;
  onRetry(entryId: string): Promise<boolean>;
}) {
  const { zcodeAgentService } = useServices();
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<TreeUiState>(() => emptyState(0));
  const guard = useRef(new PiSessionDialogGuard()).current;
  const navigation = useRef<{ ticket: PiSessionDialogTicket; target: TreeTarget } | null>(null);
  const target = useMemo(() => ({ sessionId, workspacePath,
    ...(workspaceIdentity ? { workspaceIdentity } : {}),
    ...(remoteSessionId ? { remoteSessionId } : {}) }),
  [sessionId, workspacePath, workspaceIdentity, remoteSessionId]);
  const targetKey = JSON.stringify([sessionId, workspacePath, workspaceIdentity, remoteSessionId]);
  const contextScope = guard.syncContext(targetKey);
  const { view, selectedId, label, summarize, busy, error, pendingText, selectedTools } =
    state.contextScope === contextScope ? state : emptyState(contextScope);
  const editState = (update: (current: TreeUiState) => TreeUiState) => {
    setState(current => update(current.contextScope === contextScope ? current : emptyState(contextScope)));
  };
  const setSelectedId = (value: string | null) => editState(current => ({ ...current, selectedId: value }));
  const setLabel = (value: string) => editState(current => ({ ...current, label: value }));
  const setSummarize = (value: boolean) => editState(current => ({ ...current, summarize: value }));
  const setSelectedTools = (update: (current: string[]) => string[]) => editState(current => ({ ...current,
    selectedTools: update(current.selectedTools) }));
  const write = useCallback((ticket: PiSessionDialogTicket, update: (current: TreeUiState) => TreeUiState) => {
    if (!guard.isCurrent(ticket)) return;
    setState(current => guard.isCurrent(ticket)
      ? update(current.contextScope === ticket.scope ? current : emptyState(ticket.scope)) : current);
  }, [guard]);
  const rows = useMemo(() => flatten(view?.tree ?? []), [view]);
  const selected = rows.find(item => item.node.entry.id === selectedId)?.node;

  const refresh = useCallback(async () => {
    const ticket = guard.begin(targetKey);
    write(ticket, current => ({ ...current, view: null, selectedTools: [], busy: "load", error: null }));
    try {
      const next = await zcodeAgentService.readPiControlTree(target);
      write(ticket, current => ({ ...current, view: next, selectedTools: next.activeTools }));
    } catch (cause) {
      write(ticket, current => ({ ...current, error: cause instanceof Error ? cause.message : String(cause) }));
    } finally { write(ticket, current => ({ ...current, busy: null })); }
  }, [guard, target, targetKey, write, zcodeAgentService]);

  useEffect(() => {
    if (open) void refresh();
    return () => { guard.invalidate(); navigation.current = null; };
  }, [guard, open, refresh]);

  const action = async (operation: "navigate" | "label" | "reload" | "set_tools") => {
    if (!view || busy) return;
    if (operation !== "reload" && operation !== "set_tools" && !selectedId) return;
    if (operation === "navigate") {
      try { beforeNavigate(); }
      catch (cause) { editState(current => ({ ...current,
        error: cause instanceof Error ? cause.message : String(cause) })); return; }
    }
    const actionTarget = { ...target };
    const ticket = guard.begin(targetKey);
    if (operation === "navigate") navigation.current = { ticket, target: actionTarget };
    write(ticket, current => ({ ...current, busy: operation, error: null }));
    try {
      const intent = operation === "reload" ? { operation } as const
        : operation === "set_tools" ? { operation, names: selectedTools } as const
          : operation === "label" ? { operation, targetId: selectedId!, label: label.trim() || null } as const
            : { operation, targetId: selectedId!, summarize } as const;
      const next = await zcodeAgentService.runPiControlTree({ ...actionTarget,
        action: { ...intent, sessionId: actionTarget.sessionId, generation: view.info.generation } });
      if (guard.isCurrent(ticket)) {
        write(ticket, current => ({ ...current, view: next, selectedTools: next.activeTools }));
        if (operation === "navigate" && next.result?.editorText !== undefined && !next.result.cancelled) {
          const editorText = next.result.editorText;
          write(ticket, current => ({ ...current, pendingText: editorText }));
          onRestoredText(editorText);
          write(ticket, current => ({ ...current, pendingText: null }));
          setOpen(false);
        }
      }
    } catch (cause) {
      if (guard.isCurrent(ticket)) {
        write(ticket, current => ({ ...current, error: cause instanceof Error ? cause.message : String(cause) }));
        try {
          const current = await zcodeAgentService.readPiControlTree(actionTarget);
          write(ticket, previous => ({ ...previous, view: current, selectedTools: current.activeTools }));
        } catch { /* Keep the first error. */ }
      }
    } finally {
      if (navigation.current?.ticket === ticket) navigation.current = null;
      write(ticket, current => ({ ...current, busy: null }));
    }
  };

  const branch = async (operation: "fork" | "clone") => {
    if (!view || busy || (operation === "fork" && !selectedId)) return;
    try { beforeNavigate(); }
    catch (cause) { editState(current => ({ ...current,
      error: cause instanceof Error ? cause.message : String(cause) })); return; }
    const ticket = guard.begin(targetKey);
    write(ticket, current => ({ ...current, busy: "branch", error: null }));
    try {
      const created = await onBranch(operation, operation === "fork" ? selectedId! : undefined);
      if (guard.isCurrent(ticket)) {
        if (created) setOpen(false);
        else write(ticket, current => ({ ...current, error: "Pi 扩展取消了分支操作；原会话保持不变。" }));
      }
    } catch (cause) {
      write(ticket, current => ({ ...current, error: cause instanceof Error ? cause.message : String(cause) }));
    } finally { write(ticket, current => ({ ...current, busy: null })); }
  };

  const retry = async () => {
    if (!view || busy || !selectedId) return;
    try { beforeNavigate(); }
    catch (cause) { editState(current => ({ ...current,
      error: cause instanceof Error ? cause.message : String(cause) })); return; }
    const retryTarget = { ...target };
    const ticket = guard.begin(targetKey);
    write(ticket, current => ({ ...current, busy: "retry", error: null }));
    try {
      const started = await onRetry(selectedId);
      if (guard.isCurrent(ticket)) {
        if (started) setOpen(false);
        else write(ticket, current => ({ ...current, error: "Pi 扩展取消了重试；原分支保持不变。" }));
      }
    } catch (cause) {
      if (guard.isCurrent(ticket)) {
        write(ticket, current => ({ ...current, error: cause instanceof Error ? cause.message : String(cause) }));
        try {
          const current = await zcodeAgentService.readPiControlTree(retryTarget);
          write(ticket, previous => ({ ...previous, view: current, selectedTools: current.activeTools }));
        } catch { /* Preserve the retry error; a later refresh can inspect Pi state. */ }
      }
    } finally { write(ticket, current => ({ ...current, busy: null })); }
  };

  const cancelNavigation = async () => {
    if (busy !== "navigate") return;
    const active = navigation.current;
    const cancelTarget = active && guard.isCurrent(active.ticket) ? active.target : target;
    const ticket = guard.begin(targetKey);
    navigation.current = null;
    try { await zcodeAgentService.cancelPiTreeNavigation(cancelTarget); }
    catch (cause) {
      write(ticket, current => ({ ...current, error: cause instanceof Error ? cause.message : String(cause) }));
    } finally { write(ticket, current => ({ ...current, busy: null })); }
  };

  const changeOpen = (next: boolean) => {
    if (!next && (busy === "navigate" || busy === "branch" || busy === "retry")) return;
    if (!next) {
      guard.invalidate();
      navigation.current = null;
      editState(current => ({ ...current, busy: null }));
    }
    setOpen(next);
  };

  return <>
    <Button type="button" variant="outline" size="icon-md" title="Pi 会话树" aria-label="Pi 会话树"
      className="pointer-events-auto bg-[var(--color-popover)] shadow-md"
      onClick={() => setOpen(true)} data-testid="pi-tree-open">
      <GitBranch className="size-4" />
    </Button>
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent data-testid="pi-tree-dialog" data-generation={view?.info.generation ?? ""}
        className="max-h-[85vh] max-w-[min(56rem,calc(100vw-2rem))] overflow-hidden">
        <DialogHeader>
          <DialogTitle>Pi 会话树</DialogTitle>
          <DialogDescription>读取当前 Pi 会话的真实历史；选择节点后可跳转、分支、设置书签或重载扩展。</DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2 text-xs text-foreground-subtle">
          <span>Pi {view?.info.piVersion ?? "…"} · Bridge {view?.info.bridgeVersion ?? "…"}</span>
          <Button type="button" variant="outline" size="sm" disabled={busy !== null} onClick={() => void refresh()}>
            <RefreshCw className="size-3" /> 刷新
          </Button>
          <Button type="button" variant="outline" size="sm" disabled={busy !== null || !view}
            onClick={() => void action("reload")}>重载扩展</Button>
        </div>
        {error ? <p role="alert" className="text-destructive">{error}</p> : null}
        {pendingText !== null ? <div className="space-y-2">
          <p>Pi 已跳转。以下文本还需恢复到输入框：</p>
          <textarea readOnly value={pendingText} className="h-24 w-full rounded border border-border bg-background p-2" />
          <Button type="button" variant="outline" size="sm" onClick={() => {
            try { onRestoredText(pendingText); editState(current => ({ ...current, pendingText: null, error: null }));
              setOpen(false); }
            catch (cause) { editState(current => ({ ...current,
              error: cause instanceof Error ? cause.message : String(cause) })); }
          }}>恢复到输入框</Button>
        </div> : null}
        <div className="min-h-0 max-h-[45vh] overflow-auto rounded-md border border-border" role="tree" aria-label="Pi 会话历史">
          {rows.length === 0 ? <p className="p-3 text-foreground-subtle">{busy === "load" ? "正在读取…" : "暂无历史节点"}</p> : null}
          {rows.map(({ node, depth }) => <button type="button" key={node.entry.id} role="treeitem"
            aria-selected={selectedId === node.entry.id} onClick={() => { setSelectedId(node.entry.id); setLabel(node.label ?? ""); }}
            className={`block w-full truncate px-3 py-1.5 text-left hover:bg-surface-hover ${selectedId === node.entry.id ? "bg-surface-hover" : ""}`}
            style={{ paddingLeft: `${12 + depth * 18}px` }}>
            {node.entry.id === view?.leafId ? "● " : ""}{entryTitle(node)}
          </button>)}
        </div>
        {selected ? <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="pi-tree-label">书签</label>
          <input id="pi-tree-label" className="min-w-0 flex-1 rounded border border-border bg-background px-2 py-1"
            value={label} onChange={event => setLabel(event.target.value)} maxLength={500} disabled={busy !== null} />
          <Button type="button" variant="outline" size="sm" disabled={busy !== null} onClick={() => void action("label")}>保存标签</Button>
        </div> : null}
        <details className="rounded-md border border-border px-3 py-2 text-sm" data-testid="pi-tools-section">
          <summary className="cursor-pointer">Pi 工具（当前启用 {view?.activeTools.length ?? 0} 项）</summary>
          <p className="mt-2 text-xs text-foreground-subtle">工具目录与启用状态直接读取当前 Pi 会话；保存后再从 Pi 读回。</p>
          <div className="mt-2 max-h-36 space-y-1 overflow-auto">
            {view?.tools.map(tool => <label key={tool.name} className="flex items-start gap-2 rounded px-1 py-1 hover:bg-surface-hover">
              <input type="checkbox" className="mt-0.5" checked={selectedTools.includes(tool.name)}
                disabled={busy !== null} onChange={event => setSelectedTools(current => event.target.checked
                  ? [...current, tool.name] : current.filter(name => name !== tool.name))} />
              <span className="min-w-0"><strong>{tool.name}</strong><span className="ml-2 text-xs text-foreground-subtle">{tool.description}</span></span>
            </label>)}
          </div>
          <Button type="button" variant="outline" size="sm" className="mt-2" disabled={busy !== null || !view ||
            selectedTools.length === view.activeTools.length && selectedTools.every(name => view.activeTools.includes(name))}
          onClick={() => void action("set_tools")}>保存启用工具</Button>
        </details>
        <div className="flex items-center justify-end gap-2">
          <label className="mr-auto flex items-center gap-1 text-xs"><input type="checkbox" checked={summarize}
            onChange={event => setSummarize(event.target.checked)} disabled={busy !== null} />跳转时总结上下文</label>
          {busy === "navigate" ? <Button type="button" variant="outline" size="sm"
            onClick={() => void cancelNavigation()}>停止跳转</Button> : null}
          <Button type="button" variant="outline" disabled={busy !== null || !view?.leafId}
            data-testid="pi-tree-clone" onClick={() => void branch("clone")}>克隆当前分支</Button>
          <Button type="button" variant="outline" disabled={busy !== null || selected?.entry.type !== "message" ||
            selected.entry.message.role !== "user"} data-testid="pi-tree-fork"
          onClick={() => void branch("fork")}>从此用户消息分支</Button>
          <Button type="button" variant="outline" disabled={busy !== null || selected?.entry.type !== "message" ||
            selected.entry.message.role !== "user" || selected.entry.id === view?.leafId}
            data-testid="pi-tree-retry" onClick={() => void retry()}>从此输入重试</Button>
          <Button type="button" disabled={!selected || busy !== null || selected.entry.type === "message" &&
            selected.entry.message.role === "user" && selected.entry.id === view?.leafId}
            onClick={() => void action("navigate")}>{selected?.entry.type === "message" &&
            selected.entry.message.role === "user" ? "编辑此输入" : "跳转到节点"}</Button>
        </div>
      </DialogContent>
    </Dialog>
  </>;
}
