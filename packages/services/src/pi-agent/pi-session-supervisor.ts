import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { stat } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { PiRpcClient, PiRpcError, type RpcDiagnostic, type RpcExit } from "./pi-rpc-client.js";
import { PiSessionLease } from "./pi-session-lease.js";

export type PiSessionPhase =
  | "starting"
  | "idle"
  | "accepted"
  | "running"
  | "retrying"
  | "compacting"
  | "stopping"
  | "settled"
  | "stopped"
  | "error"
  | "exited";

export interface PiSessionView {
  sessionId: string;
  sessionFile: string;
  workspacePath: string;
  pid: number;
  phase: PiSessionPhase;
  uncertainDelivery: boolean;
  error?: string;
}

export interface PiSessionSupervisorOptions {
  piEntry: string;
  executable?: string;
  env?: NodeJS.ProcessEnv;
  rpcArgs?: string[];
  clientFactory?: (options: ConstructorParameters<typeof PiRpcClient>[0]) => PiRpcClient;
}

interface SessionRuntime {
  view: PiSessionView;
  client: PiRpcClient;
  generation: string;
  stopping: boolean;
  acceptRunEvents: boolean;
  hadRunError: boolean;
  lease: PiSessionLease;
}

type SupervisorEvents = {
  change: [view: PiSessionView];
  record: [sessionId: string, record: Record<string, unknown>];
  diagnostic: [sessionId: string, diagnostic: RpcDiagnostic];
  exit: [sessionId: string, exit: RpcExit];
};

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Pi RPC returned an invalid object");
  }
  return value as Record<string, unknown>;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** One live Pi process owns one Pi session. No request is retried or replayed here. */
export class PiSessionSupervisor extends EventEmitter<SupervisorEvents> {
  private readonly sessions = new Map<string, SessionRuntime>();
  private readonly sessionFiles = new Map<string, string>();
  private readonly options: PiSessionSupervisorOptions;
  private disposed = false;
  private disposePromise?: Promise<void>;

  constructor(options: PiSessionSupervisorOptions) {
    super();
    this.options = { ...options, rpcArgs: [...(options.rpcArgs ?? [])] };
  }

  private publish(runtime: SessionRuntime): void {
    this.emit("change", { ...runtime.view });
  }

  private attach(runtime: SessionRuntime): void {
    const { client, view, generation } = runtime;
    const current = () => this.sessions.get(view.sessionId) === runtime && runtime.generation === generation;
    client.on("record", record => {
      if (!current()) return;
      this.emit("record", view.sessionId, record);
      if (runtime.stopping || !runtime.acceptRunEvents) return;
      switch (record.type) {
        case "agent_start":
          runtime.hadRunError = false;
          view.phase = "running";
          break;
        case "auto_retry_start":
          view.phase = "retrying";
          break;
        case "auto_retry_end":
          view.phase = "running";
          if (record.success === false) runtime.hadRunError = true;
          break;
        case "compaction_start":
          view.phase = "compacting";
          break;
        case "compaction_end":
          view.phase = "running";
          if (record.errorMessage || record.aborted) runtime.hadRunError = true;
          break;
        case "message_end": {
          const final = record.message;
          if (typeof final === "object" && final !== null && !Array.isArray(final)) {
            const result = final as Record<string, unknown>;
            if (result.stopReason === "error" || result.errorMessage) {
              runtime.hadRunError = true;
              view.error = typeof result.errorMessage === "string" ? result.errorMessage : "Pi model run failed";
            }
          }
          break;
        }
        case "extension_error":
          runtime.hadRunError = true;
          view.error = typeof record.error === "string" ? record.error : "Pi extension failed";
          break;
        case "agent_settled":
          view.phase = runtime.hadRunError ? "error" : "settled";
          runtime.acceptRunEvents = false;
          break;
        // agent_end is a low-level cycle boundary, not completion.
      }
      this.publish(runtime);
    });
    client.on("diagnostic", diagnostic => {
      if (!current()) return;
      if (diagnostic.kind === "protocol") {
        view.uncertainDelivery = true;
        view.error = "Pi protocol output was malformed; inspect the session before sending another input";
        view.phase = "error";
        this.publish(runtime);
      }
      this.emit("diagnostic", view.sessionId, diagnostic);
    });
    client.on("exit", exit => {
      if (!current()) return;
      view.phase = "exited";
      view.error ??= `Pi process exited (code=${exit.code ?? "unknown"}, signal=${exit.signal ?? "none"})`;
      this.publish(runtime);
      this.emit("exit", view.sessionId, exit);
      this.sessions.delete(view.sessionId);
      this.sessionFiles.delete(view.sessionFile);
      void runtime.lease.release().catch(error => this.emit("diagnostic", view.sessionId,
        { kind: "process", message: `Could not release Pi session lease: ${message(error)}` }));
    });
  }

