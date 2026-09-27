import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Boxes, RefreshCw } from "lucide-react";
import type { IServiceAccessor } from "@zcode/services";
import { Button } from "@/components/ui/button.js";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog.js";
import { useServices } from "@/hooks/useServices.js";

type RouterView = Awaited<ReturnType<IServiceAccessor["zcodeAgentService"]["readPiLlamaRouter"]>>;
type RouterAction = Parameters<IServiceAccessor["zcodeAgentService"]["runPiLlamaRouter"]>[0]["action"];

const statusName: Record<string, string> = {
  loaded: "已加载", loading: "加载中", unloaded: "未加载", downloading: "下载中", sleeping: "休眠中",
};

export function PiLlamaRouterDialog({ sessionId, workspacePath, workspaceIdentity, remoteSessionId }: {
  sessionId: string;
  workspacePath: string;
  workspaceIdentity?: string;
  remoteSessionId?: string | null;
}) {
  const { zcodeAgentService } = useServices();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<RouterView | null>(null);
  const [busy, setBusy] = useState<RouterAction | { kind: "refresh"; modelId: string } | null>(null);
  const [progress, setProgress] = useState<{ modelId: string; message: string; ratio?: number } | null>(null);
  const [downloadId, setDownloadId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const cancelled = useRef(false);
  const target = useMemo(() => ({ sessionId, workspacePath,
    ...(workspaceIdentity ? { workspaceIdentity } : {}),
    ...(remoteSessionId ? { remoteSessionId } : {}) }),
  [sessionId, workspacePath, workspaceIdentity, remoteSessionId]);

  const refresh = useCallback(async () => {
    setBusy({ kind: "refresh", modelId: "" }); setError(null);
    try { setView(await zcodeAgentService.readPiLlamaRouter(target)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(null); }
  }, [target, zcodeAgentService]);

  useEffect(() => { if (open) void refresh(); }, [open, refresh]);
  useEffect(() => {
    if (!open) return;
    const subscription = zcodeAgentService.onPiLlamaRouterProgress(event => {
      if (event.sessionId !== sessionId) return;
      setProgress({ modelId: event.modelId, ...event.progress });
    });
    return () => subscription.dispose();
  }, [open, sessionId, zcodeAgentService]);

  const act = async (action: RouterAction) => {
    if (busy) return;
    cancelled.current = false; setError(null); setProgress(null); setBusy(action);
    try {
      setView(await zcodeAgentService.runPiLlamaRouter({ ...target, action }));
      if (action.kind === "download") setDownloadId("");
    } catch (cause) {
      if (!cancelled.current) setError(cause instanceof Error ? cause.message : String(cause));
      try { setView(await zcodeAgentService.readPiLlamaRouter(target)); } catch { /* Keep operation error. */ }
    } finally { setBusy(null); setProgress(null); }
  };

  const cancel = async () => {
    if (!busy || busy.kind === "refresh") return;
    cancelled.current = true;
    try { setView(await zcodeAgentService.cancelPiLlamaRouter({ ...target, modelId: busy.modelId })); }
    catch (cause) { cancelled.current = false; setError(cause instanceof Error ? cause.message : String(cause)); }
  };

  return <>
    <Button type="button" variant="outline" size="icon-md" title="llama.cpp 模型" aria-label="llama.cpp 模型"
      className="pointer-events-auto bg-[var(--color-popover)] shadow-md" onClick={() => setOpen(true)}
      data-testid="pi-llama-router-open"><Boxes className="size-4" /></Button>
    <Dialog open={open} onOpenChange={next => setOpen(next)}>
      <DialogContent data-testid="pi-llama-router-dialog"
        className="max-h-[85vh] max-w-[min(54rem,calc(100vw-2rem))] overflow-hidden">
        <DialogHeader>
          <DialogTitle>llama.cpp router 模型</DialogTitle>
          <DialogDescription>由 Pi 0.87.0 的 llama.cpp provider 负责认证、模型目录与推理。这里显示 router 的实时状态。</DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2 text-xs text-foreground-subtle">
          <span className="min-w-0 truncate" title={view?.serverUrl}>{view?.serverUrl ?? "请先配置 Pi llama.cpp 登录或 LLAMA_BASE_URL"}</span>
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
              onClick={() => void zcodeAgentService.cancelPiLlamaRouter({ ...target, modelId: model.id })
                .then(setView).catch(cause => setError(String(cause)))}>取消</Button> : null}
          </div>)}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="pi-llama-download-id" className="text-sm">下载 Hugging Face GGUF</label>
          <input id="pi-llama-download-id" value={downloadId} onChange={event => setDownloadId(event.target.value)}
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
