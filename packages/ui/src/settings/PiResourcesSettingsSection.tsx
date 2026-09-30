import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button.js";
import { useServices } from "@/hooks/useServices.js";
import { PiResourcesDialog } from "@/v4/PiResourcesDialog.js";
import { PiSessionDialogGuard } from "@/v4/piSessionDialogGuard.js";

export function PiResourcesSettingsSection({ workspacePath }: { workspacePath: string }) {
  const { zcodeAgentService } = useServices();
  const guard = useRef(new PiSessionDialogGuard()).current;
  const scope = guard.syncContext(workspacePath);
  const [state, setState] = useState<{ scope: number; sessionId?: string; error?: string; loading?: boolean }>({ scope });
  const current = state.scope === scope ? state : { scope };
  const load = useCallback(async () => {
    if (!workspacePath) return;
    const ticket = guard.begin(workspacePath);
    setState({ scope: ticket.scope, loading: true });
    try {
      // This selects an already-owned Pi child in this exact workspace. Never
      // start a second Agent just to inspect resources or rerun extension factories.
      const view = await zcodeAgentService.readPiAuth({ workspacePath });
      if (guard.isCurrent(ticket)) setState({ scope: ticket.scope, sessionId: view.runtimeCatalogSessionId });
    } catch (error) {
      if (guard.isCurrent(ticket)) setState({ scope: ticket.scope,
        error: error instanceof Error ? error.message : String(error) });
    }
  }, [guard, workspacePath, zcodeAgentService]);
  useEffect(() => { void load(); return () => guard.invalidate(); }, [guard, load]);
  return <div className="flex flex-col gap-3" data-testid="pi-resources-settings-section">
    <p className="text-sm text-muted-foreground">这些入口使用与聊天中“Pi 资源”相同的公开配置接口。Pi 上下文文件承载上下文；旧 Memory 开关和旧插件存储不控制 Pi。</p>
    {current.error ? <p role="alert" className="text-destructive">{current.error}</p> : null}
    {current.loading ? <p role="status">正在读取当前工作区的 Pi 会话…</p> : current.sessionId ? <>
      <p className="break-all text-xs text-muted-foreground">管理当前工作区最近使用的 Pi 会话：{current.sessionId}。其他已运行会话需分别重载；本页不会为检查资源另启 Agent。</p>
      <PiResourcesDialog key={`${workspacePath}:${current.sessionId}`} sessionId={current.sessionId} workspacePath={workspacePath} embedded />
    </> : <div className="flex flex-col gap-2 text-sm">
        <p>{workspacePath ? "请先在此工作区打开或新建 Pi 会话，然后读取资源；不会使用旧配置作替代。" : "请先打开本地项目。"}</p>
        <Button type="button" variant="outline" disabled={!workspacePath} onClick={() => void load()}>读取 Pi 会话</Button>
      </div>}
  </div>;
}

export function PiUnsupportedSettingsSection() {
  return <section className="flex flex-col gap-3" data-testid="pi-unsupported-settings">
    <h3 className="font-semibold">此旧 Agent 配置不适用于 Pi</h3>
    <p className="text-sm text-muted-foreground">Pi 0.87.0 没有这些旧 ZCode 功能的原生配置接口。不会显示可保存但不生效的开关，也不会写入旧配置文件。</p>
    <p className="text-sm text-muted-foreground">MCP、子 Agent、Hook、定时任务或其他业务可由兼容的 Pi 扩展提供；请在“插件”的 Pi 资源中安装和管理扩展，并按扩展自身的实际接口配置。不承诺旧插件零适配。</p>
  </section>;
}
