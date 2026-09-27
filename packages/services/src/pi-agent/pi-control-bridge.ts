import { randomUUID } from "node:crypto";
import { PiRpcClient } from "./pi-rpc-client.js";
import {
  PI_CONTROL_COMMAND, PI_CONTROL_DESCRIPTION, PI_CONTROL_PREFIX, PI_CONTROL_PROTOCOL,
  PI_CONTROL_VERSION, piControlAction, piControlObject, piControlRecord,
  type PiControlAction, type PiControlInfo, type PiControlInspection, type PiControlOperation,
  type PiControlReply, type PiControlResult, type PiControlSnapshot,
} from "./pi-control-protocol.js";

const PINNED_PI_VERSION = "0.87.0";
const reloadOperations = new Set<PiControlOperation>(["reload", "package_install", "package_remove",
  "package_update", "package_filter", "resource_write", "resource_create", "resource_toggle"]);

export class PiControlError extends Error {
  constructor(readonly code: string, message: string, readonly uncertain = false) {
    super(message);
    this.name = "PiControlError";
  }
}

interface PendingControl {
  operation: PiControlOperation;
  resolve(reply: PiControlReply): void;
  reject(error: Error): void;
}

/** One controller for one leased Pi RPC child; no second Agent, history or queue. */
export class PiControlBridge {
  private readonly pending = new Map<string, PendingControl>();
  private current?: PiControlSnapshot;
  private busy = false;
  private uncertain = false;
  private closed = false;

  constructor(private readonly client: PiRpcClient, private readonly timeoutMs = 120_000) {
    client.on("record", this.receive);
    client.on("exit", this.exited);
  }

  get blocksPrompt(): boolean { return this.busy || this.uncertain; }
  get snapshot(): PiControlSnapshot | undefined { return this.current; }

  private readonly exited = (): void => this.dispose();
  private readonly receive = (record: Record<string, unknown>): void => {
    if (!piControlRecord(record)) return;
    let reply: PiControlReply;
    try { reply = JSON.parse((record.message as string).slice(PI_CONTROL_PREFIX.length)) as PiControlReply; }
    catch { return; }
    const pending = this.pending.get(reply?.id);
    if (!pending) return;
    if (reply.protocol !== PI_CONTROL_PROTOCOL || reply.operation !== pending.operation || typeof reply.ok !== "boolean") {
      pending.reject(new PiControlError("BAD_REPLY", "Pi bridge correlation or protocol does not match", true));
      return;
    }
    if (!reply.ok) {
      pending.reject(new PiControlError(reply.error?.code ?? "CONTROL_FAILED",
        reply.error?.message ?? "Pi bridge operation failed"));
      return;
    }
    if (reply.bridgeVersion !== PI_CONTROL_VERSION || reply.piVersion !== PINNED_PI_VERSION || reply.mode !== "rpc" ||
      typeof reply.generation !== "string" || !reply.generation ||
      typeof reply.sessionId !== "string" || !reply.sessionId || !Array.isArray(reply.operations)) {
      pending.reject(new PiControlError("VERSION_MISMATCH", "Pi or bridge version and binding are incompatible", true));
      return;
    }
    pending.resolve(reply);
  };

  private async native(type: string): Promise<Record<string, unknown>> {
    const response = await this.client.request({ type });
    if (!response.success) throw new PiControlError("RPC_REJECTED", response.error ?? `Pi ${type} failed`);
    return piControlObject(response.data);
  }

  private async discover(): Promise<void> {
    const { commands } = await this.native("get_commands");
    if (!Array.isArray(commands) || !commands.some(item => {
      const command = piControlObject(item);
      return command.name === PI_CONTROL_COMMAND && command.source === "extension" &&
        command.description === PI_CONTROL_DESCRIPTION;
    })) {
      throw new PiControlError("MISSING_BRIDGE", "Pi public control bridge is unavailable; no control prompt was sent");
    }
  }

