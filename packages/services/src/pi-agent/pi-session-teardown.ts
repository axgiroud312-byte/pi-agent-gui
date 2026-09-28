import type { PiRpcClient } from "./pi-rpc-client.js";

/** Direct RPC bash and Agent-owned tool bash are separate Pi cancellation paths. */
export async function settlePiSessionBeforeClose(client: PiRpcClient, hasForegroundRun: boolean): Promise<void> {
  // Pi's abort waits until an Agent run (including its tool calls) is idle.
  // Clear queues first so abort cannot immediately resume pending input.
  let agentAbortError: unknown;
  if (hasForegroundRun) {
    try {
      const clear = await client.request({ type: "clear_queue" }, 5_000);
      if (!clear.success) throw new Error(clear.error ?? "Pi clear_queue failed during close");
      const aborted = await client.request({ type: "abort" }, 10_000);
      if (!aborted.success) throw new Error(aborted.error ?? "Pi abort failed during close");
    } catch (error) { agentAbortError = error; }
  }
  // abort_bash ACK only requests cancellation. Wait for the *original bash*
  // RPC response (cancelled:true) before killing the parent or releasing lease.
  try { await client.request({ type: "abort_bash" }, 3_000); }
  catch { /* child may already have exited; still inspect in-flight bash */ }
  const bashSettled = await client.waitForPendingCommand?.("bash", 3_000);
  // This includes only direct RPC bash. Agent tool bash may still be running
  // even when no direct command is pending. The caller must ALWAYS await
  // client.dispose(), which verifies/reaps both paths before releasing lease.
  if (agentAbortError || bashSettled === false) {
    throw agentAbortError ?? new Error("Pi direct bash did not settle after abort_bash");
  }
}
