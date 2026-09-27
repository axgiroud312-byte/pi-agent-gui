import { useCallback, useEffect, useMemo, useState } from "react";
import { BookOpen, RefreshCw } from "lucide-react";
import type { IServiceAccessor } from "@zcode/services";
import { Button } from "@/components/ui/button.js";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog.js";
import { useServices } from "@/hooks/useServices.js";

type ResourceView = Awaited<ReturnType<IServiceAccessor["zcodeAgentService"]["readPiControlTree"]>>;
type ResourceAction = Parameters<IServiceAccessor["zcodeAgentService"]["runPiControlTree"]>[0]["action"];
type ResourceFile = { path: string; content: string; hash: string };

function filtersText(configuration: ResourceView["resources"]["packages"][number]["configuration"]): string {
  if (typeof configuration === "string") return "{}";
  const filters: Record<string, unknown> = {};
  for (const key of ["autoload", "extensions", "skills", "prompts", "themes"] as const) {
    if (configuration[key] !== undefined) filters[key] = configuration[key];
  }
  return JSON.stringify(filters, null, 2);
}

export function PiResourcesDialog({ sessionId, workspacePath, workspaceIdentity }: {
  sessionId: string;
  workspacePath: string;
  workspaceIdentity?: string;
}) {
  const { zcodeAgentService } = useServices();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<ResourceView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [source, setSource] = useState("");
  const [scope, setScope] = useState<"user" | "project">("project");
  const [file, setFile] = useState<ResourceFile | null>(null);
  const [draft, setDraft] = useState("");
  const [filterSource, setFilterSource] = useState<string | null>(null);
  const [filterDraft, setFilterDraft] = useState("{}");
  const [promptKind, setPromptKind] = useState<"replace" | "append">("append");
  const [promptText, setPromptText] = useState("");
  const target = useMemo(() => ({ sessionId, workspacePath,
    ...(workspaceIdentity ? { workspaceIdentity } : {}) }), [sessionId, workspacePath, workspaceIdentity]);

  const refresh = useCallback(async () => {
    setBusy(true); setError(null); setNotice(null);
    try { setView(await zcodeAgentService.readPiControlTree({ ...target, includeResourceContent: true })); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  }, [zcodeAgentService, target]);

  useEffect(() => { if (open) void refresh(); }, [open, refresh]);

  const act = async (intent: Record<string, unknown>): Promise<ResourceView | undefined> => {
    if (!view || busy) return undefined;
    setBusy(true); setError(null);
    try {
      const next = await zcodeAgentService.runPiControlTree({ ...target, includeResourceContent: true,
        action: { ...intent, sessionId, generation: view.info.generation } as ResourceAction });
      setView(next);
      if (next.info.generation !== view.info.generation) {
        setNotice("Pi 已重载资源。下一轮使用新资源；已写入的会话历史上下文不会改写。");
      }
      return next;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      try { setView(await zcodeAgentService.readPiControlTree({ ...target, includeResourceContent: true })); }
      catch { /* Keep first error. */ }
      return undefined;
    } finally { setBusy(false); }
  };

  const edit = async (path: string) => {
    const next = await act({ operation: "resource_read", path });
    if (next?.result?.resource) {
      setFile(next.result.resource);
      setDraft(next.result.resource.content);
    }
  };
  const save = async () => {
    if (!file) return;
    const next = await act({ operation: "resource_write", path: file.path,
      expectedHash: file.hash, content: draft });
    if (next) setFile(null);
  };
  const applyFilter = async () => {
    if (!filterSource) return;
    let filters: unknown;
    try { filters = JSON.parse(filterDraft); }
    catch { setError("过滤规则必须是有效 JSON，例如 {\"prompts\": []}"); return; }
    const pkg = view?.resources.packages.find(item => `${item.scope}:${item.source}` === filterSource);
    if (!pkg) return;
    const next = await act({ operation: "package_filter", source: pkg.source, scope: pkg.scope, filters });
    if (next) setFilterSource(null);
  };
  const createPrompt = async () => {
    const next = await act({ operation: "resource_create", kind: promptKind, scope, content: promptText });
    if (next) setPromptText("");
  };

  return <>
    <Button type="button" variant="outline" size="icon-md" title="Pi 资源" aria-label="Pi 资源"
      className="pointer-events-auto bg-[var(--color-popover)] shadow-md"
      data-testid="pi-resources-open" onClick={() => setOpen(true)}><BookOpen className="size-4" /></Button>
    <Dialog open={open} onOpenChange={next => { if (!busy) setOpen(next); }}>
      <DialogContent data-testid="pi-resources-dialog" data-generation={view?.info.generation ?? ""}
        className="max-h-[90vh] max-w-[min(62rem,calc(100vw-2rem))] overflow-hidden">
        <DialogHeader>
          <DialogTitle>Pi 资源</DialogTitle>
          <DialogDescription>当前会话的真实命令、Skill、上下文及扩展包。保存或管理包后由 Pi 重载；旧历史上下文不会被改写。</DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2 text-xs text-foreground-subtle">
          <span>Pi {view?.info.piVersion ?? "…"} · {view?.resources.projectTrusted ? "项目已信任" : "项目未信任"}</span>
          <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void refresh()}>
            <RefreshCw className="size-3" />刷新</Button>
          <Button type="button" variant="outline" size="sm" disabled={busy || !view}
            onClick={() => void act({ operation: "reload" })}>重载资源</Button>
        </div>
        {error ? <p role="alert" className="text-destructive">{error}</p> : null}
        {notice ? <p role="status" className="text-foreground-subtle">{notice}</p> : null}
        <div className="min-h-0 space-y-4 overflow-auto pr-1 text-sm">
          {view?.resources.diagnostics.map((item, index) => <p key={`${index}:${item}`} role="alert"
            className="rounded border border-destructive p-2 text-destructive">{item}</p>)}
          {file ? <section className="space-y-2 rounded-md border border-border p-3" data-testid="pi-resource-editor">
            <h3 className="font-medium">编辑 {file.path}</h3>
            <textarea value={draft} onChange={event => setDraft(event.target.value)} disabled={busy}
              aria-label="Pi 资源内容" className="h-48 w-full rounded border border-border bg-background p-2 font-mono text-xs" />
            <div className="flex gap-2"><Button type="button" size="sm" disabled={busy} onClick={() => void save()}>保存并重载</Button>
              <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => setFile(null)}>取消</Button></div>
          </section> : null}
          <section className="space-y-2" data-testid="pi-resource-commands">
            <h3 className="font-medium">命令与模板</h3>
            {view?.resources.commands.map(command => <div key={`${command.source}:${command.name}`}
              data-testid="pi-resource-command-row" data-command-name={command.name}
              className="flex items-start gap-2 rounded border border-border p-2">
              <div className="min-w-0 flex-1"><strong>/{command.name}</strong> · {command.source} · {command.sourceInfo.scope}
                <p className="truncate text-xs text-foreground-subtle">{command.description} · {command.sourceInfo.path}</p></div>
              {command.source === "prompt" && command.sourceInfo.origin === "top-level" ?
                <Button type="button" variant="outline" size="sm" disabled={busy}
                  onClick={() => void edit(command.sourceInfo.path)}>编辑</Button> : null}
            </div>)}
          </section>
          <section className="space-y-2" data-testid="pi-resource-skills">
            <h3 className="font-medium">Skills</h3>
            <p className="text-xs text-foreground-subtle">Skill 斜杠命令：{view?.resources.skillCommandsEnabled ? "已开启" : "已关闭"}</p>
            {view?.resources.skills.map(skill => <div key={skill.filePath}
              className="flex items-start gap-2 rounded border border-border p-2">
              <div className="min-w-0 flex-1"><strong>{skill.name}</strong> · {skill.sourceInfo.scope}
                <p className="truncate text-xs text-foreground-subtle">{skill.description} · {skill.filePath}</p></div>
              {skill.sourceInfo.origin === "top-level" ? <Button type="button" variant="outline" size="sm"
                disabled={busy} onClick={() => void edit(skill.filePath)}>编辑</Button> : null}
              </div>)}
          </section>
          <section className="space-y-2" data-testid="pi-resource-availability">
            <h3 className="font-medium">资源启停</h3>
            {view?.resources.availableResources.filter(item => item.kind === "skill" || item.kind === "prompt")
              .map(item => <div key={`${item.kind}:${item.path}`} data-testid="pi-resource-availability-row"
                className="flex items-center gap-2 rounded border border-border p-2">
                <span className="min-w-0 flex-1 truncate">{item.kind === "skill" ? "Skill" : "模板"} ·
                  {item.sourceInfo.scope} · {item.enabled ? "已加载" : "已停用"} · {item.path}</span>
                {item.sourceInfo.origin === "top-level" && item.sourceInfo.scope !== "temporary" ?
                  <Button type="button" variant="outline" size="sm"
                  disabled={busy} onClick={() => void act({ operation: "resource_toggle", kind: item.kind,
                    path: item.path, enabled: !item.enabled })}>{item.enabled ? "停用" : "启用"}</Button> : null}
              </div>)}
          </section>
          <section className="space-y-2" data-testid="pi-resource-context">
            <h3 className="font-medium">上下文与系统提示</h3>
            {view?.resources.contextFiles.map(context => <div key={context.path} className="flex items-center gap-2 rounded border border-border p-2">
              <span className="min-w-0 flex-1 truncate">{context.path}</span>
              <Button type="button" variant="outline" size="sm" disabled={busy}
                onClick={() => void edit(context.path)}>编辑</Button></div>)}
            {view?.resources.systemPromptFiles.map(prompt => <div key={prompt.path} className="flex items-center gap-2 rounded border border-border p-2">
              <span className="min-w-0 flex-1 truncate">{prompt.kind === "replace" ? "替换" : "追加"} · {prompt.scope} · {prompt.path}
                {prompt.active ? " · 当前生效" : " · 当前未生效"}</span>
              <Button type="button" variant="outline" size="sm" disabled={busy}
                onClick={() => void edit(prompt.path)}>编辑</Button></div>)}
            <div className="rounded border border-border p-2 text-xs">
              <p>当前替换提示：{view?.resources.customSystemPrompt ?? "使用 Pi 默认系统提示"}</p>
              <p>当前追加提示：{view?.resources.appendSystemPrompt || "无"}</p>
              <details className="mt-2"><summary className="cursor-pointer">查看当前完整系统提示</summary>
                <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words">
                  {view?.resources.effectiveSystemPrompt}</pre></details>
            </div>
            <div className="flex flex-wrap gap-2">
              <select aria-label="系统提示类型" value={promptKind} onChange={event => setPromptKind(event.target.value as "replace" | "append")}
                className="rounded border border-border bg-background px-2">
                <option value="replace">替换 SYSTEM.md</option><option value="append">追加 APPEND_SYSTEM.md</option>
              </select>
              <select aria-label="系统提示作用域" value={scope} onChange={event => setScope(event.target.value as "user" | "project")}
                className="rounded border border-border bg-background px-2">
                <option value="project">项目</option><option value="user">用户</option>
              </select>
            </div>
            <textarea aria-label="新系统提示内容" value={promptText} onChange={event => setPromptText(event.target.value)}
              className="h-20 w-full rounded border border-border bg-background p-2" />
            <Button type="button" size="sm" disabled={busy || !view || scope === "project" && !view.resources.projectTrusted ||
              view.resources.systemPromptFiles.some(item => item.scope === scope && item.kind === promptKind)}
              onClick={() => void createPrompt()}>创建并重载</Button>
          </section>
          <section className="space-y-2" data-testid="pi-resource-packages">
            <h3 className="font-medium">扩展包</h3>
            {view?.resources.packages.map(pkg => <div key={`${pkg.scope}:${pkg.source}`}
              data-testid="pi-resource-package-row" data-package-source={pkg.source}
              className="space-y-2 rounded border border-border p-2">
              <div className="flex flex-wrap items-center gap-2"><span className="min-w-0 flex-1 break-all">{pkg.scope} · {pkg.source}
                {pkg.filtered ? " · 已过滤" : ""}</span>
                <Button type="button" variant="outline" size="sm" disabled={busy}
                  onClick={() => { setFilterSource(`${pkg.scope}:${pkg.source}`); setFilterDraft(filtersText(pkg.configuration)); }}>过滤</Button>
                <Button type="button" variant="outline" size="sm" disabled={busy ||
                  !/^(?:npm:|git:|https?:\/\/|ssh:\/\/)/.test(pkg.source)}
                  onClick={() => void act({ operation: "package_update", source: pkg.source, scope: pkg.scope })}>更新</Button>
                <Button type="button" variant="outline" size="sm" disabled={busy}
                  onClick={() => void act({ operation: "package_remove", source: pkg.source, scope: pkg.scope })}>卸载</Button></div>
              {filterSource === `${pkg.scope}:${pkg.source}` ? <div className="space-y-2">
                <p className="text-xs text-foreground-subtle">按 Pi 包过滤规则编辑 JSON；空数组关闭一类资源，空对象恢复默认。</p>
                <textarea aria-label="Pi 包过滤规则" value={filterDraft} onChange={event => setFilterDraft(event.target.value)}
                  className="h-24 w-full rounded border border-border bg-background p-2 font-mono text-xs" />
                <div className="flex gap-2"><Button type="button" size="sm" disabled={busy} onClick={() => void applyFilter()}>应用并重载</Button>
                  <Button type="button" variant="outline" size="sm" onClick={() => setFilterSource(null)}>取消</Button></div>
              </div> : null}
            </div>)}
            <div className="flex flex-wrap gap-2">
              <input aria-label="Pi 包来源" value={source} onChange={event => setSource(event.target.value)}
                placeholder="npm:pkg@1.0.0、git:…@ref 或本地路径" className="min-w-48 flex-1 rounded border border-border bg-background px-2" />
              <select aria-label="Pi 包作用域" value={scope} onChange={event => setScope(event.target.value as "user" | "project")}
                className="rounded border border-border bg-background px-2"><option value="project">项目</option><option value="user">用户</option></select>
              <Button type="button" size="sm" disabled={busy || !view || !source.trim() ||
                scope === "project" && !view.resources.projectTrusted}
                onClick={() => void act({ operation: "package_install", source: source.trim(), scope })}>安装并重载</Button>
            </div>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  </>;
}
