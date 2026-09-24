/* eslint-disable max-lines -- One supervisor owns Pi startup, events and teardown for the same leased runtime. */
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { realpath, stat } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { PiRpcClient, PiRpcError } from "./pi-rpc-client.js";
import { PiSessionLease } from "./pi-session-lease.js";
import { settlePiSessionBeforeClose } from "./pi-session-teardown.js";
import { getPiHistoryMessages } from "./pi-session-history.js";
import { canonicalSessionLeaf, reserveNewSessionPath, sessionFileExists } from "./pi-session-path.js";
import type { PiSessionSupervisorOptions, PiSessionView, SessionRuntime, SupervisorEvents } from "./pi-session-types.js";
export type { PiSessionPhase, PiSessionView, PiSessionSupervisorOptions } from "./pi-session-types.js";

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
  private readonly pendingStarts = new Set<Promise<PiSessionView>>();
  private readonly exitCleanups = new Map<string, Promise<void>>();
  private readonly closingSessions = new Map<string, SessionRuntime>();
  private readonly closeFlights = new Map<string, Promise<void>>();

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
      // Pi RPC advertises UI dialogs to extensions, but #34 has no GUI reply
      // bridge. Cancel only blocking dialogs; never grant permissions by default.
      if (record.type === "extension_ui_request" && typeof record.id === "string" &&
        ["select", "confirm", "input", "editor"].includes(String(record.method))) {
        void client.notify({ type: "extension_ui_response", id: record.id, cancelled: true })
          .catch(error => {
            view.uncertainDelivery = true;
            view.error = `Could not cancel Pi extension dialog: ${message(error)}`;
            view.phase = "error";
            this.publish(runtime);
            // A failed cancellation cannot leave an extension waiting forever.
            void client.dispose();
          });
      }
      if (runtime.stopping || !runtime.acceptRunEvents) return;
      switch (record.type) {
        case "agent_start":
          if (view.phase !== "retrying") {
            runtime.hadRunError = false;
            runtime.persistentRunError = false;
            runtime.modelRetryError = undefined;
          }
          view.phase = "running";
          break;
        case "auto_retry_start":
        case "summarization_retry_scheduled":
          view.phase = "retrying";
          break;
        case "auto_retry_end":
        case "summarization_retry_finished":
          view.phase = "running";
          if (record.success === true) {
            runtime.hadRunError = runtime.persistentRunError;
            if (!runtime.persistentRunError && view.error === runtime.modelRetryError &&
              !view.uncertainDelivery && !view.reconciliationRequired) {
              view.error = undefined;
            }
            runtime.modelRetryError = undefined;
          } else if (record.success === false) {
            runtime.hadRunError = true;
          }
          break;
        case "compaction_start":
          view.phase = "compacting";
          break;
        case "compaction_end":
          view.phase = "running";
          if (record.errorMessage || record.aborted) {
            runtime.hadRunError = true;
            runtime.persistentRunError = true;
          }
          break;
        case "message_end": {
          const final = record.message;
          if (typeof final === "object" && final !== null && !Array.isArray(final)) {
            const result = final as Record<string, unknown>;
            if (result.stopReason === "error" || result.errorMessage) {
              runtime.hadRunError = true;
              const modelError = typeof result.errorMessage === "string" ? result.errorMessage : "Pi model run failed";
              if (!view.error || view.error === runtime.modelRetryError) view.error = modelError;
              runtime.modelRetryError = modelError;
            }
          }
          break;
        }
        case "extension_error":
          runtime.hadRunError = true;
          runtime.persistentRunError = true;
          view.error = typeof record.error === "string" ? record.error : "Pi extension failed";
          break;
        case "agent_settled":
          view.phase = runtime.hadRunError || view.uncertainDelivery || view.reconciliationRequired ? "error" : "settled";
          view.foregroundExecutionId = undefined;
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
      // Root exit is not proof that an Agent bash descendant exited. Keep the
      // lease until the client's identity-checked tree cleanup has finished.
      const cleanup = client.dispose().then(() => runtime.lease.release()).catch(error => {
        this.emit("diagnostic", view.sessionId,
          { kind: "process", message: `Could not finish Pi exit cleanup: ${message(error)}` });
        throw error;
      }).then(() => {
        if (this.exitCleanups.get(view.sessionFile) === cleanup) this.exitCleanups.delete(view.sessionFile);
      });
      this.exitCleanups.set(view.sessionFile, cleanup);
      void cleanup.catch(() => {}); // Resume/dispose still observe the rejected owner barrier.
    });
  }

  private async start(workspacePath: string, args: string[], expectedId?: string, knownSessionFile?: string,
    reservedLease?: PiSessionLease): Promise<PiSessionView> {
    let client: PiRpcClient | undefined;
    let lease = reservedLease;
    let bootstrapDialog: ((record: Record<string, unknown>) => void) | undefined;
    let bootstrapDiagnostic: ((diagnostic: { kind: "stderr" | "protocol" | "process"; message: string }) => void) | undefined;
    let startupExtensionError = false;
    const startupDiagnostics: { kind: "stderr" | "protocol" | "process"; message: string }[] = [];
    try {
      if (this.disposed) throw new Error("Pi session supervisor is disposed");
      if (!isAbsolute(workspacePath) || !(await stat(workspacePath)).isDirectory()) {
        throw new Error("Pi workspace path must be an existing absolute directory");
      }
      // Resume acquires its canonical JSONL lease here; create pre-acquires an
      // absent explicit leaf. Both persist quarantine BEFORE any child can start.
      if (knownSessionFile && !lease) lease = await PiSessionLease.acquire(knownSessionFile);
      if (this.disposed) throw new Error("Pi session supervisor is disposed");
      if (!expectedId && knownSessionFile && await sessionFileExists(knownSessionFile)) {
        throw new Error("New Pi history file already exists");
      }
      await lease?.markRuntimeUncertain();
      if (this.disposed) throw new Error("Pi session supervisor is disposed");
      if (!expectedId && knownSessionFile && await sessionFileExists(knownSessionFile)) {
        throw new Error("New Pi history file appeared before startup");
      }
      client = (this.options.clientFactory ?? (options => new PiRpcClient(options)))({
        executable: this.options.executable ?? process.execPath,
        args: [this.options.piEntry, ...args, ...(this.options.rpcArgs ?? [])],
        cwd: workspacePath,
        // Inherit target Pi identity, separate from desktop metadata.
        env: { ...process.env, ...this.options.env, ELECTRON_RUN_AS_NODE: "1" },
      });
      // Extension session_start hooks can ask for a dialog *before* get_state
      // returns and before the runtime is registered. Cancel them at bootstrap.
      const bootClient = client;
      bootstrapDialog = record => {
        if (record.type === "extension_error") startupExtensionError = true;
        if (record.type === "extension_ui_request" && typeof record.id === "string" &&
          ["select", "confirm", "input", "editor"].includes(String(record.method))) {
          void bootClient.notify({ type: "extension_ui_response", id: record.id, cancelled: true })
            .catch(() => { void bootClient.dispose(); });
        }
      };
      client.on("record", bootstrapDialog);
      bootstrapDiagnostic = diagnostic => {
        if (startupDiagnostics.length < 8) startupDiagnostics.push(diagnostic);
      };
      client.on("diagnostic", bootstrapDiagnostic);
      await client.start();
      const response = await client.request({ type: "get_state" });
      if (!response.success) throw new Error(response.error ?? "Pi get_state failed");
      const state = object(response.data);
      if (typeof state.sessionId !== "string" || typeof state.sessionFile !== "string") {
        throw new Error("Pi get_state omitted session identity");
      }
      if (this.disposed) throw new Error("Pi session supervisor is disposed");
      if (knownSessionFile) {
        const actualFile = await canonicalSessionLeaf(state.sessionFile);
        if (actualFile !== knownSessionFile ||
          (await sessionFileExists(state.sessionFile) && await realpath(state.sessionFile) !== knownSessionFile)) {
          throw new Error("Pi restored a different history file than the leased file");
        }
      }
      if (expectedId && state.sessionId !== expectedId) {
        throw new Error(`Pi restored a different session (${state.sessionId}) than requested (${expectedId})`);
      }
      if (this.sessions.has(state.sessionId) || this.sessionFiles.has(state.sessionFile)) {
        throw new Error("Pi session is already owned by an active process");
      }
      if (!client.pid) throw new Error("Pi process has no PID");
      if (!lease) throw new Error("Pi runtime started without a protected session file");
      // Disposal may have begun while the pre-acquired lease was being marked.
      if (this.disposed) throw new Error("Pi session supervisor is disposed");
      const view: PiSessionView = {
        sessionId: state.sessionId,
        sessionFile: state.sessionFile,
        workspacePath,
        pid: client.pid,
        phase: state.isCompacting ? "compacting" : state.isStreaming ? "running" : "idle",
        uncertainDelivery: false,
        foregroundExecutionId: state.isStreaming || state.isCompacting ? randomUUID() : undefined,
      };
      if (startupExtensionError) {
        view.phase = "error";
        view.error = "Pi extension failed during session startup";
      }
      if (startupDiagnostics.some(diagnostic => diagnostic.kind === "protocol")) {
        view.phase = "error";
        view.uncertainDelivery = true;
        view.error = "Pi protocol output was malformed during session startup";
      }
      const runtime: SessionRuntime = {
        view,
        client,
        generation: randomUUID(),
        stopping: false,
        acceptRunEvents: state.isStreaming === true || state.isCompacting === true,
        hadRunError: false,
        persistentRunError: false,
        lease,
      };
      this.sessions.set(view.sessionId, runtime);
      this.sessionFiles.set(view.sessionFile, view.sessionId);
      this.attach(runtime);
      client.off("record", bootstrapDialog);
      bootstrapDialog = undefined;
      client.off("diagnostic", bootstrapDiagnostic);
      bootstrapDiagnostic = undefined;
      for (const diagnostic of startupDiagnostics) this.emit("diagnostic", view.sessionId, diagnostic);
      this.publish(runtime);
      return { ...view };
    } catch (error) {
      if (bootstrapDialog) client?.off("record", bootstrapDialog);
      if (bootstrapDiagnostic) client?.off("diagnostic", bootstrapDiagnostic);
      // Releasing on a rejected dispose would admit a second writer while Pi
      // or a tool descendant might still be alive. Preserve that lease.
      if (client) await client.dispose();
      await lease?.release();
      throw error;
    }
  }

  private trackStart(start: Promise<PiSessionView>): Promise<PiSessionView> {
    this.pendingStarts.add(start);
    void start.then(() => this.pendingStarts.delete(start), () => this.pendingStarts.delete(start));
    return start;
  }

  createSession(workspacePath: string): Promise<PiSessionView> {
    if (this.disposed) return Promise.reject(new Error("Pi session supervisor is disposed"));
    return this.trackStart((async () => {
      if (!isAbsolute(workspacePath) || !(await stat(workspacePath)).isDirectory()) {
        throw new Error("Pi workspace path must be an existing absolute directory");
      }
      const env = { ...process.env, ...this.options.env };
      const file = await reserveNewSessionPath(workspacePath, env, this.options.rpcArgs ?? []);
      if (this.disposed) throw new Error("Pi session supervisor is disposed");
      const lease = await PiSessionLease.acquire(file);
      return this.start(workspacePath, ["--session", file], undefined, file, lease);
    })());
  }

  resumeSession(workspacePath: string, sessionFile: string, expectedId: string): Promise<PiSessionView> {
    if (this.disposed) return Promise.reject(new Error("Pi session supervisor is disposed"));
    return this.trackStart((async () => {
      if (!isAbsolute(sessionFile) || !(await stat(sessionFile)).isFile()) {
        throw new Error("Pi session history file does not exist");
      }
      const canonicalFile = await realpath(sessionFile);
      await this.exitCleanups.get(canonicalFile);
      if (this.disposed) throw new Error("Pi session supervisor is disposed");
      return this.start(workspacePath, ["--session", canonicalFile], expectedId, canonicalFile);
    })());
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

  requireReconciliation(sessionId: string, uncertainDelivery: boolean): PiSessionView {
    const runtime = this.requireSession(sessionId);
    runtime.view.uncertainDelivery ||= uncertainDelivery;
    runtime.view.reconciliationRequired = true;
    runtime.view.phase = "error";
    runtime.view.error = "Pi session recovered after an uncertain run; inspect history before any new input";
    this.publish(runtime);
    return { ...runtime.view };
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

  async getHistoryMessages(sessionId: string): Promise<unknown[]> {
    return getPiHistoryMessages(this.requireSession(sessionId).client, () => this.getMessages(sessionId));
  }

  async setModel(sessionId: string, provider: string, modelId: string, thinkingLevel?: string): Promise<void> {
    const runtime = this.requireSession(sessionId);
    if (runtime.view.uncertainDelivery || runtime.view.reconciliationRequired) throw new Error("Pi session requires reconciliation before model change");
    const model = await runtime.client.request({ type: "set_model", provider, modelId });
    if (!model.success) throw new Error(model.error ?? "Pi rejected the model");
    if (thinkingLevel) {
      const thinking = await runtime.client.request({ type: "set_thinking_level", level: thinkingLevel });
      if (!thinking.success) throw new Error(thinking.error ?? "Pi rejected the thinking level");
    }
  }

  async sendText(sessionId: string, text: string): Promise<"run" | "noRun" | "reconcile"> {
    const runtime = this.requireSession(sessionId);
    if (runtime.view.uncertainDelivery || runtime.view.reconciliationRequired) {
      throw new Error("Pi session requires reconciliation before another input");
    }
    if (!["idle", "settled", "stopped", "error"].includes(runtime.view.phase)) throw new Error("Pi session is already busy");
    if (text.trim().length === 0) throw new Error("Pi input is empty");
    runtime.hadRunError = false;
    runtime.persistentRunError = false;
    runtime.modelRetryError = undefined;
    runtime.acceptRunEvents = true;
    runtime.view.error = undefined;
    runtime.view.phase = "accepted";
    runtime.view.clearedQueue = undefined;
    // Allocate before sending: events may arrive before the admission response.
    // This is an execution identity, distinct from the process generation.
    runtime.view.foregroundExecutionId = randomUUID();
    this.publish(runtime);
    try {
      const response = await runtime.client.request({ type: "prompt", message: text });
      if (!response.success) throw new Error(response.error ?? "Pi rejected the prompt");
    } catch (error) {
      runtime.acceptRunEvents = false;
      if (error instanceof PiRpcError && error.delivery === "unknown") runtime.view.uncertainDelivery = true;
      else runtime.view.foregroundExecutionId = undefined;
      runtime.view.phase = "error";
      runtime.view.error = message(error);
      this.publish(runtime);
      throw error;
    }
    // Successful prompt response is irrevocable admission. A later read-only
    // query failure cannot invite a second prompt or discard still arriving events.
    try {
      const state = await this.getState(sessionId);
      if (runtime.view.phase === "accepted" && state.isStreaming === false && state.isCompacting === false && state.pendingMessageCount === 0) {
        // Extensions may have performed a side effect without a user message.
        // An idle get_state cannot prove that the accepted prompt did nothing.
        runtime.view.phase = "error";
        runtime.view.reconciliationRequired = true;
        runtime.view.error = "Pi handled input without a run; inspect history before another input";
        runtime.view.foregroundExecutionId = undefined;
        runtime.acceptRunEvents = false;
        this.publish(runtime);
        return "noRun";
      }
      return "run";
    } catch (error) {
      runtime.view.reconciliationRequired = true;
      runtime.view.error = `Pi accepted the input, but state reconciliation failed: ${message(error)}`;
      this.publish(runtime);
      return "reconcile";
    }
  }

  async stop(sessionId: string, expectedExecutionId?: string): Promise<"stopped" | "idle" | "stale" | "stopping"> {
    const runtime = this.requireSession(sessionId);
    if (!runtime.view.foregroundExecutionId) return "idle";
    if (expectedExecutionId !== runtime.view.foregroundExecutionId) return "stale";
    if (runtime.stopping) return "stopping";
    // Check and claim synchronously, before clear_queue/abort can yield. A new
    // admission cannot enter while this generation's Stop is pending.
    runtime.stopping = true;
    runtime.acceptRunEvents = false;
    runtime.view.phase = "stopping";
    this.publish(runtime);
    try {
      // Pi's abort continues queued work unless the queues are cleared first.
      const clear = await runtime.client.request({ type: "clear_queue" });
      if (!clear.success) throw new Error(clear.error ?? "Pi clear_queue failed");
      const returned = object(clear.data);
      runtime.view.clearedQueue = {
        steering: Array.isArray(returned.steering) ? returned.steering.filter((value): value is string => typeof value === "string") : [],
        followUp: Array.isArray(returned.followUp) ? returned.followUp.filter((value): value is string => typeof value === "string") : [],
      };
      const abort = await runtime.client.request({ type: "abort" });
      if (!abort.success) throw new Error(abort.error ?? "Pi abort failed");
      const state = await this.getState(sessionId);
      if (state.isStreaming || state.isCompacting || Number(state.pendingMessageCount) > 0) {
        throw new Error("Pi did not settle after stop");
      }
      runtime.view.phase = "stopped";
      runtime.view.foregroundExecutionId = undefined;
      runtime.view.reconciliationRequired = false;
      runtime.view.error = undefined;
      return "stopped";
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

  closeSession(sessionId: string): Promise<void> {
    const existing = this.closeFlights.get(sessionId);
    if (existing) return existing;
    const runtime = this.sessions.get(sessionId) ?? this.closingSessions.get(sessionId);
    if (!runtime) return Promise.resolve();
    if (this.sessions.has(sessionId)) {
      runtime.generation = randomUUID();
      this.sessions.delete(sessionId);
      this.sessionFiles.delete(runtime.view.sessionFile);
      this.closingSessions.set(sessionId, runtime);
    }
    const pending = (async () => {
      let settlingFailure: unknown;
      try { await settlePiSessionBeforeClose(runtime.client, Boolean(runtime.view.foregroundExecutionId)); }
      catch (error) { settlingFailure = error; }
      // A rejected tree cleanup must retain the lock and runtime quarantine.
      // A later owner call can retry verification before releasing it.
      await runtime.client.dispose();
      await runtime.lease.release();
      this.closingSessions.delete(sessionId);
      if (settlingFailure) throw settlingFailure;
    })();
    this.closeFlights.set(sessionId, pending);
    void pending.finally(() => {
      if (this.closeFlights.get(sessionId) === pending) this.closeFlights.delete(sessionId);
    }).catch(() => {});
    return pending;
  }

  dispose(): Promise<void> {
    if (this.disposePromise) return this.disposePromise;
    this.disposed = true;
    this.disposePromise = (async () => {
      // Starts are registered synchronously, before their first await. Drain them
      // before snapshotting sessions so none can register after disposal returns.
      await Promise.allSettled(this.pendingStarts);
      const results = await Promise.allSettled([...new Set([
        ...this.sessions.keys(), ...this.closingSessions.keys(),
      ])].map(id => this.closeSession(id)));
      const exits = await Promise.allSettled(this.exitCleanups.values());
      const failures = [...results, ...exits].filter(result => result.status === "rejected");
      if (failures.length) throw new AggregateError(failures.map(result => result.reason), "Pi session disposal failed");
    })();
    return this.disposePromise;
  }
}
