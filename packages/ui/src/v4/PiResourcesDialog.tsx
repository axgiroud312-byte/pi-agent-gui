import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BookOpen, RefreshCw } from "lucide-react";
import type { IServiceAccessor } from "@zcode/services";
import { Button } from "@/components/ui/button.js";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog.js";
import { useServices } from "@/hooks/useServices.js";
import { PiSessionDialogGuard, type PiSessionDialogTicket } from "@/v4/piSessionDialogGuard.js";

type ResourceView = Awaited<ReturnType<IServiceAccessor["zcodeAgentService"]["readPiControlTree"]>>;
type ResourceAction = Parameters<IServiceAccessor["zcodeAgentService"]["runPiControlTree"]>[0]["action"];
type ResourceFile = { path: string; content: string; hash: string };
interface ResourceUiState {
  contextScope: number;
  view: ResourceView | null;
  busy: boolean;
  error: string | null;
  notice: string | null;
  source: string;
  scope: "user" | "project";
  file: ResourceFile | null;
  draft: string;
  filterSource: string | null;
  filterDraft: string;
  promptKind: "replace" | "append";
  promptText: string;
}
const emptyState = (contextScope: number): ResourceUiState => ({ contextScope, view: null, busy: false,
  error: null, notice: null, source: "", scope: "project", file: null, draft: "",
  filterSource: null, filterDraft: "{}", promptKind: "append", promptText: "" });

function filtersText(configuration: ResourceView["resources"]["packages"][number]["configuration"]): string {
  if (typeof configuration === "string") return "{}";
  const filters: Record<string, unknown> = {};
  for (const key of ["autoload", "extensions", "skills", "prompts", "themes"] as const) {
    if (configuration[key] !== undefined) filters[key] = configuration[key];
  }
  return JSON.stringify(filters, null, 2);
}

function packageUpdateLabel(state: ResourceView["resources"]["packages"][number]["updateState"]): string {
  switch (state) {
    case "pinned-npm": return "固定版本";
    case "offline": return "离线不可更新";
    case "git-ref": return "同步固定 ref";
    case "local": return "本地文件";
    default: return "更新";
  }
}

