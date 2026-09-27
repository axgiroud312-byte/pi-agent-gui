/* eslint-disable max-lines -- One supervisor owns Pi startup, events and teardown for the same leased runtime. */
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { PiRpcClient, PiRpcError } from "./pi-rpc-client.js";
import { PiSessionLease } from "./pi-session-lease.js";
import { settlePiSessionBeforeClose } from "./pi-session-teardown.js";
import { getPiHistoryMessages } from "./pi-session-history.js";
import { PiControlBridge } from "./pi-control-bridge.js";
import { piControlRecord, type PiControlAction, type PiControlSnapshot } from "./pi-control-protocol.js";
import { canonicalSessionLeaf, piSessionDirectory, reserveNewSessionPath, sessionFileExists } from "./pi-session-path.js";
import type { PiSessionSupervisorOptions, PiSessionView, SessionRuntime, SupervisorEvents } from "./pi-session-types.js";
import type { PiPromptImage } from "./pi-prompt-images.js";
import { parsePiQueueCatalog, parsePiQueueItem, parsePiQueueMutation, parsePiQueueTakeAll,
  type PiQueueCatalogV1, type PiQueueItemV1, type PiQueueMutationV1,
  type PiQueueOperationV1 } from "./pi-queue-compat.js";
export type { PiSessionPhase, PiSessionView, PiSessionSupervisorOptions } from "./pi-session-types.js";

