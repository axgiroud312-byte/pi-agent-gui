import { useCallback, useEffect, useRef, useState } from "react";
import type { IZCodeAgentService } from "@zcode/services";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import { Label } from "@/components/ui/label.js";
import { Textarea } from "@/components/ui/textarea.js";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select.js";
import { PI_AUTH_CATALOG_CHANGED_EVENT } from "@/lib/piAuthCatalogEvent.js";

type View = Awaited<ReturnType<IZCodeAgentService["readPiModelConfig"]>>;
const apis = ["openai-completions", "openai-responses", "anthropic-messages", "google-generative-ai"];

/** Mounted with a workspace/provider key so late reads cannot replace another form's draft. */
export function PiModelConfigEditor({ service, workspacePath, providerId, onSaved }: {
  service: IZCodeAgentService; workspacePath: string; providerId: string | null;
  onSaved: (providerId: string, notice: string) => void;
}) {
  const [view, setView] = useState<View | null>(null);
  const [id, setId] = useState(providerId ?? "");
  const [baseUrl, setBaseUrl] = useState("");
  const [api, setApi] = useState("openai-completions");
  const [models, setModels] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [reload, setReload] = useState(0);
  const [editing, setEditing] = useState(providerId === null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const config = view?.providers.find(provider => provider.id === providerId);
  const assign = useCallback((next: View) => {
    setView(next);
    const provider = next.providers.find(item => item.id === providerId);
    setBaseUrl(provider?.baseUrl ?? "");
    setApi(provider?.api ?? (providerId ? "" : "openai-completions"));
    setModels(provider?.modelIds.join("\n") ?? "");
  }, [providerId]);
  useEffect(() => {
    let live = true;
    setBusy(true);
    service.readPiModelConfig({ workspacePath }).then(next => { if (live) { assign(next); setError(""); } })
      .catch(() => { if (live) setError("无法读取 Pi 模型配置，请重试。"); })
      .finally(() => { if (live) setBusy(false); });
    return () => { live = false; };
  }, [assign, reload, service, workspacePath]);

  const save = async (remove = false) => {
    if (!view) return;
    setBusy(true); setError(""); setStatus("");
    try {
      const result = await service.savePiModelConfig({ workspacePath, expectedRevision: view.revision,
        create: providerId === null,
        providerId: id.trim(), config: remove ? null : { baseUrl: baseUrl.trim(), api,
          modelIds: models.split("\n").map(value => value.trim()).filter(Boolean) } });
      window.dispatchEvent(new Event(PI_AUTH_CATALOG_CHANGED_EVENT));
      if (!mounted.current) return;
      assign(result.config);
      const notice = result.synchronized ? "模型配置已保存，Pi 目录已刷新。" : "模型配置已保存；会话同步未完成，请在会话空闲后刷新目录。";
      setStatus(notice);
      onSaved(id.trim(), notice);
      if (providerId) setEditing(false);
    } catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : "模型配置保存失败。"); }
    finally { if (mounted.current) setBusy(false); }
  };
  return <section className="flex flex-col gap-3" data-testid="pi-model-config-editor">
    <div className="flex flex-wrap items-center gap-2">
      <h4 className="text-ui-base font-medium">{providerId ? "自定义连接与模型" : "添加自定义提供商"}</h4>
      {!editing ? <Button variant="outline" disabled={busy} onClick={() => { setEditing(true); setReload(value => value + 1); }}>
        {config ? "编辑模型配置" : "自定义模型配置"}</Button> : null}
    </div>
    {status ? <p role="status" className="text-ui-sm text-foreground-subtle">{status}</p> : null}
    {error || view?.error ? <p role="alert" className="text-ui-sm text-destructive">{error || view?.error}</p> : null}
    {error || view?.error ? <Button variant="outline" disabled={busy} onClick={() => setReload(value => value + 1)}>重新读取模型配置</Button> : null}
    {editing ? <fieldset disabled={busy || Boolean(view?.error)} className="flex min-w-0 flex-col gap-3">
      <Label htmlFor="pi-provider-id">提供商 ID</Label>
      <Input id="pi-provider-id" value={id} disabled={Boolean(providerId)} onChange={event => setId(event.target.value)} placeholder="my-provider" />
      <Label htmlFor="pi-provider-url">API 地址</Label>
      <Input id="pi-provider-url" value={baseUrl} onChange={event => setBaseUrl(event.target.value)} placeholder="https://example.com/v1" />
      <Label htmlFor="pi-provider-api">API 协议</Label>
      <Select value={api || "inherit"} onValueChange={value => setApi(value === "inherit" ? "" : value)}>
        <SelectTrigger id="pi-provider-api"><SelectValue /></SelectTrigger>
        <SelectContent><SelectGroup>
          <SelectItem value="inherit">沿用 Pi / 逐模型配置</SelectItem>
          {[...new Set([...apis, ...(api ? [api] : [])])].map(value => <SelectItem key={value} value={value}>{value}</SelectItem>)}
        </SelectGroup></SelectContent>
      </Select>
      <Label htmlFor="pi-provider-models">模型 ID（每行一个）</Label>
      <Textarea id="pi-provider-models" rows={4} value={models} onChange={event => setModels(event.target.value)} placeholder="model-id" />
      <p className="text-ui-xs text-foreground-subtle">已有模型的推理、上下文和兼容参数会保留。凭据由本页登录入口管理；扩展自身配置仍由扩展负责。</p>
      <div className="flex flex-wrap gap-2">
        <Button disabled={!view || !id.trim()} onClick={() => { void save(); }}>保存模型配置</Button>
        {config ? <Button variant="outline" onClick={() => { void save(true); }}>移除自定义配置</Button> : null}
        <Button variant="ghost" onClick={() => { setReload(value => value + 1); setStatus(""); }}>放弃修改并重新读取</Button>
      </div>
    </fieldset> : null}
    {view ? <p className="break-all text-ui-xs text-foreground-subtle">配置文件：{view.path}</p> : null}
  </section>;
}
