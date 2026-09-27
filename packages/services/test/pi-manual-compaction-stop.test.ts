import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { PiRpcClient } from "../src/pi-agent/pi-rpc-client.js";
import { PiSessionSupervisor } from "../src/pi-agent/pi-session-supervisor.js";

test("manual Pi compaction Stop survives abort-before-start and cannot finish late", { timeout: 10_000 }, async () => {
  const workspacePath = await mkdtemp(join(tmpdir(), "pi-compact-stop-"));
  const sessionId = randomUUID();
  let sessionFile = "";
  class Client extends EventEmitter {
    readonly pid = process.pid;
    compacting = false;
    pendingCompact = false;
    abortCount = 0;
    releaseCompact?: (value: { success: boolean; data: object }) => void;
    async start() {}
    async dispose() {}
    async notify() {}
    async waitForPendingCommand(type: string) { return type !== "compact" || !this.pendingCompact; }
    async request(command: { type: string; paused?: boolean }) {
      switch (command.type) {
        case "get_state": return { success: true, data: { sessionId, sessionFile,
          isStreaming: false, isCompacting: this.compacting, pendingMessageCount: 0 } };
        case "get_messages": return { success: true, data: { messages: [] } };
        case "get_entries": return { success: true, data: { entries: [], leafId: null } };
        case "pi_gui_queue_capabilities_v1": return { success: true, data: {
          protocol: "pi-gui-queue/1", codingAgent: "0.87.0", agentCore: "0.87.1",
          stableItemIds: true, atomicRevision: true, images: true } };
        case "pi_gui_queue_catalog_v1": return { success: true, data: {
          revision: 0, paused: false, steering: [], followUp: [] } };
        case "pi_gui_queue_set_paused_v1": return { success: true, data: {
          revision: 1, paused: command.paused, steering: [], followUp: [] } };
        case "compact":
          this.pendingCompact = true;
          return await new Promise<{ success: boolean; data: object }>(resolve => { this.releaseCompact = resolve; });
        case "abort":
          this.abortCount++;
          if (this.abortCount === 1) {
            // Pi can enter compact after Stop's first abort, while its own
            // initial asynchronous abort() has not yet created the controller.
            this.compacting = true;
            this.emit("record", { type: "compaction_start", reason: "manual" });
            return { success: true, data: {} };
          }
          this.compacting = false;
          this.pendingCompact = false;
          this.emit("record", { type: "compaction_end", reason: "manual", aborted: true });
          this.releaseCompact?.({ success: false, data: {}, error: "Compaction cancelled" });
          return { success: true, data: {} };
        default: return { success: true, data: {} };
      }
    }
  }
  const client = new Client();
  const supervisor = new PiSessionSupervisor({ piEntry: join(workspacePath, "unused"),
    env: { PI_CODING_AGENT_SESSION_DIR: workspacePath }, clientFactory: options => {
      sessionFile = options.args[options.args.indexOf("--session") + 1]!;
      return client as unknown as PiRpcClient;
    } });
  try {
    await supervisor.createSession(workspacePath);
    const compact = supervisor.compact(sessionId);
    const executionId = supervisor.getSession(sessionId)?.foregroundExecutionId;
    assert.ok(executionId, "manual compaction must own a Stop identity before its RPC returns");
    assert.equal(supervisor.getSession(sessionId)?.phase, "compacting");
    assert.equal(await supervisor.stop(sessionId, executionId), "stopped");
    await compact;
    assert.equal(client.abortCount, 2, "Stop retries cancellation after Pi starts compact late");
    assert.equal(supervisor.getSession(sessionId)?.phase, "stopped");
  } finally {
    await supervisor.dispose();
    await rm(workspacePath, { recursive: true, force: true });
  }
});
