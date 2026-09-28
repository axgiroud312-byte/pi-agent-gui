import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Boxes, RefreshCw } from "lucide-react";
import type { IServiceAccessor } from "@zcode/services";
import { Button } from "@/components/ui/button.js";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog.js";
import { useServices } from "@/hooks/useServices.js";
import { PiSessionDialogGuard, type PiSessionDialogTicket } from "@/v4/piSessionDialogGuard.js";

type RouterView = Awaited<ReturnType<IServiceAccessor["zcodeAgentService"]["readPiLlamaRouter"]>>;
type RouterAction = Parameters<IServiceAccessor["zcodeAgentService"]["runPiLlamaRouter"]>[0]["action"];
type RouterTarget = Parameters<IServiceAccessor["zcodeAgentService"]["readPiLlamaRouter"]>[0];
type RouterBusy = RouterAction | { kind: "refresh"; modelId: string };
interface RouterUiState {
  scope: number;
  view: RouterView | null;
  busy: RouterBusy | null;
  progress: { modelId: string; message: string; ratio?: number } | null;
  downloadId: string;
  error: string | null;
}
const emptyState = (scope: number): RouterUiState => ({ scope, view: null, busy: null,
  progress: null, downloadId: "", error: null });

const statusName: Record<string, string> = {
  loaded: "已加载", loading: "加载中", unloaded: "未加载", downloading: "下载中", sleeping: "休眠中",
};

