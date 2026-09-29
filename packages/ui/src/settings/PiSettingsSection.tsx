import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button.js";
import { useServices } from "@/hooks/useServices.js";
import { PiSettingsReadGuard, type PiSettingsEditorScope } from "./piSettingsReadGuard.js";
import { buildPiSettingsSourceRows } from "./piSettingsSourceRows.js";

type Snapshot = Awaited<ReturnType<ReturnType<typeof useServices>["zcodeAgentService"]["readPiSettings"]>>;
type Scope = PiSettingsEditorScope;
type LaunchPrefs = { offline: "inherit" | "offline" | "online";
  versionCheck: "inherit" | "skip" | "check" };

function settingSurface(path: string): string {
  if (/^\/(?:terminal(?:\/|$)|tuiMode$|fullscreen|theme$|externalEditor$|quietStartup$|editorPaddingX$|outputPad$|autocompleteMaxVisible$|showHardwareCursor$|doubleEscapeAction$|treeFilterMode$|markdown(?:\/|$)|collapseChangelog$|hideThinkingBlock$)/u.test(path)) {
    return "Pi CLI TUI";
  }
  return "Pi 新会话";
}

function formattedDocument(snapshot: Snapshot, scope: Scope): string {
  const document = snapshot[scope];
  return document.exists ? document.text : "{}\n";
}

