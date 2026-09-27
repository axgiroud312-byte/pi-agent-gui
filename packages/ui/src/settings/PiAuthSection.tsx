import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { IZCodeAgentService } from "@zcode/services";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import { usePlatform } from "@/hooks/usePlatform.js";
import { PI_AUTH_CATALOG_CHANGED_EVENT } from "@/lib/piAuthCatalogEvent.js";

type AuthView = Awaited<ReturnType<IZCodeAgentService["readPiAuth"]>>;
type AuthAction = Parameters<IZCodeAgentService["startPiAuth"]>[0]["action"];
type AuthMethod = NonNullable<Parameters<IZCodeAgentService["startPiAuth"]>[0]["method"]>;
const READ_ERROR = "无法读取本地 Pi 认证状态，请检查 Pi 配置后重试。";

/** Pi-specific content inside the original native model-provider Settings tab. */
export function PiAuthSection({ service, workspacePath }: { service: IZCodeAgentService; workspacePath: string }) {
  const platform = usePlatform();
  const [view, setView] = useState<AuthView | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const lastCatalogSignature = useRef<string | null>(null);

  useEffect(() => {
    if (!workspacePath) return;
    let live = true;
    const read = async () => {
      try {
        const next = await service.readPiAuth({ workspacePath });
        if (live) {
          const signature = JSON.stringify({ generation: next.generation, catalogError: next.catalogError,
            providers: next.providers.map(provider => [provider.id, provider.configured,
              provider.modelCount, provider.source, provider.storedType]),
            operations: next.operations.map(operation => [operation.id, operation.outcome]) });
          if (lastCatalogSignature.current !== null && signature !== lastCatalogSignature.current) {
            window.dispatchEvent(new Event(PI_AUTH_CATALOG_CHANGED_EVENT));
          }
          lastCatalogSignature.current = signature;
          setView(next);
          setError(current => current === READ_ERROR ? "" : current);
        }
      } catch {
        if (live) setError(READ_ERROR);
      }
    };
    void read();
    const timer = setInterval(() => { void read(); }, 500);
    return () => { live = false; clearInterval(timer); };
  }, [service, workspacePath]);

  const selected = useMemo(() => view?.providers.find(provider => provider.id === selectedId) ??
    view?.providers.find(provider => provider.configured) ?? view?.providers[0], [view, selectedId]);
  const operation = [...(view?.operations ?? [])].reverse().find(item => item.providerId === selected?.id);
  const running = operation?.outcome === "running" || operation?.outcome === "waiting";
  const providers = useMemo(() => (view?.providers ?? []).filter(provider =>
    `${provider.name} ${provider.id}`.toLowerCase().includes(filter.toLowerCase())), [filter, view]);

  const perform = useCallback(async (task: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await task();
      if (workspacePath) setView(await service.readPiAuth({ workspacePath }));
    } catch {
      // Provider failures and callback payloads may contain credentials. The
      // service gives a safe state; raw exceptions never enter the renderer UI.
      setError("Pi 认证请求未完成，请刷新状态或重试。");
    } finally { setBusy(false); }
  }, [service, workspacePath]);

  const start = (action: AuthAction, method?: AuthMethod) => {
    if (!view || !selected || !workspacePath) return;
    setAnswer("");
    void perform(() => service.startPiAuth({ workspacePath, generation: view.generation,
      providerId: selected.id, action, ...(method ? { method } : {}) }));
  };
  const answerPrompt = (promptId: string, value: string) => {
    if (!view || !operation || !workspacePath) return;
    setAnswer("");
    void perform(() => service.answerPiAuth({ workspacePath, generation: view.generation,
      operationId: operation.id, promptId, value }));
  };
  const cancel = () => {
    if (!view || !operation || !workspacePath) return;
    setAnswer("");
    void perform(() => service.cancelPiAuth({ workspacePath, generation: view.generation,
      operationId: operation.id }));
  };

  if (!workspacePath) return <p className="text-ui-base text-foreground-subtle">先打开本地项目，再管理该项目使用的 Pi 认证。</p>;
  return <div className="space-y-4" data-testid="pi-auth-section">
    <div className="flex items-start justify-between gap-3">
      <div>
        <h2 className="text-ui-lg font-medium">Pi 提供商与认证</h2>
        <p className="text-ui-sm text-foreground-subtle">管理固定 Pi 0.87.0 使用的本地凭据。保存或解析成功不代表在线模型推理已通过。</p>
        {view ? <p className="text-ui-xs text-foreground-subtle">配置位置：{view.agentDir}</p> : null}
        {view?.catalogError ? <p role="alert" className="text-ui-sm text-destructive">
          Pi 模型目录或认证状态存在错误，部分提供商可能未载入。检查本地 Pi 配置后点击“刷新目录”。
        </p> : null}
      </div>
      <Button variant="outline" disabled={!view || busy || running}
        onClick={() => { if (view) void perform(() => service.refreshPiAuth({ workspacePath,
          generation: view.generation })); }}>刷新目录</Button>
    </div>
    {error ? <p role="alert" className="text-ui-sm text-destructive">{error}</p> : null}
    {!view ? <p className="text-ui-sm text-foreground-subtle">正在读取 Pi provider…</p> :
      <div className="grid min-h-[32rem] grid-cols-[minmax(12rem,14rem)_minmax(0,1fr)] overflow-hidden rounded-xl border border-border bg-card">
        <div className="min-w-0 border-r border-border p-3">
          <Input aria-label="搜索 Pi 提供商" placeholder="搜索提供商" value={filter}
            onChange={event => setFilter(event.target.value)} />
          <div className="mt-3 max-h-[34rem] space-y-1 overflow-auto">
            {providers.map(provider => <Button key={provider.id} type="button"
              variant={provider.id === selected?.id ? "secondary" : "ghost"}
              className="h-auto w-full justify-start whitespace-normal text-left"
              onClick={() => { setSelectedId(provider.id); setAnswer(""); }}>
              <span className="min-w-0"><span className="block truncate">{provider.name}</span>
                <span className="block truncate text-ui-xs text-foreground-subtle">{provider.id}</span></span>
            </Button>)}
          </div>
        </div>
        {selected ? <div className="min-w-0 space-y-4 p-4 sm:p-6">
          <div>
            <h3 className="text-ui-lg font-medium">{selected.name}</h3>
            <p className="text-ui-sm text-foreground-subtle">{selected.configured ? "已配置" : "未配置"} · 来源：{selected.source ?? "无"} · 保存类型：{selected.storedType ?? "无"} · 模型：{selected.modelCount}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {selected.methods.filter(method => method.canLogin).map(method =>
              <Button key={method.type} type="button" disabled={busy || running}
                onClick={() => start("login", method.type)}>{method.label} 登录</Button>)}
            <Button type="button" variant="outline" disabled={busy || running}
              onClick={() => start("resolve")}>解析认证</Button>
            <Button type="button" variant="outline" disabled={busy || running}
              onClick={() => start("catalog")}>刷新模型</Button>
            {selected.storedType ? <Button type="button" variant="outline" disabled={busy || running}
              onClick={() => start("logout")}>登出</Button> : null}
          </div>
          {operation ? <div className="space-y-3 rounded-lg border border-border p-3" data-testid="pi-auth-operation">
            <p className="text-ui-sm">{operation.message}</p>
            <p className="text-ui-xs text-foreground-subtle">状态：{operation.outcome}</p>
            {operation.notices.map((notice, index) => <div key={`${notice.type}-${index}`} className="text-ui-sm">
              {notice.type === "auth_url" ? <Button variant="link" type="button"
                onClick={() => platform.openExternal(notice.url)}>在浏览器打开授权页面</Button> :
                notice.type === "device_code" ? <div>
                  <Button variant="link" type="button" onClick={() => platform.openExternal(notice.verificationUri)}>
                    打开设备授权页面</Button><p>设备码：{notice.userCode}</p>
                  {notice.expiresAt !== undefined ? <p className="text-ui-xs text-foreground-subtle">
                    {notice.expiresAt <= Date.now() ? "设备码已过期；请取消并重新登录。" :
                      `设备码有效至 ${new Date(notice.expiresAt).toLocaleTimeString()}`}
                  </p> : null}
                </div> : <p>{notice.message}</p>}
            </div>)}
            {operation.prompts.map(prompt => <div key={prompt.id} className="space-y-2">
              <label className="block text-ui-sm">{prompt.message}</label>
              {prompt.options ? <div className="flex flex-wrap gap-2">{prompt.options.map(option =>
                <Button type="button" variant="outline" key={option.id} disabled={busy}
                  onClick={() => answerPrompt(prompt.id, option.id)}>{option.label}</Button>)}</div> :
                <div className="flex gap-2"><Input
                  type={prompt.type === "secret" || prompt.type === "manual_code" ? "password" : "text"}
                  placeholder={prompt.placeholder} value={answer}
                  onChange={event => setAnswer(event.target.value)}
                  data-testid="pi-auth-answer" />
                  <Button type="button" disabled={busy} onClick={() => answerPrompt(prompt.id, answer)}>继续</Button>
                </div>}
            </div>)}
            {running ? <Button type="button" variant="ghost" disabled={busy} onClick={cancel}>取消认证</Button> : null}
          </div> : null}
        </div> : <div className="p-6 text-ui-sm text-foreground-subtle">没有可用 Pi 提供商。</div>}
      </div>}
  </div>;
}