  private async start(workspacePath: string, args: string[], expectedId?: string): Promise<PiSessionView> {
    if (this.disposed) throw new Error("Pi session supervisor is disposed");
    if (!isAbsolute(workspacePath) || !(await stat(workspacePath)).isDirectory()) {
      throw new Error("Pi workspace path must be an existing absolute directory");
    }
    const client = (this.options.clientFactory ?? (options => new PiRpcClient(options)))({
      executable: this.options.executable ?? process.execPath,
      args: [this.options.piEntry, ...args, ...(this.options.rpcArgs ?? [])],
      cwd: workspacePath,
      // Inherit the execution target's Pi identity. Desktop metadata profile is separate.
      env: { ...process.env, ...this.options.env, ELECTRON_RUN_AS_NODE: "1" },
    });
    let lease: PiSessionLease | undefined;
    try {
      await client.start();
      const response = await client.request({ type: "get_state" });
      if (!response.success) throw new Error(response.error ?? "Pi get_state failed");
      const state = object(response.data);
      if (typeof state.sessionId !== "string" || typeof state.sessionFile !== "string") {
        throw new Error("Pi get_state omitted session identity");
      }
      if (expectedId && state.sessionId !== expectedId) {
        throw new Error(`Pi restored a different session (${state.sessionId}) than requested (${expectedId})`);
      }
      if (this.sessions.has(state.sessionId) || this.sessionFiles.has(state.sessionFile)) {
        throw new Error("Pi session is already owned by an active process");
      }
      if (!client.pid) throw new Error("Pi process has no PID");
      lease = await PiSessionLease.acquire(state.sessionFile);
      const view: PiSessionView = {
        sessionId: state.sessionId,
        sessionFile: state.sessionFile,
        workspacePath,
        pid: client.pid,
        phase: state.isCompacting ? "compacting" : state.isStreaming ? "running" : "idle",
        uncertainDelivery: false,
      };
      const runtime: SessionRuntime = {
        view,
        client,
        generation: randomUUID(),
        stopping: false,
        acceptRunEvents: state.isStreaming === true || state.isCompacting === true,
        hadRunError: false,
        lease,
      };
      this.sessions.set(view.sessionId, runtime);
      this.sessionFiles.set(view.sessionFile, view.sessionId);
      this.attach(runtime);
      this.publish(runtime);
      return { ...view };
    } catch (error) {
      await client.dispose();
      await lease?.release();
      throw error;
    }
  }

  async createSession(workspacePath: string): Promise<PiSessionView> {
    const sessionId = randomUUID();
    return this.start(workspacePath, ["--session-id", sessionId], sessionId);
  }

  async resumeSession(workspacePath: string, sessionFile: string, expectedId: string): Promise<PiSessionView> {
    if (!isAbsolute(sessionFile) || !(await stat(sessionFile)).isFile()) {
      throw new Error("Pi session history file does not exist");
    }
    return this.start(workspacePath, ["--session", sessionFile], expectedId);
  }

  getSession(sessionId: string): PiSessionView | undefined {
    const view = this.sessions.get(sessionId)?.view;
    return view ? { ...view } : undefined;
  }

  private requireSession(sessionId: string): SessionRuntime {
    const runtime = this.sessions.get(sessionId);
    if (!runtime) throw new Error(`Pi session is not active: ${sessionId}`);
    return runtime;
  }

  async getState(sessionId: string): Promise<Record<string, unknown>> {
    const runtime = this.requireSession(sessionId);
    const response = await runtime.client.request({ type: "get_state" });
    if (!response.success) throw new Error(response.error ?? "Pi get_state failed");
    const state = object(response.data);
    if (state.sessionId !== sessionId) throw new Error("Pi process switched to another session");
    return state;
  }