export interface PiShellResult {
  output: string;
  exitCode: number | null;
  cancelled: boolean;
  truncated: boolean;
}

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

  /** The same environment and flags passed to pinned Pi RPC at startup. */
  settingsEnvironment(): { env: NodeJS.ProcessEnv; rpcArgs: string[] } {
    return { env: { ...process.env, ...this.options.env }, rpcArgs: [...(this.options.rpcArgs ?? [])] };
  }

  /** Resolve the same local Pi profile path that each RPC child receives. */
  getAgentDirectory(workspacePath: string): string {
    const raw = this.options.env?.PI_CODING_AGENT_DIR ?? process.env.PI_CODING_AGENT_DIR ??
      join(homedir(), ".pi", "agent");
    const expanded = raw === "~" ? homedir() : raw.startsWith("~/") || raw.startsWith("~\\")
      ? join(homedir(), raw.slice(2)) : raw;
    return resolve(workspacePath, expanded);
  }

  private publish(runtime: SessionRuntime): void {
    this.emit("change", { ...runtime.view });
  }

  private attach(runtime: SessionRuntime): void {
    const { client, view, generation } = runtime;
    const current = () => this.sessions.get(view.sessionId) === runtime && runtime.generation === generation;
    client.on("record", record => {
      if (!current()) return;
      if (record.type === "extension_ui_request" && typeof record.id === "string" &&
        ["select", "confirm", "input", "editor"].includes(String(record.method))) {
        if (runtime.cancellingExtensionRequests) {
          // A cancelled extension can ask another question before its prompt
          // command finishes. Keep it in Pi, but never show a new live dialog
          // or accept an answer from the renderer after Stop has claimed it.
          if (!runtime.extensionStopQueueReady) {
            // Pi has not acknowledged the queue pause yet. Hold this request
            // rather than letting its answer resume a queued Agent input.
            runtime.pendingExtensionRequests.add(record.id);
          } else {
            void client.notify({ type: "extension_ui_response", id: record.id, cancelled: true })
              .catch(error => {
                if (!current()) return;
                runtime.extensionCancellationError = message(error);
                view.reconciliationRequired = true;
                view.error = `Pi extension cancellation failed: ${message(error)}`;
                this.publish(runtime);
              });
          }
          return;
        }
        runtime.pendingExtensionRequests.add(record.id);
      }
      this.emit("record", view.sessionId, record);
      if (runtime.stopping || !runtime.acceptRunEvents) return;
      switch (record.type) {
        case "agent_start":
          if (view.phase !== "retrying") {
            // Overflow compaction resumes via agent_start, without a model
            // auto_retry_end. Clear only the recovered model error; extension
            // and protocol failures still belong to this run. sendText resets
            // run ownership when a genuinely new input is admitted.
            runtime.hadRunError = runtime.persistentRunError;
            if (!runtime.persistentRunError && view.error === runtime.modelRetryError &&
              !view.uncertainDelivery && !view.reconciliationRequired) {
              view.error = undefined;
            }
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
            // Compaction can follow a transient model error. Show its actual
            // failure, while preserving an independent extension/protocol error.
            if (!view.error || view.error === runtime.modelRetryError) {
              view.error = typeof record.errorMessage === "string" && record.errorMessage
                ? record.errorMessage : record.aborted ? "Pi compaction aborted" : "Pi compaction failed";
            }
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
      const cleanupKey = view.temporary ? view.sessionId : view.sessionFile;
      const cleanup = client.dispose().then(() => runtime.lease?.release()).catch(error => {
        this.emit("diagnostic", view.sessionId,
          { kind: "process", message: `Could not finish Pi exit cleanup: ${message(error)}` });
        throw error;
      }).then(() => {
        if (this.exitCleanups.get(cleanupKey) === cleanup) this.exitCleanups.delete(cleanupKey);
      });
      this.exitCleanups.set(cleanupKey, cleanup);
      runtime.controlBridge.dispose();
      void cleanup.catch(() => {}); // Resume/dispose still observe the rejected owner barrier.
    });
  }

  private async start(workspacePath: string, args: string[], expectedId?: string, knownSessionFile?: string,
    reservedLease?: PiSessionLease, temporary = false): Promise<PiSessionView> {
    let client: PiRpcClient | undefined;
    let lease = reservedLease;
    let bootstrapDialog: ((record: Record<string, unknown>) => void) | undefined;
    const bootstrapUiRecords: Record<string, unknown>[] = [];
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
        if (record.type === "extension_ui_request" &&
          ["notify", "setStatus", "setWidget", "setTitle", "set_editor_text"].includes(String(record.method)) &&
          !piControlRecord(record) &&
          bootstrapUiRecords.length < 128) bootstrapUiRecords.push(record);
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
      if (typeof state.sessionId !== "string" ||
        (temporary ? state.sessionFile !== undefined : typeof state.sessionFile !== "string")) {
        throw new Error("Pi get_state omitted session identity");
      }
      if (this.disposed) throw new Error("Pi session supervisor is disposed");
      if (knownSessionFile) {
        if (typeof state.sessionFile !== "string") throw new Error("Pi did not return a leased history file");
        const actualFile = await canonicalSessionLeaf(state.sessionFile);
        if (actualFile !== knownSessionFile ||
          (await sessionFileExists(state.sessionFile) && await realpath(state.sessionFile) !== knownSessionFile)) {
          throw new Error("Pi restored a different history file than the leased file");
        }
      }
      if (expectedId && state.sessionId !== expectedId) {
        throw new Error(`Pi restored a different session (${state.sessionId}) than requested (${expectedId})`);
      }
      if (this.sessions.has(state.sessionId) ||
        (typeof state.sessionFile === "string" && this.sessionFiles.has(state.sessionFile))) {
        throw new Error("Pi session is already owned by an active process");
      }
      if (!client.pid) throw new Error("Pi process has no PID");
      if (!lease && !temporary) throw new Error("Pi runtime started without a protected session file");
      // Disposal may have begun while the pre-acquired lease was being marked.
      if (this.disposed) throw new Error("Pi session supervisor is disposed");
      const view: PiSessionView = {
        sessionId: state.sessionId,
        sessionFile: temporary ? "" : state.sessionFile as string,
        ...(temporary ? { temporary: true } : {}),
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
        controlBridge: new PiControlBridge(client),
        generation: randomUUID(),
        stopping: false,
        acceptRunEvents: state.isStreaming === true || state.isCompacting === true,
        hadRunError: false,
        persistentRunError: false,
        pendingExtensionRequests: new Set(),
        cancellingExtensionRequests: false,
        extensionStopQueueReady: false,
        lease,
      };
      this.sessions.set(view.sessionId, runtime);
      if (!temporary) this.sessionFiles.set(view.sessionFile, view.sessionId);
      this.attach(runtime);
      client.off("record", bootstrapDialog);
      bootstrapDialog = undefined;
      // Pi can emit public extension UI during session_start, before a native
      // session record exists. Replay into the Host's per-session projection.
      for (const record of bootstrapUiRecords) this.emit("record", view.sessionId, record);
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

  /** Resolve the same Pi session directory used for new RPC sessions and CLI history discovery. */
  sessionDirectory(workspacePath: string): Promise<string> {
    return piSessionDirectory(workspacePath, { ...process.env, ...this.options.env }, this.options.rpcArgs ?? []);
  }

  createSession(workspacePath: string, storageMode: "persistent" | "temporary" = "persistent"): Promise<PiSessionView> {
    if (this.disposed) return Promise.reject(new Error("Pi session supervisor is disposed"));
    return this.trackStart((async () => {
      if (!isAbsolute(workspacePath) || !(await stat(workspacePath)).isDirectory()) {
        throw new Error("Pi workspace path must be an existing absolute directory");
      }
      if (storageMode === "temporary") {
        return this.start(workspacePath, ["--no-session"], undefined, undefined, undefined, true);
      }
      const file = await reserveNewSessionPath(workspacePath,
        { ...process.env, ...this.options.env }, this.options.rpcArgs ?? []);
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

  async readControlBridge(sessionId: string): Promise<PiControlSnapshot> {
    const runtime = this.requireSession(sessionId);
    if (runtime.view.uncertainDelivery || runtime.view.reconciliationRequired) {
      throw new Error("Pi session requires reconciliation before tree control");
    }
    return runtime.controlBridge.refresh();
  }

  getLlamaAuth(sessionId: string): Promise<{ serverUrl: string; apiKey?: string }> {
    const runtime = this.requireSession(sessionId);
    if (runtime.view.uncertainDelivery || runtime.view.reconciliationRequired) {
      throw new Error("Pi session requires reconciliation before router management");
    }
    return runtime.controlBridge.getLlamaAuth();
  }

  refreshLlamaModels(sessionId: string): Promise<void> {
    const runtime = this.requireSession(sessionId);
    if (runtime.view.uncertainDelivery || runtime.view.reconciliationRequired) {
      throw new Error("Pi session requires reconciliation before router catalog refresh");
    }
    return runtime.controlBridge.refreshLlamaModels();
  }

  async runControlBridge(sessionId: string, action: PiControlAction): Promise<PiControlSnapshot> {
    const runtime = this.requireSession(sessionId);
    if (runtime.view.uncertainDelivery || runtime.view.reconciliationRequired) {
      throw new Error("Pi session requires reconciliation before tree control");
    }
    return runtime.controlBridge.act(action);
  }

  cancelTreeNavigation(sessionId: string): Promise<void> {
    return this.requireSession(sessionId).controlBridge.cancelNavigation();
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

  /** Read-only Pi history remains inspectable during command reconciliation. */
  async getEntries(sessionId: string): Promise<{ entries: unknown[]; leafId: string | null }> {
    const response = await this.requireSession(sessionId).client.request({ type: "get_entries" });
    if (!response.success) throw new Error(response.error ?? "Pi get_entries failed");
    const data = object(response.data);
    if (!Array.isArray(data.entries) ||
      !(typeof data.leafId === "string" || data.leafId === null)) {
      throw new Error("Pi get_entries returned invalid history");
    }
    return { entries: data.entries, leafId: data.leafId };
  }

  async getHistoryMessages(sessionId: string): Promise<unknown[]> {
    return getPiHistoryMessages(this.requireSession(sessionId).client, () => this.getMessages(sessionId));
  }

  /** User shell is one direct command to the owned Pi process; Pi writes its own history. */
  async runBash(sessionId: string, command: string, excludeFromContext: boolean): Promise<PiShellResult> {
    const runtime = this.requireSession(sessionId);
    if (typeof command !== "string" || !command.trim() || command.length > 16_384 || command.includes("\0") ||
      typeof excludeFromContext !== "boolean") throw new Error("Invalid Pi shell request");
    if (runtime.controlBridge.blocksPrompt || runtime.view.uncertainDelivery || runtime.view.reconciliationRequired ||
      !["idle", "settled", "stopped", "error"].includes(runtime.view.phase)) {
      throw new Error("Pi session is not ready for a shell command");
    }
    const executionId = randomUUID();
    runtime.view.foregroundExecutionId = executionId;
    runtime.view.directBash = true;
    runtime.view.phase = "running";
    runtime.view.error = undefined;
    this.publish(runtime);
    try {
      const response = await runtime.client.request({ type: "bash", command, excludeFromContext }, 120_000);
      if (!response.success) throw new Error(response.error ?? "Pi shell command failed");
      const data = object(response.data);
      if (typeof data.output !== "string" || typeof data.cancelled !== "boolean" ||
        typeof data.truncated !== "boolean" ||
        data.exitCode !== undefined && (typeof data.exitCode !== "number" || !Number.isInteger(data.exitCode))) {
        throw new Error("Pi shell response is incomplete");
      }
      return { output: data.output, exitCode: typeof data.exitCode === "number" ? data.exitCode : null,
        cancelled: data.cancelled, truncated: data.truncated };
    } catch (error) {
      if (runtime.view.foregroundExecutionId === executionId && !runtime.stopping) {
        if (error instanceof PiRpcError && error.delivery === "unknown") runtime.view.uncertainDelivery = true;
        runtime.view.phase = "error";
        runtime.view.error = message(error);
      }
      throw error;
    } finally {
      runtime.view.directBash = false;
      if (runtime.view.foregroundExecutionId === executionId && !runtime.stopping) {
        runtime.view.foregroundExecutionId = undefined;
        if (runtime.view.phase !== "error") runtime.view.phase = "settled";
      }
      this.publish(runtime);
    }
  }

  /** Manual compaction is an owned foreground Pi command, so native Stop can cancel it. */
  async compact(sessionId: string): Promise<void> {
    const runtime = this.requireSession(sessionId);
    if (runtime.controlBridge.blocksPrompt || runtime.view.uncertainDelivery || runtime.view.reconciliationRequired ||
      !["idle", "settled", "stopped", "error"].includes(runtime.view.phase)) {
      throw new Error("Pi session is not ready for compaction");
    }
    const executionId = randomUUID();
    runtime.hadRunError = false;
    runtime.persistentRunError = false;
    runtime.modelRetryError = undefined;
    runtime.acceptRunEvents = true;
    runtime.view.foregroundExecutionId = executionId;
    runtime.view.directCompaction = true;
    runtime.view.phase = "compacting";
    runtime.view.error = undefined;
    this.publish(runtime);
    try {
      await this.command(sessionId, { type: "compact" });
      const state = await this.getState(sessionId);
      if (state.isCompacting) throw new Error("Pi compaction has not settled");
    } catch (error) {
      // Pi reports an aborted manual compact as a failed RPC response. The
      // separate Stop operation owns the cancellation result and final phase.
      if (runtime.stopping || this.getSession(sessionId)?.phase === "stopped") return;
      if (runtime.view.foregroundExecutionId === executionId && !runtime.stopping) {
        if (error instanceof PiRpcError && error.delivery === "unknown") runtime.view.uncertainDelivery = true;
        runtime.view.phase = "error";
        runtime.view.error = message(error);
      }
      throw error;
    } finally {
      runtime.view.directCompaction = false;
      if (runtime.view.foregroundExecutionId === executionId && !runtime.stopping) {
        runtime.view.foregroundExecutionId = undefined;
        runtime.acceptRunEvents = false;
        if (runtime.view.phase !== "error") runtime.view.phase = "settled";
      }
      this.publish(runtime);
    }
  }

  async setModel(sessionId: string, provider: string, modelId: string, thinkingLevel?: string): Promise<void> {
    const runtime = this.requireSession(sessionId);
    if (runtime.controlBridge.blocksPrompt) throw new Error("Pi tree control is active or requires reconciliation");
    if (runtime.view.uncertainDelivery || runtime.view.reconciliationRequired) throw new Error("Pi session requires reconciliation before model change");
    const model = await runtime.client.request({ type: "set_model", provider, modelId });
    if (!model.success) throw new Error(model.error ?? "Pi rejected the model");
    if (thinkingLevel) {
      const thinking = await runtime.client.request({ type: "set_thinking_level", level: thinkingLevel });
      if (!thinking.success) throw new Error(thinking.error ?? "Pi rejected the thinking level");
    }
  }

  async command(sessionId: string, command: { type: string; [key: string]: unknown }): Promise<unknown> {
    const runtime = this.requireSession(sessionId);
    if (runtime.view.uncertainDelivery || runtime.view.reconciliationRequired) {
      throw new Error("Pi session requires reconciliation before this command");
    }
    const response = await runtime.client.request(command);
    if (!response.success) throw new Error(response.error ?? `Pi rejected ${command.type}`);
    return response.data;
  }

  /** Pi itself renders the active branch; the Host only moves its resulting file. */
  async exportHtml(sessionId: string, outputPath: string): Promise<string> {
    const runtime = this.requireSession(sessionId);
    if (runtime.view.uncertainDelivery || runtime.view.reconciliationRequired) {
      throw new Error("Pi session requires reconciliation before export");
    }
    const response = await runtime.client.request({ type: "export_html", outputPath }, 120_000);
    if (!response.success) throw new Error(response.error ?? "Pi HTML export failed");
    const path = object(response.data).path;
    if (path !== outputPath) throw new Error("Pi returned a different HTML export path");
    return path;
  }

  /** Pi replaces its active JSONL in-place on fork/clone; stop that process before leasing the child. */
  async branchSession(sessionId: string, operation: "fork" | "clone", entryId?: string): Promise<{
    cancelled: boolean; view?: PiSessionView; restoredText?: string;
  }> {
    const runtime = this.requireSession(sessionId);
    if (runtime.view.temporary) throw new Error("Temporary Pi sessions cannot fork or clone into a saved history");
    if (operation === "fork" && (!entryId || entryId.length > 256)) throw new Error("Invalid Pi fork entry ID");
    if (runtime.view.uncertainDelivery || runtime.view.reconciliationRequired ||
      runtime.pendingExtensionRequests.size > 0 || !["idle", "settled", "stopped"].includes(runtime.view.phase)) {
      throw new Error("Pi session must be settled before branching");
    }
    const before = await this.getState(sessionId);
    if (before.isStreaming || before.isCompacting || Number(before.pendingMessageCount) !== 0) {
      throw new Error("Pi session has active or queued work; finish it before branching");
    }
    let acknowledged = false;
    try {
      const response = await runtime.client.request(operation === "fork"
        ? { type: "fork", entryId } : { type: "clone" });
      if (!response.success) throw new Error(response.error ?? `Pi ${operation} failed`);
      acknowledged = true;
      const result = object(response.data);
      if (typeof result.cancelled !== "boolean") throw new Error(`Pi ${operation} omitted cancelled state`);
      const stateResponse = await runtime.client.request({ type: "get_state" });
      if (!stateResponse.success) throw new Error(stateResponse.error ?? "Pi get_state after branch failed");
      const after = object(stateResponse.data);
      if (result.cancelled) {
        if (after.sessionId !== sessionId || after.sessionFile !== runtime.view.sessionFile) {
          throw new Error("Pi cancelled a branch but changed the active session");
        }
        return { cancelled: true };
      }
      if (typeof after.sessionId !== "string" || !after.sessionId || after.sessionId === sessionId ||
        typeof after.sessionFile !== "string" || !isAbsolute(after.sessionFile) ||
        after.sessionFile === runtime.view.sessionFile || !(await stat(after.sessionFile)).isFile()) {
        throw new Error("Pi branch did not create a distinct session identity and JSONL file");
      }
      const childFile = await realpath(after.sessionFile);
      const childId = after.sessionId;
      const workspacePath = runtime.view.workspacePath;
      // The old Pi runtime has already switched files. Dispose and verify its
      // process tree before releasing the old file lease and resuming the child.
      await this.closeSession(sessionId);
      const view = await this.resumeSession(workspacePath, childFile, childId);
      return { cancelled: false, view,
        ...(operation === "fork" && typeof result.text === "string" ? { restoredText: result.text } : {}) };
    } catch (error) {
      if (!acknowledged) throw error;
      throw Object.assign(new Error("Pi acknowledged a branch but its final session identity is uncertain; inspect Pi history before retrying"),
        { delivery: "unknown" as const, cause: error });
    }
  }

  /** Refuse queue editing unless the exact pinned Pi compatibility protocol is live. */
  async requireQueueCompatibility(sessionId: string): Promise<void> {
    const capabilities = object(await this.command(sessionId, { type: "pi_gui_queue_capabilities_v1" }));
    if (capabilities.protocol !== "pi-gui-queue/1" || capabilities.codingAgent !== "0.87.0" ||
      capabilities.agentCore !== "0.87.1" || capabilities.stableItemIds !== true ||
      capabilities.atomicRevision !== true || capabilities.images !== true) {
      throw new Error("Pinned Pi queue compatibility version is unavailable");
    }
  }

  async getQueueCatalog(sessionId: string): Promise<PiQueueCatalogV1> {
    await this.requireQueueCompatibility(sessionId);
    return parsePiQueueCatalog(await this.command(sessionId, { type: "pi_gui_queue_catalog_v1" }));
  }

  async setQueuePaused(sessionId: string, expectedRevision: number, paused: boolean): Promise<PiQueueCatalogV1> {
    await this.requireQueueCompatibility(sessionId);
    return parsePiQueueCatalog(await this.command(sessionId,
      { type: "pi_gui_queue_set_paused_v1", expectedRevision, paused }));
  }

  async resumeQueue(sessionId: string, expectedRevision: number): Promise<{ catalog: PiQueueCatalogV1; promotedId: string | null }> {
    await this.requireQueueCompatibility(sessionId);
    const runtime = this.requireSession(sessionId);
    const wasIdle = ["idle", "settled", "stopped", "error"].includes(runtime.view.phase);
    const oldPhase = runtime.view.phase;
    if (wasIdle) {
      runtime.hadRunError = false;
      runtime.persistentRunError = false;
      runtime.modelRetryError = undefined;
      runtime.acceptRunEvents = true;
      runtime.view.phase = "accepted";
      runtime.view.foregroundExecutionId = randomUUID();
      this.publish(runtime);
    }
    let raw: Record<string, unknown>;
    try {
      raw = object(await this.command(sessionId, { type: "pi_gui_queue_resume_v1", expectedRevision }));
    } catch (error) {
      if (wasIdle) {
        if (error instanceof PiRpcError && error.delivery === "unknown") {
          runtime.view.uncertainDelivery = true;
          runtime.view.reconciliationRequired = true;
          runtime.view.phase = "error";
          runtime.view.error = "Pi queue resume delivery is unknown; inspect history before another input";
        } else {
          runtime.view.phase = oldPhase;
          runtime.view.foregroundExecutionId = undefined;
          runtime.acceptRunEvents = false;
        }
        this.publish(runtime);
      }
      throw error;
    }
    if (raw.promotedId !== null && typeof raw.promotedId !== "string") {
      throw new Error("Pi queue returned an invalid promoted ID");
    }
    const catalog = parsePiQueueCatalog(raw.catalog);
    runtime.view.queuePaused = catalog.paused;
    if (wasIdle && raw.promotedId === null && runtime.view.phase === "accepted") {
      runtime.view.phase = oldPhase;
      runtime.view.foregroundExecutionId = undefined;
      runtime.acceptRunEvents = false;
    }
    this.publish(runtime);
    return { catalog, promotedId: raw.promotedId as string | null };
  }

  async readQueueItem(sessionId: string, expectedRevision: number, queueItemId: string): Promise<PiQueueItemV1> {
    await this.requireQueueCompatibility(sessionId);
    return parsePiQueueItem(await this.command(sessionId,
      { type: "pi_gui_queue_read_item_v1", expectedRevision, queueItemId }));
  }

  async mutateQueue(sessionId: string, expectedRevision: number,
    operation: PiQueueOperationV1): Promise<PiQueueMutationV1> {
    await this.requireQueueCompatibility(sessionId);
    return parsePiQueueMutation(await this.command(sessionId,
      { type: "pi_gui_queue_mutate_v1", expectedRevision, operation }));
  }

  async takeAllQueue(sessionId: string, expectedRevision: number): Promise<{ catalog: PiQueueCatalogV1; takenIds: string[] }> {
    await this.requireQueueCompatibility(sessionId);
    return parsePiQueueTakeAll(await this.command(sessionId, { type: "pi_gui_queue_take_all_v1", expectedRevision }));
  }

  async refreshState(sessionId: string): Promise<Record<string, unknown>> {
    return this.getState(sessionId);
  }

  forgetExtensionRequest(sessionId: string, requestId: string): void {
    this.sessions.get(sessionId)?.pendingExtensionRequests.delete(requestId);
  }

  async respondExtension(sessionId: string, requestId: string,
    response: { value?: string; confirmed?: boolean; cancelled?: true }): Promise<void> {
    const runtime = this.requireSession(sessionId);
    if (runtime.cancellingExtensionRequests || runtime.stopping) {
      throw new Error("Pi extension request is no longer pending after Stop");
    }
    if (!runtime.pendingExtensionRequests.has(requestId)) throw new Error("Pi extension request is no longer pending");
    // Claim before the asynchronous write so two renderer commands cannot both
    // answer the same Pi prompt, or race Stop into delivering a second answer.
    runtime.pendingExtensionRequests.delete(requestId);
    await runtime.client.notify({ type: "extension_ui_response", id: requestId, ...response });
  }

  async enqueueText(sessionId: string, text: string, behavior: "steer" | "followUp",
    images: readonly PiPromptImage[] = []): Promise<
    { kind: "queued"; itemId: string } | { kind: "handled" }> {
    if (!text.trim() && images.length === 0) throw new Error("Pi input is empty");
    if (this.requireSession(sessionId).controlBridge.blocksPrompt) {
      throw new Error("Pi tree control is active or requires reconciliation");
    }
    // The pinned queue contract guarantees an item ID for every actual queue
    // admission. An extension input handler can instead consume the input in
    // Pi immediately, in which case the RPC success body has no item ID.
    await this.requireQueueCompatibility(sessionId);
    const result = object(await this.command(sessionId, {
      type: behavior === "steer" ? "steer" : "follow_up", message: text,
      ...(images.length ? { images: [...images] } : {}),
    }));
    if (typeof result.queueItemId === "string" && result.queueItemId.length > 0) {
      return { kind: "queued", itemId: result.queueItemId };
    }
    if (Object.keys(result).length === 0) return { kind: "handled" };
    throw new Error("Pinned Pi returned an invalid queue admission");
  }

  async sendText(sessionId: string, text: string, images: readonly PiPromptImage[] = [],
    onEffectiveTextHash?: (hash: string) => Promise<void> | void): Promise<
    "run" | "handledCommand" | "handledInput" | "noRun" | "reconcile"> {
    const runtime = this.requireSession(sessionId);
    if (runtime.controlBridge.blocksPrompt) throw new Error("Pi tree control is active or requires reconciliation");
    if (runtime.view.uncertainDelivery || runtime.view.reconciliationRequired) {
      throw new Error("Pi session requires reconciliation before another input");
    }
    if (!["idle", "settled", "stopped", "error"].includes(runtime.view.phase)) throw new Error("Pi session is already busy");
    if (text.trim().length === 0 && images.length === 0) throw new Error("Pi input is empty");
    runtime.hadRunError = false;
    runtime.persistentRunError = false;
    runtime.modelRetryError = undefined;
    runtime.acceptRunEvents = true;
    runtime.view.error = undefined;
    runtime.view.phase = "accepted";
    runtime.view.clearedQueue = undefined;
    // Allocate before sending: events may arrive before the admission response.
    // This is an execution identity, distinct from the process generation.
    const executionId = randomUUID();
    runtime.view.foregroundExecutionId = executionId;
    this.publish(runtime);
    let registeredExtensionCommand = false;
    let promptDisposition: unknown;
    try {
      // Claim the admission synchronously before this catalog lookup, so two
      // concurrent callers cannot both cross the busy check above.
      if (text.startsWith("/")) {
        const name = text.slice(1).split(" ", 1)[0];
        try {
          const commands = await runtime.client.request({ type: "get_commands" });
          const catalog = commands.success ? object(commands.data).commands : undefined;
          registeredExtensionCommand = Array.isArray(catalog) && catalog.some(command =>
            typeof command === "object" && command !== null && !Array.isArray(command) &&
            command.name === name && command.source === "extension");
        } catch { /* Without a Pi catalog, keep the existing fail-closed no-run path. */ }
        if (registeredExtensionCommand && images.length > 0) {
          throw new Error("Pi extension commands do not consume prompt images; remove or send the images separately");
        }
      }
      if (runtime.stopping || runtime.view.foregroundExecutionId !== executionId || runtime.view.phase !== "accepted") {
        throw new Error("Pi input was stopped before delivery");
      }
      const response = await runtime.client.request({ type: "prompt", message: text,
        ...(images.length ? { images: [...images] } : {}) });
      if (!response.success) throw new Error(response.error ?? "Pi rejected the prompt");
      const admission = object(response.data);
      promptDisposition = admission.disposition;
      if (promptDisposition === "run" && typeof admission.effectiveTextHash === "string" &&
        /^[0-9a-f]{64}$/u.test(admission.effectiveTextHash)) {
        // Pi has admitted this prompt. Let the owner durably correlate the
        // effective user text before any later state read or process exit.
        await onEffectiveTextHash?.(admission.effectiveTextHash);
      }
    } catch (error) {
      if (!runtime.stopping && runtime.view.foregroundExecutionId === executionId) {
        runtime.acceptRunEvents = false;
        if (error instanceof PiRpcError && error.delivery === "unknown") runtime.view.uncertainDelivery = true;
        else runtime.view.foregroundExecutionId = undefined;
        runtime.view.phase = "error";
        runtime.view.error = message(error);
        this.publish(runtime);
      }
      throw error;
    }
    // Successful prompt response is irrevocable admission. A later read-only
    // query failure cannot invite a second prompt or discard still arriving events.
    try {
      const state = await this.getState(sessionId);
      if (promptDisposition === "handled" && state.isStreaming === false && state.isCompacting === false &&
        !runtime.view.uncertainDelivery && !runtime.view.reconciliationRequired) {
        // Pi's preflight identified this input as handled without a model run.
        // A prior turn can settle during the state read, and other Pi queue
        // items can remain pending; neither changes this prompt's disposition.
        runtime.view.phase = runtime.hadRunError || runtime.view.error ? "error" : "settled";
        runtime.view.foregroundExecutionId = undefined;
        runtime.acceptRunEvents = false;
        this.publish(runtime);
        return registeredExtensionCommand ? "handledCommand" : "handledInput";
      }
      if (runtime.view.phase === "accepted" && state.isStreaming === false && state.isCompacting === false && state.pendingMessageCount === 0) {
        if (promptDisposition === undefined && registeredExtensionCommand &&
          !runtime.view.uncertainDelivery && !runtime.view.reconciliationRequired) {
          runtime.view.phase = runtime.hadRunError || runtime.view.error ? "error" : "settled";
          runtime.view.foregroundExecutionId = undefined;
          runtime.acceptRunEvents = false;
          this.publish(runtime);
          return registeredExtensionCommand ? "handledCommand" : "handledInput";
        }
        // Pinned Pi reports the preflight disposition before agent_start. An
        // idle state read at this instant cannot override its accepted run.
        if (promptDisposition === "run") return "run";
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
    runtime.cancellingExtensionRequests = true;
    runtime.extensionStopQueueReady = false;
    runtime.extensionCancellationError = undefined;
    const extensionRequests = [...runtime.pendingExtensionRequests];
    runtime.pendingExtensionRequests.clear();
    runtime.acceptRunEvents = false;
    runtime.view.phase = "stopping";
    this.publish(runtime);
    try {
      // Pause Pi's authoritative queue before releasing a blocked extension;
      // otherwise its handler can let the agent drain the next queued input.
      // Even if pause fails, cancel the visible dialogs and fail closed.
      let pauseError: unknown;
      try {
        const queue = await this.getQueueCatalog(sessionId);
        const paused = await this.setQueuePaused(sessionId, queue.revision, true);
        runtime.view.queuePaused = paused.paused;
      } catch (error) { pauseError = error; }
      runtime.extensionStopQueueReady = true;
      extensionRequests.push(...runtime.pendingExtensionRequests);
      runtime.pendingExtensionRequests.clear();
      await Promise.all(extensionRequests.map(requestId => runtime.client.notify({
        type: "extension_ui_response", id: requestId, cancelled: true,
      })));
      if (pauseError) throw pauseError;
      const [bash, retry] = await Promise.all([
        runtime.client.request({ type: "abort_bash" }),
        runtime.client.request({ type: "abort_retry" }),
      ]);
      if (!bash.success) throw new Error(bash.error ?? "Pi abort_bash failed");
      if (!retry.success) throw new Error(retry.error ?? "Pi abort_retry failed");
      const abort = await runtime.client.request({ type: "abort" });
      if (!abort.success) throw new Error(abort.error ?? "Pi abort failed");
      if (runtime.view.directBash && !await runtime.client.waitForPendingCommand("bash", 3_000)) {
        throw new Error("Pi shell command did not settle after abort_bash");
      }
      if (runtime.view.directCompaction && !await runtime.client.waitForPendingCommand("compact", 300)) {
        // Pi's manual compact begins with its own asynchronous abort() before
        // creating the compaction controller. Stop may arrive in that gap.
        const secondAbort = await runtime.client.request({ type: "abort" });
        if (!secondAbort.success) throw new Error(secondAbort.error ?? "Pi abort failed");
        if (!await runtime.client.waitForPendingCommand("compact", 2_700)) {
          throw new Error("Pi compaction did not settle after abort");
        }
      }
      // An extension command can issue a later dialog after its first answer.
      // An idle get_state is not proof that the RPC prompt handler has ended.
      if (!await runtime.client.waitForPendingCommand("prompt", 3_000)) {
        throw new Error("Pi extension command did not settle after Stop");
      }
      if (runtime.extensionCancellationError) {
        throw new Error(`Pi extension cancellation failed: ${runtime.extensionCancellationError}`);
      }
      const state = await this.getState(sessionId);
      if (state.isStreaming || state.isCompacting || !runtime.view.queuePaused) {
        throw new Error("Pi did not settle after stop");
      }
      runtime.view.phase = "stopped";
      runtime.view.foregroundExecutionId = undefined;
      runtime.view.reconciliationRequired = false;
      runtime.view.error = undefined;
      runtime.cancellingExtensionRequests = false;
      runtime.extensionStopQueueReady = false;
      return "stopped";
    } catch (error) {
      if (error instanceof PiRpcError && error.delivery === "unknown") runtime.view.uncertainDelivery = true;
      runtime.view.reconciliationRequired = true;
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
      runtime.controlBridge.dispose();
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
      await runtime.lease?.release();
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