export function PiLlamaRouterDialog({ sessionId, workspacePath, workspaceIdentity, remoteSessionId,
  onModelsChanged }: {
  sessionId: string;
  workspacePath: string;
  workspaceIdentity?: string;
  remoteSessionId?: string | null;
  onModelsChanged?: () => Promise<void> | void;
}) {
  const { zcodeAgentService } = useServices();
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<RouterUiState>(() => emptyState(0));
  const guard = useRef(new PiSessionDialogGuard()).current;
  const operation = useRef<{ ticket: PiSessionDialogTicket; target: RouterTarget; action: RouterAction } | null>(null);
  const target = useMemo(() => ({ sessionId, workspacePath,
    ...(workspaceIdentity ? { workspaceIdentity } : {}),
    ...(remoteSessionId ? { remoteSessionId } : {}) }),
  [sessionId, workspacePath, workspaceIdentity, remoteSessionId]);
  const targetKey = JSON.stringify([sessionId, workspacePath, workspaceIdentity, remoteSessionId]);
  const scope = guard.syncContext(targetKey);
  const { view, busy, progress, downloadId, error } = state.scope === scope ? state : emptyState(scope);

  const write = useCallback((ticket: PiSessionDialogTicket, update: (current: RouterUiState) => RouterUiState) => {
    if (!guard.isCurrent(ticket)) return;
    setState(current => guard.isCurrent(ticket)
      ? update(current.scope === ticket.scope ? current : emptyState(ticket.scope)) : current);
  }, [guard]);

  const refresh = useCallback(async () => {
    const ticket = guard.begin(targetKey);
    write(ticket, current => ({ ...current, view: null, busy: { kind: "refresh", modelId: "" },
      progress: null, error: null }));
    try {
      const next = await zcodeAgentService.readPiLlamaRouter(target);
      write(ticket, current => ({ ...current, view: next }));
    } catch (cause) {
      write(ticket, current => ({ ...current, error: cause instanceof Error ? cause.message : String(cause) }));
    } finally { write(ticket, current => ({ ...current, busy: null })); }
  }, [guard, target, targetKey, write, zcodeAgentService]);

  useEffect(() => {
    if (open) void refresh();
    return () => { guard.invalidate(); operation.current = null; };
  }, [guard, open, refresh]);
  useEffect(() => {
    if (!open) return;
    const subscription = zcodeAgentService.onPiLlamaRouterProgress(event => {
      const active = operation.current;
      if (!active || !guard.isCurrent(active.ticket) || event.sessionId !== active.target.sessionId ||
        event.modelId !== active.action.modelId || event.action !== active.action.kind) return;
      write(active.ticket, current => ({ ...current,
        progress: { modelId: event.modelId, ...event.progress } }));
    });
    return () => subscription.dispose();
  }, [guard, open, write, zcodeAgentService]);

  const act = async (action: RouterAction) => {
    if (busy || operation.current && guard.isCurrent(operation.current.ticket)) return;
    const actionTarget = { ...target };
    const ticket = guard.begin(targetKey);
    operation.current = { ticket, target: actionTarget, action };
    write(ticket, current => ({ ...current, busy: action, error: null, progress: null }));
    try {
      const next = await zcodeAgentService.runPiLlamaRouter({ ...actionTarget, action });
      if (guard.isCurrent(ticket)) {
        write(ticket, current => ({ ...current, view: next,
          downloadId: action.kind === "download" ? "" : current.downloadId }));
        await onModelsChanged?.();
      }
    } catch (cause) {
      if (guard.isCurrent(ticket)) {
        write(ticket, current => ({ ...current, error: cause instanceof Error ? cause.message : String(cause) }));
        try {
          const next = await zcodeAgentService.readPiLlamaRouter(actionTarget);
          write(ticket, current => ({ ...current, view: next }));
        } catch { /* Keep operation error. */ }
      }
    } finally {
      if (operation.current?.ticket === ticket) operation.current = null;
      write(ticket, current => ({ ...current, busy: null, progress: null }));
    }
  };

  const cancel = async () => {
    if (!busy || busy.kind === "refresh") return;
    const active = operation.current;
    const cancelTarget = active && guard.isCurrent(active.ticket) ? active.target : target;
    const modelId = active && guard.isCurrent(active.ticket) ? active.action.modelId : busy.modelId;
    const ticket = guard.begin(targetKey);
    operation.current = null;
    try {
      const next = await zcodeAgentService.cancelPiLlamaRouter({ ...cancelTarget, modelId });
      if (guard.isCurrent(ticket)) {
        write(ticket, current => ({ ...current, view: next }));
        await onModelsChanged?.();
      }
    } catch (cause) {
      write(ticket, current => ({ ...current, error: cause instanceof Error ? cause.message : String(cause) }));
      try {
        const next = await zcodeAgentService.readPiLlamaRouter(cancelTarget);
        write(ticket, current => ({ ...current, view: next }));
      } catch {
        // The previous view may say "unloaded" while the router is still
        // loading. Hide it until an explicit refresh can read the real state.
        write(ticket, current => ({ ...current, view: null }));
      }
    } finally { write(ticket, current => ({ ...current, busy: null, progress: null })); }
  };

  const cancelExternal = async (modelId: string) => {
    if (busy) return;
    const cancelTarget = { ...target };
    const ticket = guard.begin(targetKey);
    write(ticket, current => ({ ...current, busy: { kind: "refresh", modelId }, error: null }));
    try {
      const next = await zcodeAgentService.cancelPiLlamaRouter({ ...cancelTarget, modelId });
      if (guard.isCurrent(ticket)) {
        write(ticket, current => ({ ...current, view: next }));
        await onModelsChanged?.();
      }
    } catch (cause) {
      write(ticket, current => ({ ...current, error: cause instanceof Error ? cause.message : String(cause) }));
      try {
        const next = await zcodeAgentService.readPiLlamaRouter(cancelTarget);
        write(ticket, current => ({ ...current, view: next }));
      } catch { write(ticket, current => ({ ...current, view: null })); }
    } finally { write(ticket, current => ({ ...current, busy: null })); }
  };

  const changeOpen = (next: boolean) => {
    if (!next) {
      guard.invalidate();
      operation.current = null;
      setState(emptyState(scope));
    }
    setOpen(next);
  };

  return <>
    <Button type="button" variant="outline" size="icon-md" title="llama.cpp 模型" aria-label="llama.cpp 模型"
      className="pointer-events-auto bg-[var(--color-popover)] shadow-md" onClick={() => setOpen(true)}
      data-testid="pi-llama-router-open"><Boxes className="size-4" /></Button>
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent data-testid="pi-llama-router-dialog"
        className="max-h-[85vh] max-w-[min(54rem,calc(100vw-2rem))] overflow-hidden">
        <DialogHeader>
          <DialogTitle>llama.cpp router 模型</DialogTitle>
          <DialogDescription>由 Pi 0.87.0 的 llama.cpp provider 负责认证、模型目录与推理。这里显示 router 的实时状态。</DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2 text-xs text-foreground-subtle">
          <span className="min-w-0 truncate" title={view?.serverUrl}>{view?.serverUrl ??
            (error ? "router 状态未知，请刷新" : "请先配置 Pi llama.cpp 登录或 LLAMA_BASE_URL")}</span>
          <Button type="button" variant="outline" size="sm" disabled={busy !== null} onClick={() => void refresh()}>
            <RefreshCw className="size-3" />刷新</Button>
        </div>
        {view?.modelsAutoload ? <p className="text-xs text-foreground-subtle">router 已启用 autoload，未加载的 preset 也可在 Pi 模型选择中使用。</p> : null}
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        <div className="min-h-0 max-h-[45vh] overflow-auto rounded-md border border-border" role="list" aria-label="llama.cpp 模型列表">
          {view?.models.length === 0 ? <p className="p-3 text-sm text-foreground-subtle">router 暂无模型</p> : null}
          {view?.models.map(model => <div key={model.id} role="listitem" data-model-id={model.id}
            className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2 text-sm last:border-b-0">
            <span className="min-w-0 flex-1 truncate" title={model.id}>{model.id}</span>
            <span data-status={model.status.value} className="text-xs text-foreground-subtle">
              {statusName[model.status.value] ?? model.status.value}{model.source === "preset" ? " · preset" : ""}
              {model.selectableInPi ? " · Pi 可选" : ""}
            </span>
            {model.status.value === "unloaded" ? <Button type="button" variant="outline" size="sm"
              disabled={busy !== null} onClick={() => void act({ kind: "load", modelId: model.id })}>加载</Button> : null}
            {["loaded", "sleeping"].includes(model.status.value) ? <Button type="button" variant="outline" size="sm"
              disabled={busy !== null} onClick={() => void act({ kind: "unload", modelId: model.id })}>卸载</Button> : null}
            {["loading", "downloading"].includes(model.status.value) && !busy ? <Button type="button" variant="outline" size="sm"
              onClick={() => void cancelExternal(model.id)}>取消</Button> : null}
          </div>)}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="pi-llama-download-id" className="text-sm">下载 Hugging Face GGUF</label>
          <input id="pi-llama-download-id" value={downloadId} onChange={event => {
            const value = event.target.value;
            setState(current => ({ ...(current.scope === scope ? current : emptyState(scope)), downloadId: value }));
          }}
            placeholder="org/model:Q4_K_M" className="min-w-0 flex-1 rounded border border-border bg-background px-2 py-1 text-sm"
            disabled={busy !== null} />
          <Button type="button" size="sm" disabled={busy !== null || !downloadId.trim()}
            onClick={() => void act({ kind: "download", modelId: downloadId.trim() })}>下载</Button>
        </div>
        {busy && busy.kind !== "refresh" ? <div className="flex items-center gap-2 text-sm" role="status">
          <span className="min-w-0 flex-1 truncate">{progress?.message ?? `${busy.kind} ${busy.modelId}`}
            {progress?.ratio !== undefined ? ` · ${Math.round(progress.ratio * 100)}%` : ""}</span>
          {busy.kind !== "unload" ? <Button type="button" variant="outline" size="sm" onClick={() => void cancel()}>取消操作</Button> : null}
        </div> : null}
      </DialogContent>
    </Dialog>
  </>;
}
