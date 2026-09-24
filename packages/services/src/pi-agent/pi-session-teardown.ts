import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
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
  if (bashSettled === false && process.platform === "win32" && client.isRunning && client.pid) {
    // Last resort only for a still-owned Pi PID after the handshake timed out.
    await promisify(execFile)(join(process.env.SystemRoot ?? "C:\\Windows", "System32", "taskkill.exe"),
      ["/F", "/T", "/PID", String(client.pid)], { windowsHide: true, timeout: 5_000 });
  }
  if (bashSettled === false && client.isRunning && process.platform !== "win32") {
    throw new Error("Pi direct bash did not settle after abort_bash");
  }
  if (agentAbortError) throw agentAbortError;
}
