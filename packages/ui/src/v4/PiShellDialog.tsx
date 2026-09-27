import { useMemo, useState } from "react";
import { Terminal } from "lucide-react";
import type { IServiceAccessor } from "@zcode/services";
import { Button } from "@/components/ui/button.js";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog.js";
import { useServices } from "@/hooks/useServices.js";

type ShellResult = Awaited<ReturnType<IServiceAccessor["zcodeAgentService"]["runPiShell"]>>;

/** Direct user bash runs in the owned Pi RPC session; the dialog displays Pi's result. */
export function PiShellDialog({ sessionId, workspacePath, workspaceIdentity, onStop }: {
  sessionId: string;
  workspacePath: string;
  workspaceIdentity?: string;
  onStop: () => void;
}) {
  const { zcodeAgentService } = useServices();
  const [open, setOpen] = useState(false);
  const [command, setCommand] = useState("");
  const [excludeFromContext, setExcludeFromContext] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ShellResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const target = useMemo(() => ({ sessionId, workspacePath,
    ...(workspaceIdentity ? { workspaceIdentity } : {}) }), [sessionId, workspacePath, workspaceIdentity]);

  const run = async () => {
    if (busy || !command.trim()) return;
    setBusy(true); setResult(null); setError(null);
    try {
      setResult(await zcodeAgentService.runPiShell({ ...target, command, excludeFromContext }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally { setBusy(false); }
  };

  return <>
    <Button type="button" variant="outline" size="icon-md" title="Pi shell" aria-label="Pi shell"
      className="pointer-events-auto bg-[var(--color-popover)] shadow-md"
      data-testid="pi-shell-open" onClick={() => setOpen(true)}><Terminal className="size-4" /></Button>
    <Dialog open={open} onOpenChange={next => { if (!busy) setOpen(next); }}>
      <DialogContent data-testid="pi-shell-dialog" className="max-w-[min(42rem,calc(100vw-2rem))]">
        <DialogHeader>
          <DialogTitle>Pi shell</DialogTitle>
          <DialogDescription>命令由当前固定 Pi 会话执行，并记录在该会话历史中。</DialogDescription>
        </DialogHeader>
        <textarea aria-label="Shell 命令" data-testid="pi-shell-command" value={command}
          onChange={event => setCommand(event.target.value)} disabled={busy}
          className="h-28 w-full rounded border border-border bg-background p-2 font-mono text-sm" />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={excludeFromContext} disabled={busy}
            onChange={event => setExcludeFromContext(event.target.checked)} />
          不加入后续模型上下文
        </label>
        <div className="flex gap-2">
          <Button type="button" disabled={busy || !command.trim()} onClick={() => void run()}>运行</Button>
          {busy ? <Button type="button" variant="outline" onClick={onStop}>Stop shell</Button> : null}
        </div>
        {error ? <p role="alert" className="text-destructive">{error}</p> : null}
        {result ? <section data-testid="pi-shell-result" className="space-y-2 text-sm">
          <p>{result.cancelled ? "已取消" : `退出码：${result.exitCode ?? "未知"}`}
            {result.truncated ? " · 输出已由 Pi 截断" : ""}</p>
          <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-all rounded border border-border p-2 font-mono text-xs">
            {result.output || "（无输出）"}
          </pre>
        </section> : null}
      </DialogContent>
    </Dialog>
  </>;
}