  private async request(operation: PiControlOperation, binding?: PiControlInfo,
    action?: PiControlAction): Promise<PiControlReply> {
    // Repeat discovery immediately before every slash control. A missing or
    // replaced extension must never become literal model input.
    await this.discover();
    if (this.closed) throw new PiControlError("CLOSED", "Pi control process has closed", true);
    const id = randomUUID();
    const envelope = { protocol: PI_CONTROL_PROTOCOL, id, operation,
      generation: binding?.generation, sessionId: binding?.sessionId, params: action };
    let timer: ReturnType<typeof setTimeout> | undefined;
    const control = new Promise<PiControlReply>((resolve, reject) => {
      this.pending.set(id, { operation, resolve, reject });
      timer = setTimeout(() => reject(new PiControlError("TIMEOUT",
        "Pi control result timed out; read native state before retrying", true)), this.timeoutMs);
    });
    try {
      const accepted = this.client.request({ type: "prompt",
        message: `/${PI_CONTROL_COMMAND} ${JSON.stringify(envelope)}` }, this.timeoutMs).then(response => {
        if (!response.success) throw new PiControlError("RPC_REJECTED", response.error ?? "Pi rejected control command");
      });
      const [reply] = await Promise.all([control, accepted]);
      if (operation !== "handshake" && (reply.sessionId !== binding?.sessionId ||
        (!reloadOperations.has(operation) && reply.generation !== binding?.generation))) {
        throw new PiControlError("STALE_REPLY", "Pi control reply belongs to a stale session", true);
      }
      if (reloadOperations.has(operation) && reply.generation === binding?.generation) {
        throw new PiControlError("STALE_REPLY", "Pi reload retained the old bridge generation", true);
      }
      const result = piControlObject(reply.result);
      if (operation === "navigate" && typeof result.cancelled !== "boolean" ||
        operation === "refresh_models" && result.modelsRefreshed !== true ||
        operation === "resource_read" &&
          (typeof piControlObject(result.resource).content !== "string" ||
            typeof piControlObject(result.resource).hash !== "string") ||
        reloadOperations.has(operation) && result.reloaded !== true) {
        throw new PiControlError("BAD_REPLY", "Pi control result is incomplete", true);
      }
      return reply;
    } finally {
      clearTimeout(timer);
      this.pending.delete(id);
    }
  }

  private async readCurrent(): Promise<PiControlSnapshot> {
    const initialState = await this.native("get_state");
    if (initialState.isStreaming || initialState.isCompacting || initialState.pendingMessageCount) {
      throw new PiControlError("BUSY", "Pi must be idle before reading the control bridge");
    }
    const handshake = await this.request("handshake");
    const info: PiControlInfo = { protocol: handshake.protocol, bridgeVersion: handshake.bridgeVersion,
      piVersion: handshake.piVersion, generation: handshake.generation, sessionId: handshake.sessionId,
      mode: handshake.mode, operations: handshake.operations };
    if (info.sessionId !== initialState.sessionId || !info.operations.includes("inspect")) {
      throw new PiControlError("STATE_CHANGED", "Pi bridge session changed during inspection", true);
    }
    const inspected = await this.request("inspect", info);
    const inspection = inspected.result as PiControlInspection | undefined;
    if (!inspection || !Array.isArray(inspection.tools) || !Array.isArray(inspection.activeTools) ||
      !Array.isArray(inspection.commands) || !inspection.promptOptions || !Array.isArray(inspection.packages) ||
      !Array.isArray(inspection.systemPromptFiles) || !Array.isArray(inspection.availableResources) ||
      !Array.isArray(inspection.diagnostics) || typeof inspection.skillCommandsEnabled !== "boolean") {
      throw new PiControlError("BAD_REPLY", "Pi bridge inspection is incomplete", true);
    }
    const tree = await this.native("get_tree");
    const entries = await this.native("get_entries");
    const finalState = await this.native("get_state");
    if (finalState.sessionId !== info.sessionId || finalState.isStreaming || finalState.isCompacting ||
      finalState.pendingMessageCount || tree.leafId !== entries.leafId || !Array.isArray(tree.tree) ||
      !Array.isArray(entries.entries)) {
      throw new PiControlError("STATE_CHANGED", "Pi native tree changed during inspection", true);
    }
    const snapshot: PiControlSnapshot = { info, inspection,
      tree: tree.tree as PiControlSnapshot["tree"], entries: entries.entries as PiControlSnapshot["entries"],
      leafId: tree.leafId as string | null };
    this.current = snapshot;
    this.uncertain = false;
    return snapshot;
  }

