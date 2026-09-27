import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button.js";
import { useServices } from "@/hooks/useServices.js";
import { PiSettingsReadGuard, type PiSettingsEditorScope } from "./piSettingsReadGuard.js";

type Snapshot = Awaited<ReturnType<ReturnType<typeof useServices>["zcodeAgentService"]["readPiSettings"]>>;
type Scope = PiSettingsEditorScope;

function formattedDocument(snapshot: Snapshot, scope: Scope): string {
  const document = snapshot[scope];
  return document.exists ? document.text : "{}\n";
}

/** Scoped view of Pi's own settings.json files; existing native provider controls remain separate. */
export function PiSettingsSection({ workspacePath }: { workspacePath: string }) {
  const { zcodeAgentService } = useServices();
  const [loaded, setLoaded] = useState<{ workspacePath: string; snapshot: Snapshot } | null>(null);
  const [scope, setScope] = useState<Scope>("user");
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const guardRef = useRef<PiSettingsReadGuard | null>(null);
  guardRef.current ??= new PiSettingsReadGuard();
  const guard = guardRef.current;
  // Update synchronously with props so an older Promise cannot win before an effect runs.
  guard.syncContext(workspacePath, scope);
  const snapshot = loaded?.workspacePath === workspacePath ? loaded.snapshot : null;

  const load = useCallback(async (nextScope: Scope = scope) => {
    if (!workspacePath) { setLoading(false); return; }
    const ticket = guard.begin(workspacePath, nextScope);
    setLoading(true);
    setError("");
    try {
      const result = await zcodeAgentService.readPiSettings({ workspacePath });
      if (!guard.isCurrent(ticket)) return;
      setLoaded({ workspacePath, snapshot: result });
      setText(formattedDocument(result, nextScope));
    } catch (cause) {
      if (guard.isLatestRead(ticket)) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (guard.isLatestRead(ticket)) setLoading(false);
    }
  }, [guard, scope, workspacePath, zcodeAgentService]);

  useEffect(() => { void load(); }, [load]);

  const document = snapshot?.[scope];
  const dirty = snapshot !== null && text !== formattedDocument(snapshot, scope);
  const selectScope = (nextScope: Scope) => {
    if (nextScope === scope || saving) return;
    if (dirty) { setError("请先保存或重新读取，避免丢失当前修改。"); return; }
    guard.syncContext(workspacePath, nextScope);
    setScope(nextScope);
    if (snapshot) setText(formattedDocument(snapshot, nextScope));
    setError("");
  };
  const save = async () => {
    if (!snapshot || !document || !dirty) return;
    const ticket = guard.begin(workspacePath, scope);
    setSaving(true);
    setLoading(false);
    setError("");
    try {
      const result = await zcodeAgentService.savePiSettings({ workspacePath, scope,
        expectedRevision: document.revision, text });
      if (!guard.isCurrent(ticket)) return;
      setLoaded({ workspacePath, snapshot: result });
      setText(formattedDocument(result, scope));
    } catch (cause) {
      if (guard.isLatestRead(ticket)) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section aria-label="Pi 设置" className="rounded-xl border border-border bg-card p-4 space-y-4" data-testid="pi-settings-section">
      <div className="space-y-1">
        <h3 className="text-lg font-semibold">Pi 设置</h3>
        <p className="text-sm text-muted-foreground">
          以下文件由 Pi 0.87.0 读取。此处修改会在新会话启动时生效；正在运行的会话请在会话模型控件查看当前值。
        </p>
      </div>
      {!workspacePath ? <p className="text-sm text-muted-foreground">打开本地项目后可查看 Pi 设置。</p> : (
        <>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant={scope === "user" ? "default" : "outline"} disabled={saving} onClick={() => selectScope("user")}>用户设置</Button>
            <Button type="button" variant={scope === "project" ? "default" : "outline"} disabled={saving} onClick={() => selectScope("project")}>项目设置</Button>
            <Button type="button" variant="outline" disabled={loading || saving} onClick={() => { void load(); }}>
              {dirty ? "放弃修改并重新读取" : "读取最新"}
            </Button>
          </div>
          {loading ? <p className="text-sm">正在读取 Pi 设置…</p> : null}
          {snapshot ? (
            <>
              <p className="break-all text-xs text-muted-foreground">{document?.path}</p>
              {scope === "project" && !snapshot.projectTrusted ? (
                <p role="status" className="text-sm text-amber-600">
                  此项目当前未获 Pi 信任；大多数项目设置不会应用。Pi 会在信任检查前读取 sessionDir 来定位历史。
                </p>
              ) : null}
              {snapshot.offline ? <p className="text-xs text-muted-foreground">Pi 启动参数：离线模式</p> : null}
              <p className="break-all text-xs text-muted-foreground">新会话历史目录：{snapshot.sessionDirectory}</p>
              {document?.error ? <p role="alert" className="text-sm text-destructive">
                原文件{document.error}。请先在外部修复；本页不会覆盖坏配置。
              </p> : null}
              <label className="block space-y-2 text-sm font-medium" htmlFor="pi-settings-json">
                <span>{scope === "user" ? "用户 settings.json" : "项目 .pi/settings.json"}</span>
                <textarea id="pi-settings-json" data-testid="pi-settings-json" spellCheck={false} value={text}
                  disabled={saving} onChange={(event) => { guard.markEdited(); setText(event.target.value); }} rows={12}
                  className="w-full rounded-md border border-border bg-background p-3 font-mono text-xs leading-5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
              </label>
              <Button type="button" disabled={!dirty || saving || Boolean(document?.error)} onClick={() => { void save(); }}>
                {saving ? "正在保存…" : "保存 Pi 设置"}
              </Button>
              <details className="text-sm">
                <summary className="cursor-pointer font-medium">查看 Pi 实际生效值与来源</summary>
                <div className="mt-2 max-h-64 overflow-auto rounded-md border border-border">
                  <table className="w-full text-left text-xs"><thead><tr><th className="p-2">选项</th><th className="p-2">生效值</th><th className="p-2">来源</th></tr></thead>
                    <tbody>{Object.entries(snapshot.effective).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => (
                      <tr key={key} className="border-t border-border"><td className="p-2 font-mono">{key}</td>
                        <td className="p-2 font-mono break-all">{JSON.stringify(value)}</td>
                        <td className="p-2">{snapshot.sources[key] === "project" ? "项目" : "用户"}</td></tr>
                    ))}</tbody>
                  </table>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">嵌套选项按 Pi 规则逐项合并；编辑器保存当前作用域的完整 JSON，保留未修改字段。</p>
              </details>
            </>
          ) : null}
          {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        </>
      )}
    </section>
  );
}
