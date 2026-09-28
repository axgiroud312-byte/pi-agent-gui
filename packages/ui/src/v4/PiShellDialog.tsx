import { useMemo, useRef, useState } from "react";
import { Terminal } from "lucide-react";
import type { IServiceAccessor } from "@zcode/services";
import { Button } from "@/components/ui/button.js";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog.js";
import { useServices } from "@/hooks/useServices.js";
import { PiSessionDialogGuard, type PiSessionDialogTicket } from "@/v4/piSessionDialogGuard.js";

type ShellResult = Awaited<ReturnType<IServiceAccessor["zcodeAgentService"]["runPiShell"]>>;
type ShellTarget = Parameters<IServiceAccessor["zcodeAgentService"]["runPiShell"]>[0];
interface ShellUiState {
  scope: number;
  open: boolean;
  command: string;
  excludeFromContext: boolean;
  busy: boolean;
  result: ShellResult | null;
  error: string | null;
}
const emptyState = (scope: number): ShellUiState => ({ scope, open: false, command: "",
  excludeFromContext: false, busy: false, result: null, error: null });

/** Direct user bash runs in the owned Pi RPC session; the dialog displays Pi's result. */
export function PiShellDialog({ sessionId, workspacePath, workspaceIdentity, onStop }: {
  sessionId: string;
  workspacePath: string;
  workspaceIdentity?: string;
  onStop: (sessionId: string) => void;
}) {
  const { zcodeAgentService } = useServices();
  const [state, setState] = useState<ShellUiState>(() => emptyState(0));
  const guard = useRef(new PiSessionDialogGuard()).current;
  const operation = useRef<{ ticket: PiSessionDialogTicket; target: ShellTarget } | null>(null);
  const target = useMemo(() => ({ sessionId, workspacePath,
    ...(workspaceIdentity ? { workspaceIdentity } : {}) }), [sessionId, workspacePath, workspaceIdentity]);
  const targetKey = JSON.stringify([sessionId, workspacePath, workspaceIdentity]);
  const scope = guard.syncContext(targetKey);
  const { open, command, excludeFromContext, busy, result, error } =
    state.scope === scope ? state : emptyState(scope);

  const write = (ticket: PiSessionDialogTicket, update: (current: ShellUiState) => ShellUiState) => {
    if (!guard.isCurrent(ticket)) return;
    setState(current => guard.isCurrent(ticket)
      ? update(current.scope === ticket.scope ? current : emptyState(ticket.scope)) : current);
  };

  const run = async () => {
    if (busy || !command.trim()) return;
    const actionTarget = { ...target, command, excludeFromContext };
    const ticket = guard.begin(targetKey);
    operation.current = { ticket, target: actionTarget };
    write(ticket, current => ({ ...current, busy: true, result: null, error: null }));
    try {
      const next = await zcodeAgentService.runPiShell(actionTarget);
      write(ticket, current => ({ ...current, result: next }));
    } catch (cause) {
      write(ticket, current => ({ ...current,
        error: cause instanceof Error ? cause.message : String(cause) }));
    } finally {
      if (operation.current?.ticket === ticket) operation.current = null;
      write(ticket, current => ({ ...current, busy: false }));
    }
  };

  const stop = () => {
    const active = operation.current;
    if (active && guard.isCurrent(active.ticket) && active.target.sessionId === sessionId) {
      onStop(active.target.sessionId);
    }
  };

  const changeOpen = (next: boolean) => {
    if (!next && busy) return;
    if (!next) {
      guard.invalidate();
      operation.current = null;
      setState(current => ({ ...(current.scope === scope ? current : emptyState(scope)), open: false }));
    } else {
      setState(current => ({ ...(current.scope === scope ? current : emptyState(scope)), open: true }));
    }
  };

  return <>
    <Button type="button" variant="outline" size="icon-md" title="Pi shell" aria-label="Pi shell"
      className="pointer-events-auto bg-[var(--color-popover)] shadow-md"
      data-testid="pi-shell-open" onClick={() => changeOpen(true)}><Terminal className="size-4" /></Button>
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent data-testid="pi-shell-dialog" className="max-w-[min(42rem,calc(100vw-2rem))]">
        <DialogHeader>
          <DialogTitle>Pi shell</DialogTitle>
          <DialogDescription>命令由当前固定 Pi 会话执行，并记录在该会话历史中。</DialogDescription>
        </DialogHeader>
        <textarea aria-label="Shell 命令" data-testid="pi-shell-command" value={command}
          onChange={event => setState(current => ({
            ...(current.scope === scope ? current : emptyState(scope)), command: event.target.value,
          }))} disabled={busy}
          className="h-28 w-full rounded border border-border bg-background p-2 font-mono text-sm" />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={excludeFromContext} disabled={busy}
            onChange={event => setState(current => ({
              ...(current.scope === scope ? current : emptyState(scope)),
              excludeFromContext: event.target.checked,
            }))} />
          不加入后续模型上下文
        </label>
        <div className="flex gap-2">
          <Button type="button" disabled={busy || !command.trim()} onClick={() => void run()}>运行</Button>
          {busy ? <Button type="button" variant="outline" onClick={stop}>Stop shell</Button> : null}
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