/** Advanced view of Pi's own settings.json, within the unified model settings surface. */
export function PiSettingsSection({ workspacePath }: { workspacePath: string }) {
  const { zcodeAgentService, settingService } = useServices();
  const [loaded, setLoaded] = useState<{ workspacePath: string; snapshot: Snapshot } | null>(null);
  const [scope, setScope] = useState<Scope>("user");
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [launchSaving, setLaunchSaving] = useState(false);
  const [launchPrefs, setLaunchPrefs] = useState<LaunchPrefs | null>(null);
  const guardRef = useRef<PiSettingsReadGuard | null>(null);
  guardRef.current ??= new PiSettingsReadGuard();
  const guard = guardRef.current;
  // Update synchronously with props so an older Promise cannot win before an effect runs.
  guard.syncContext(workspacePath, scope);
  const snapshot = loaded?.workspacePath === workspacePath ? loaded.snapshot : null;
  const effectiveRows = useMemo(() => snapshot ? buildPiSettingsSourceRows(snapshot) : [], [snapshot]);

  const load = useCallback(async (nextScope: Scope = scope) => {
    if (!workspacePath) { setLoading(false); return; }
    const ticket = guard.begin(workspacePath, nextScope);
    setLoading(true);
    setError("");
    try {
      const [result, appSettings] = await Promise.all([
        zcodeAgentService.readPiSettings({ workspacePath }), settingService.get(),
      ]);
      if (!guard.isCurrent(ticket)) return;
      setLoaded({ workspacePath, snapshot: result });
      setText(formattedDocument(result, nextScope));
      setLaunchPrefs({ offline: appSettings.piOfflineMode ?? "inherit",
        versionCheck: appSettings.piVersionCheckMode ?? "inherit" });
    } catch (cause) {
      if (guard.isLatestRead(ticket)) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (guard.isLatestRead(ticket)) setLoading(false);
    }
  }, [guard, scope, workspacePath, zcodeAgentService, settingService]);

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

  const saveLaunch = async (patch: { piOfflineMode?: LaunchPrefs["offline"];
    piVersionCheckMode?: LaunchPrefs["versionCheck"] }) => {
    if (!snapshot || dirty || saving || launchSaving) return;
    const ticket = guard.begin(workspacePath, scope);
    setLaunchSaving(true);
    setError("");
    try {
      await settingService.update(patch);
      const [result, appSettings] = await Promise.all([
        zcodeAgentService.readPiSettings({ workspacePath }), settingService.get(),
      ]);
      if (!guard.isCurrent(ticket)) return;
      setLoaded({ workspacePath, snapshot: result });
      setText(formattedDocument(result, scope));
      setLaunchPrefs({ offline: appSettings.piOfflineMode ?? "inherit",
        versionCheck: appSettings.piVersionCheckMode ?? "inherit" });
    } catch (cause) {
      if (guard.isLatestRead(ticket)) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLaunchSaving(false);
    }
  };

  return (
    <section aria-label="Pi 设置" className="rounded-xl border border-border bg-card p-4 space-y-4" data-testid="pi-settings-section">
      <div className="space-y-1">
        <h3 className="text-lg font-semibold">Pi 设置</h3>
        <p className="text-sm text-muted-foreground">
          以下文件由 Pi 0.87.0 读取。此处配置供新会话读取；正在运行的会话请在会话控件查看当前状态。
        </p>
      </div>
      {!workspacePath ? <p className="text-sm text-muted-foreground">打开本地项目后可查看 Pi 设置。</p> : (
        <>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant={scope === "user" ? "default" : "outline"} disabled={saving || launchSaving} onClick={() => selectScope("user")}>用户设置</Button>
            <Button type="button" variant={scope === "project" ? "default" : "outline"} disabled={saving || launchSaving} onClick={() => selectScope("project")}>项目设置</Button>
            <Button type="button" variant="outline" disabled={loading || saving || launchSaving} onClick={() => { void load(); }}>
              {dirty ? "放弃修改并重新读取" : "读取最新"}
            </Button>
          </div>
          {loading ? <p className="text-sm">正在读取 Pi 设置…</p> : null}
          {snapshot ? (
            <>
              <p className="break-all text-xs text-muted-foreground">{document?.path}</p>
              {launchPrefs ? <div className="grid gap-3 rounded-md border border-border p-3 text-sm sm:grid-cols-2">
                <label className="space-y-1">Pi 新会话联网
                  <select data-testid="pi-offline-mode" value={launchPrefs.offline}
                    disabled={dirty || saving || launchSaving} onChange={event => {
                      void saveLaunch({ piOfflineMode: event.target.value as LaunchPrefs["offline"] });
                    }} className="block w-full rounded-md border border-border bg-background p-2">
                    <option value="inherit">遵循宿主环境</option><option value="offline">离线启动</option>
                    <option value="online">允许联网</option>
                  </select>
                </label>
                <label className="space-y-1">Pi 新会话版本检查
                  <select data-testid="pi-version-check-mode" value={launchPrefs.versionCheck}
                    disabled={dirty || saving || launchSaving} onChange={event => {
                      void saveLaunch({ piVersionCheckMode: event.target.value as LaunchPrefs["versionCheck"] });
                    }} className="block w-full rounded-md border border-border bg-background p-2">
                    <option value="inherit">遵循宿主环境</option><option value="skip">跳过检查</option>
                    <option value="check">允许检查</option>
                  </select>
                </label>
                <p className="text-xs text-muted-foreground sm:col-span-2">
                  下一条 Pi RPC 子进程：{snapshot.offline ? "离线" : "允许联网"}；
                  {snapshot.versionCheckDisabled ? "跳过 Pi 版本检查" : "允许 Pi 版本检查"}。
                  已运行会话不改变。Pi 版本检查与本桌面应用的更新设置分开。
                  {dirty ? "请先保存或放弃 JSON 修改，再调整启动选项。" : ""}
                </p>
              </div> : null}
              {scope === "project" && !snapshot.projectTrusted ? (
                <p role="status" className="text-sm text-amber-600">
                  此项目当前未获 Pi 信任；大多数项目设置不会应用。Pi 会在信任检查前读取 sessionDir 来定位历史。
                </p>
              ) : null}
              {scope === "project" && snapshot.ignoredProjectPaths.length > 0 ? (
                <p role="status" className="text-sm text-amber-600">
                  Pi 0.87.0 只从用户设置读取 {snapshot.ignoredProjectPaths.join("、")}；项目文件中的同名字段仍在原文件，但不会生效。
                </p>
              ) : null}
              <p className="break-all text-xs text-muted-foreground">新会话历史目录：{snapshot.sessionDirectory}</p>
              {document?.error ? <p role="alert" className="text-sm text-destructive">
                原文件{document.error}。请先在外部修复；本页不会覆盖坏配置。
              </p> : null}
              <label className="block space-y-2 text-sm font-medium" htmlFor="pi-settings-json">
                <span>{scope === "user" ? "用户 settings.json" : "项目 .pi/settings.json"}</span>
                <textarea id="pi-settings-json" data-testid="pi-settings-json" spellCheck={false} value={text}
                  disabled={saving || launchSaving} onChange={(event) => { guard.markEdited(); setText(event.target.value); }} rows={12}
                  className="w-full rounded-md border border-border bg-background p-3 font-mono text-xs leading-5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
              </label>
              <Button type="button" disabled={!dirty || saving || launchSaving || Boolean(document?.error)} onClick={() => { void save(); }}>
                {saving ? "正在保存…" : "保存 Pi 设置"}
              </Button>
              <details className="text-sm">
                <summary className="cursor-pointer font-medium">查看已配置的 Pi 值与来源</summary>
                <div className="mt-2 max-h-64 overflow-auto rounded-md border border-border">
                  <table className="w-full text-left text-xs"><thead><tr><th className="p-2">选项路径</th><th className="p-2">配置值</th><th className="p-2">来源</th><th className="p-2">适用面</th></tr></thead>
                    <tbody>{effectiveRows.slice(0, 200).map(row => (
                      <tr key={row.path} className="border-t border-border"><td className="p-2 font-mono">{row.path}</td>
                        <td className="p-2 font-mono break-all">{row.value}</td>
                        <td className="p-2">{row.source === "project" ? "项目" : row.source === "user" ? "用户" : "未知"}</td>
                        <td className="p-2">{settingSurface(row.path)}</td></tr>
                    ))}</tbody>
                  </table>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">路径用 / 分层；嵌套选项按 Pi 规则逐项合并。这里只列出文件中的配置值，不含 Pi 内建默认值，也不是正在运行会话的 get_state。Pi CLI TUI 专属项不改变本 GUI。编辑器保存当前作用域的完整 JSON，保留未修改字段。{effectiveRows.length > 200 ? `这里只显示前 200 / ${effectiveRows.length} 项；可切换上方作用域分别查看原始 JSON。` : ""}</p>
              </details>
            </>
          ) : null}
          {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        </>
      )}
    </section>
  );
}