  async refresh(): Promise<PiControlSnapshot> {
    if (this.busy) throw new PiControlError("BUSY", "Pi bridge is handling another control");
    this.busy = true;
    try { return await this.readCurrent(); }
    catch (error) {
      if (!(error instanceof PiControlError) || error.uncertain) this.uncertain = true;
      throw error;
    } finally { this.busy = false; }
  }

  /** Resolve Pi's own llama.cpp provider credential, without exposing it to the renderer. */
  async getLlamaAuth(): Promise<{ serverUrl: string; apiKey?: string }> {
    if (this.blocksPrompt) throw new PiControlError("BUSY", "Pi bridge is busy or needs reconciliation");
    this.busy = true;
    try {
      const snapshot = await this.readCurrent();
      if (!snapshot.info.operations.includes("router_auth")) {
        throw new PiControlError("UNAVAILABLE", "Pi router auth bridge is unavailable");
      }
      const reply = await this.request("router_auth", snapshot.info);
      const result = piControlObject(reply.result);
      if (typeof result.serverUrl !== "string" || !result.serverUrl ||
        result.apiKey !== undefined && typeof result.apiKey !== "string") {
        throw new PiControlError("BAD_REPLY", "Pi router auth result is incomplete", true);
      }
      return { serverUrl: result.serverUrl,
        ...(typeof result.apiKey === "string" ? { apiKey: result.apiKey } : {}) };
    } finally { this.busy = false; }
  }

  /** Pi's bundled provider alone determines which router models can be selected. */
  async refreshLlamaModels(): Promise<void> {
    if (this.blocksPrompt) throw new PiControlError("BUSY", "Pi bridge is busy or needs reconciliation");
    this.busy = true;
    try {
      const snapshot = await this.readCurrent();
      if (!snapshot.info.operations.includes("router_refresh")) {
        throw new PiControlError("UNAVAILABLE", "Pi router refresh bridge is unavailable");
      }
      const reply = await this.request("router_refresh", snapshot.info);
      if (piControlObject(reply.result).catalogRefreshed !== true) {
        throw new PiControlError("BAD_REPLY", "Pi router catalog refresh was not confirmed", true);
      }
    } finally { this.busy = false; }
  }

  async act(value: unknown): Promise<PiControlSnapshot> {
    const action = piControlAction(value);
    if (this.blocksPrompt) throw new PiControlError("BUSY", "Pi bridge is busy or its result needs reconciliation");
    const binding = this.current?.info;
    if (!binding || !binding.operations.includes(action.operation)) {
      throw new PiControlError("UNAVAILABLE", "Pi bridge capability is unavailable; refresh first");
    }
    if (action.sessionId !== binding.sessionId || action.generation !== binding.generation) {
      throw new PiControlError("STALE_CONTEXT", "Pi control context is stale");
    }
    this.busy = true;
    try {
      const state = await this.native("get_state");
      if (state.sessionId !== action.sessionId || state.isStreaming || state.isCompacting || state.pendingMessageCount) {
        throw new PiControlError("BUSY", "Pi session changed or is running");
      }
      const reply = await this.request(action.operation, binding, action);
      const next = await this.readCurrent();
      return { ...next, result: reply.result as PiControlResult | undefined };
    } catch (error) {
      try { await this.readCurrent(); }
      catch { if (!(error instanceof PiControlError) || error.code !== "MISSING_BRIDGE") this.uncertain = true; }
      if (!(error instanceof PiControlError) || error.uncertain) this.uncertain = true;
      throw error;
    } finally { this.busy = false; }
  }

  async cancelNavigation(): Promise<void> {
    if (![...this.pending.values()].some(item => item.operation === "navigate")) {
      throw new PiControlError("NO_NAVIGATION", "No Pi tree navigation is active");
    }
    await this.native("abort");
  }

  dispose(): void {
    if (this.closed) return;
    this.closed = true;
    for (const item of this.pending.values()) item.reject(new PiControlError("CLOSED", "Pi control process closed", true));
    this.pending.clear();
    this.client.off("record", this.receive);
    this.client.off("exit", this.exited);
  }
}