  async getMessages(sessionId: string): Promise<unknown[]> {
    const response = await this.requireSession(sessionId).client.request({ type: "get_messages" });
    if (!response.success) throw new Error(response.error ?? "Pi get_messages failed");
    const messages = object(response.data).messages;
    if (!Array.isArray(messages)) throw new Error("Pi get_messages omitted messages array");
    return messages;
  }

  async setModel(sessionId: string, provider: string, modelId: string, thinkingLevel?: string): Promise<void> {
    const runtime = this.requireSession(sessionId);
    if (runtime.view.uncertainDelivery) throw new Error("Pi session requires reconciliation before model change");
    const model = await runtime.client.request({ type: "set_model", provider, modelId });
    if (!model.success) throw new Error(model.error ?? "Pi rejected the model");
    if (thinkingLevel) {
      const thinking = await runtime.client.request({ type: "set_thinking_level", level: thinkingLevel });
      if (!thinking.success) throw new Error(thinking.error ?? "Pi rejected the thinking level");
    }
  }

  async sendText(sessionId: string, text: string): Promise<void> {
    const runtime = this.requireSession(sessionId);
    if (runtime.view.uncertainDelivery) throw new Error("Previous Pi input delivery is uncertain; inspect the session first");
    if (!["idle", "settled", "stopped", "error"].includes(runtime.view.phase)) throw new Error("Pi session is already busy");
    if (text.trim().length === 0) throw new Error("Pi input is empty");
    runtime.hadRunError = false;
    runtime.acceptRunEvents = true;
    runtime.view.error = undefined;
    runtime.view.phase = "accepted";
    this.publish(runtime);
    try {
      const response = await runtime.client.request({ type: "prompt", message: text });
      if (!response.success) throw new Error(response.error ?? "Pi rejected the prompt");
      // Response confirms admission only. agent_settled is the run boundary.
      const state = await this.getState(sessionId);
      if (runtime.view.phase === "accepted" && state.isStreaming === false && state.isCompacting === false && state.pendingMessageCount === 0) {
        // An extension command may have handled the prompt without a model run.
        runtime.view.phase = "idle";
        runtime.acceptRunEvents = false;
        this.publish(runtime);
      }
    } catch (error) {
      runtime.acceptRunEvents = false;
      if (error instanceof PiRpcError && error.delivery === "unknown") runtime.view.uncertainDelivery = true;
      runtime.view.phase = "error";
      runtime.view.error = message(error);
      this.publish(runtime);
      throw error;
    }
  }

  async stop(sessionId: string): Promise<void> {
    const runtime = this.requireSession(sessionId);
    runtime.stopping = true;
    runtime.acceptRunEvents = false;
    runtime.view.phase = "stopping";
    this.publish(runtime);
    try {
      // Pi's abort continues queued work unless the queues are cleared first.
      const clear = await runtime.client.request({ type: "clear_queue" });
      if (!clear.success) throw new Error(clear.error ?? "Pi clear_queue failed");
      const abort = await runtime.client.request({ type: "abort" });
      if (!abort.success) throw new Error(abort.error ?? "Pi abort failed");
      const state = await this.getState(sessionId);
      if (state.isStreaming || state.isCompacting || Number(state.pendingMessageCount) > 0) {
        throw new Error("Pi did not settle after stop");
      }
      runtime.view.phase = "stopped";
      runtime.view.error = undefined;
    } catch (error) {
      if (error instanceof PiRpcError && error.delivery === "unknown") runtime.view.uncertainDelivery = true;
      runtime.view.phase = "error";
      runtime.view.error = message(error);
      throw error;
    } finally {
      runtime.stopping = false;
      this.publish(runtime);
    }
  }

  async closeSession(sessionId: string): Promise<void> {
    const runtime = this.sessions.get(sessionId);
    if (!runtime) return;
    runtime.generation = randomUUID();
    this.sessions.delete(sessionId);
    this.sessionFiles.delete(runtime.view.sessionFile);
    try { await runtime.client.dispose(); }
    finally { await runtime.lease.release(); }
  }

  dispose(): Promise<void> {
    if (this.disposePromise) return this.disposePromise;
    this.disposed = true;
    this.disposePromise = Promise.all([...this.sessions.keys()].map(id => this.closeSession(id))).then(() => {});
    return this.disposePromise;
  }
}