export function PiResourcesDialog({ sessionId, workspacePath, workspaceIdentity }: {
  sessionId: string;
  workspacePath: string;
  workspaceIdentity?: string;
}) {
  const { zcodeAgentService } = useServices();
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<ResourceUiState>(() => emptyState(0));
  const guard = useRef(new PiSessionDialogGuard()).current;
  const target = useMemo(() => ({ sessionId, workspacePath,
    ...(workspaceIdentity ? { workspaceIdentity } : {}) }), [sessionId, workspacePath, workspaceIdentity]);
  const targetKey = JSON.stringify([sessionId, workspacePath, workspaceIdentity]);
  const contextScope = guard.syncContext(targetKey);
  const { view, busy, error, notice, source, scope, file, draft, filterSource, filterDraft,
    promptKind, promptText } = state.contextScope === contextScope ? state : emptyState(contextScope);
  const editState = (update: (current: ResourceUiState) => ResourceUiState) => {
    setState(current => update(current.contextScope === contextScope ? current : emptyState(contextScope)));
  };
  const setSource = (value: string) => editState(current => ({ ...current, source: value }));
  const setScope = (value: "user" | "project") => editState(current => ({ ...current, scope: value }));
  const setFile = (value: ResourceFile | null) => editState(current => ({ ...current, file: value }));
  const setDraft = (value: string) => editState(current => ({ ...current, draft: value }));
  const setFilterSource = (value: string | null) => editState(current => ({ ...current, filterSource: value }));
  const setFilterDraft = (value: string) => editState(current => ({ ...current, filterDraft: value }));
  const setPromptKind = (value: "replace" | "append") => editState(current => ({ ...current, promptKind: value }));
  const setPromptText = (value: string) => editState(current => ({ ...current, promptText: value }));
  const write = useCallback((ticket: PiSessionDialogTicket,
    update: (current: ResourceUiState) => ResourceUiState) => {
    if (!guard.isCurrent(ticket)) return;
    setState(current => guard.isCurrent(ticket)
      ? update(current.contextScope === ticket.scope ? current : emptyState(ticket.scope)) : current);
  }, [guard]);

  const refresh = useCallback(async () => {
    const ticket = guard.begin(targetKey);
    write(ticket, current => ({ ...current, view: null, busy: true, error: null, notice: null }));
    try {
      const next = await zcodeAgentService.readPiControlTree({ ...target, includeResourceContent: true });
      write(ticket, current => ({ ...current, view: next }));
    } catch (cause) {
      write(ticket, current => ({ ...current, error: cause instanceof Error ? cause.message : String(cause) }));
    } finally { write(ticket, current => ({ ...current, busy: false })); }
  }, [guard, target, targetKey, write, zcodeAgentService]);

  useEffect(() => {
    if (open) void refresh();
    return () => guard.invalidate();
  }, [guard, open, refresh]);

  const act = async (intent: Record<string, unknown>,
    onSuccess?: (next: ResourceView, ticket: PiSessionDialogTicket) => void): Promise<void> => {
    if (!view || busy) return;
    const actionTarget = { ...target };
    const generation = view.info.generation;
    const ticket = guard.begin(targetKey);
    write(ticket, current => ({ ...current, busy: true, error: null }));
    try {
      const next = await zcodeAgentService.runPiControlTree({ ...actionTarget, includeResourceContent: true,
        action: { ...intent, sessionId: actionTarget.sessionId, generation } as ResourceAction });
      if (guard.isCurrent(ticket)) {
        write(ticket, current => ({ ...current, view: next,
          notice: next.info.generation !== generation
            ? "Pi 已重载资源。下一轮使用新资源；已写入的会话历史上下文不会改写。" : current.notice }));
        onSuccess?.(next, ticket);
      }
    } catch (cause) {
      if (guard.isCurrent(ticket)) {
        write(ticket, current => ({ ...current, error: cause instanceof Error ? cause.message : String(cause) }));
        try {
          const current = await zcodeAgentService.readPiControlTree({ ...actionTarget, includeResourceContent: true });
          write(ticket, previous => ({ ...previous, view: current }));
        } catch { /* Keep first error. */ }
      }
    } finally { write(ticket, current => ({ ...current, busy: false })); }
  };

  const edit = async (path: string) => {
    await act({ operation: "resource_read", path }, (next, ticket) => {
      const resource = next.result?.resource;
      if (resource) write(ticket, current => ({ ...current, file: resource, draft: resource.content }));
    });
  };
  const save = async () => {
    if (!file) return;
    await act({ operation: "resource_write", path: file.path,
      expectedHash: file.hash, content: draft }, (_next, ticket) =>
      write(ticket, current => ({ ...current, file: null, draft: "" })));
  };
  const applyFilter = async () => {
    if (!filterSource) return;
    let filters: unknown;
    try { filters = JSON.parse(filterDraft); }
    catch { editState(current => ({ ...current, error: "过滤规则必须是有效 JSON，例如 {\"prompts\": []}" })); return; }
    const pkg = view?.resources.packages.find(item => `${item.scope}:${item.source}` === filterSource);
    if (!pkg) return;
    await act({ operation: "package_filter", source: pkg.source, scope: pkg.scope, filters }, (_next, ticket) =>
      write(ticket, current => ({ ...current, filterSource: null })));
  };
  const createPrompt = async () => {
    await act({ operation: "resource_create", kind: promptKind, scope, content: promptText }, (_next, ticket) =>
      write(ticket, current => ({ ...current, promptText: "" })));
  };

  const changeOpen = (next: boolean) => {
    if (!next && busy) return;
    if (!next) {
      guard.invalidate();
      editState(current => ({ ...current, busy: false }));
    }
    setOpen(next);
  };

  return <>
    <Button type="button" variant="outline" size="icon-md" title="Pi 资源" aria-label="Pi 资源"
      className="pointer-events-auto bg-[var(--color-popover)] shadow-md"
      data-testid="pi-resources-open" onClick={() => setOpen(true)}><BookOpen className="size-4" /></Button>
    <Dialog open={open} onOpenChange={changeOpen}>
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
                  pkg.updateState === "pinned-npm" || pkg.updateState === "offline" || pkg.updateState === "local" ||
                  pkg.updateAdmission.state !== "single"}
                  title={pkg.updateState === "pinned-npm" ? "Pi 固定 npm 版本不会自动更新；要升级请安装明确的新版本" :
                    pkg.updateState === "offline" ? "Pi 当前为离线模式；包未更新" :
                    pkg.updateAdmission.state !== "single" ? "Pi 更新会按包身份匹配配置，无法安全地只更新这一行" :
                    pkg.updateState === "git-ref" ? "Pi 只同步已配置的 Git ref；更换 ref 请重新安装" : undefined}
                  onClick={() => void act({ operation: "package_update", source: pkg.source, scope: pkg.scope })}>
                  {packageUpdateLabel(pkg.updateState)}</Button>
                <Button type="button" variant="outline" size="sm" disabled={busy}
                  onClick={() => void act({ operation: "package_remove", source: pkg.source, scope: pkg.scope })}>卸载</Button></div>
              {pkg.updateState !== "local" && pkg.updateState !== "pinned-npm" &&
                pkg.updateAdmission.state === "multiple" ? <p data-testid="pi-package-update-scope-warning"
                className="text-xs text-foreground-subtle">Pi 更新会同时处理这个包身份在
                  {pkg.updateAdmission.scopes.map(item => item === "user" ? "用户" : "项目").join("、")}
                  作用域中的配置；单行更新已禁用。请先移除重复配置。</p> :
                pkg.updateState !== "local" && pkg.updateState !== "pinned-npm" &&
                pkg.updateAdmission.state === "unknown" ? <p data-testid="pi-package-update-scope-warning"
                  className="text-xs text-foreground-subtle">无法核实 Pi 更新只影响这一项配置；单行更新已禁用。</p> : null}
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
