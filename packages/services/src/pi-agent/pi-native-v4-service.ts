/* eslint-disable max-lines -- The v4 subscription registry and command admission share one Pi session ownership map. */
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { Emitter } from "@zcode/rpc";
import { resolveWorkspaceKey } from "@zcode/shared";
import {
  V4_WIRE_PROTOCOL_VERSION,
  applyConversationDeltas,
  clientHelloSchema,
  commandAckSchema,
  conversationSnapshotSchema,
  conversationTopic,
  conversationTopicFrameSchema,
  parseCommandEnvelope,
  sessionsIndexTopic,
  sessionsIndexTopicFrameSchema,
  workspaceConfigTopic,
  workspaceConfigTopicFrameSchema,
  type CommandAck,
  type ConversationDelta,
  type ConversationSnapshot,
  type ConversationTopicWireCandidate,
  type SessionSummary,
  type StatePatch,
  type SessionsIndexTopicWireCandidate,
  type WorkspaceConfigTopicWireCandidate,
} from "@zcode/shared/zcode-protocol-v4";
import type {
  IZCodeAgentService,
  ZCodeAgentConversationCommandParams,
  ZCodeAgentConversationResyncParams,
  ZCodeAgentConversationRowsRangeParams,
  ZCodeAgentConversationSubscribeParams,
  ZCodeAgentConversationUnsubscribeParams,
  ZCodeAgentSessionsIndexSubscribeParams,
  ZCodeAgentWorkspaceConfigSubscribeParams,
  ZCodeAgentWorkspaceTarget,
  ZCodeAgentCommandsQueryParams,
  ZCodeAgentRuntimeLifecycleEvent,
  ZCodeAgentWorkspaceRuntimeIdentity,
} from "../zcode-agent/zcodeAgent.js";
import { getAppConfigDir } from "../paths.js";
import { PiMessageRows } from "./pi-message-rows.js";
import { PiSessionCatalog } from "./pi-session-catalog.js";
import { PiSessionSupervisor, type PiSessionView } from "./pi-session-supervisor.js";
import { createPiV4Snapshot } from "./pi-v4-snapshot.js";
import { piWireFrames } from "./pi-v4-frames.js";

interface SessionRecord {
  workspaceKey: string;
  workspaceId: string;
  view: PiSessionView;
  state: Record<string, unknown>;
  projection: PiMessageRows;
  snapshot: ConversationSnapshot;
  createdAt: number;
  lastActivityAt: number;
}

interface Subscription {
  id: string;
  workspaceKey: string;
  topic: string;
  ordinal: number;
}

interface IndexLog {
  epoch: string;
  seq: number;
}

type V4Methods = Pick<IZCodeAgentService,
  | "helloConversationV4"
  | "initializeConversationV4"
  | "setConnectionFlowStateV4"
  | "subscribeConversationV4"
  | "resyncConversationV4"
  | "unsubscribeConversationV4"
  | "conversationRowsRangeV4"
  | "sendConversationCommandV4"
  | "queryConversationCommandsV4"
  | "onDynamicConversationFrame"
  | "subscribeSessionsIndexV4"
  | "resyncSessionsIndexV4"
  | "unsubscribeSessionsIndexV4"
  | "onDynamicSessionsIndexFrame"
  | "subscribeWorkspaceConfigV4"
  | "resyncWorkspaceConfigV4"
  | "unsubscribeWorkspaceConfigV4"
  | "onDynamicWorkspaceConfigFrame"
>;

function getEmitter<T>(map: Map<string, Emitter<T>>, key: string): Emitter<T> {
  let emitter = map.get(key);
  if (!emitter) { emitter = new Emitter<T>(); map.set(key, emitter); }
  return emitter;
}

function failure(commandId: string, reasonCode: string, message?: string, revisionAtDecision = 0): CommandAck {
  return { commandId, status: "failed", reasonCode, ...(message ? { message } : {}), revisionAtDecision };
}

function unsupported(commandId: string, type: string, revisionAtDecision: number): CommandAck {
  return failure(commandId, "pi.commandNotImplemented", `Pi adapter does not implement ${type}`, revisionAtDecision);
}

/** Native v4 Agent seam backed exclusively by pinned Pi RPC sessions. */
export class PiNativeV4Service implements V4Methods {
  readonly supervisor: PiSessionSupervisor;
  private readonly sessions = new Map<string, SessionRecord>();
  private readonly subscriptions = new Map<string, Subscription>();
  private readonly indexLogs = new Map<string, IndexLog>();
  private readonly commandResults = new Map<string, Promise<CommandAck>>();
  private readonly reportedCommandFailures = new Set<string>();
  private readonly catalog: PiSessionCatalog;
  private readonly catalogWrites = new Map<string, Promise<boolean>>();
  private readonly workspaceLoads = new Map<string, Promise<void>>();
  private disposePromise?: Promise<void>;
  private readonly conversationEmitters = new Map<string, Emitter<ConversationTopicWireCandidate>>();
  private readonly indexEmitters = new Map<string, Emitter<SessionsIndexTopicWireCandidate>>();
  private readonly configEmitters = new Map<string, Emitter<WorkspaceConfigTopicWireCandidate>>();
  private readonly lifecycleEmitter = new Emitter<ZCodeAgentRuntimeLifecycleEvent>();
  private readonly restartEmitter = new Emitter<{ workspaceKey: string }>();
  private readonly availableWorkspaces = new Map<string, ZCodeAgentWorkspaceTarget>();
  private readonly connectionId = randomUUID();

  // These are real service events. The native RPC Channel treats every onXxx
  // member as an Event and subscribes to it during Host/window startup.
  readonly onAgentRuntimeLifecycle = this.lifecycleEmitter.event;
  readonly onAgentRuntimeRestarted = this.restartEmitter.event;

  getWorkspaceRuntimeIdentity(params: ZCodeAgentWorkspaceTarget): ZCodeAgentWorkspaceRuntimeIdentity {
    const workspaceKey = resolveWorkspaceKey(params);
    return { workspaceKey, generation: 1, identity: `pi:${workspaceKey}` };
  }

  // A native workspace runtime is this stable Host service, NOT one of the Pi
  // session children. Closing an empty draft or a Pi process exit must not
  // invalidate all workspace index subscriptions and remount the composer.
  markWorkspaceAvailable(params: ZCodeAgentWorkspaceTarget): void {
    const workspaceKey = resolveWorkspaceKey(params);
    if (this.availableWorkspaces.has(workspaceKey)) return;
    this.availableWorkspaces.set(workspaceKey, params);
    this.lifecycleEmitter.fire({ ...params, workspaceKey,
      runtimeIdentity: this.getWorkspaceRuntimeIdentity(params), state: "available" });
  }

  constructor(supervisor: PiSessionSupervisor, catalogDir = join(getAppConfigDir(), "pi-sessions")) {
    this.supervisor = supervisor;
    this.catalog = new PiSessionCatalog(catalogDir);
    supervisor.on("record", (sessionId, record) => this.onPiRecord(sessionId, record));
    supervisor.on("change", view => this.onPiChange(view));
  }

  private persist(record: SessionRecord): Promise<boolean> {
    const id = record.view.sessionId;
    const previous = this.catalogWrites.get(id) ?? Promise.resolve(false);
    const pending = previous.catch(() => false).then(() => this.catalog.save({
      sessionId: id, sessionFile: record.view.sessionFile,
      workspacePath: record.view.workspacePath, workspaceKey: record.workspaceKey,
      workspaceId: record.workspaceId, createdAt: record.createdAt,
      lastActivityAt: record.lastActivityAt,
    }));
    this.catalogWrites.set(id, pending);
    void pending.finally(() => {
      if (this.catalogWrites.get(id) === pending) this.catalogWrites.delete(id);
    }).catch(() => {});
    return pending;
  }

  private bookmarkControlChanged(record: SessionRecord): void {
    const control = createPiV4Snapshot(record.view, record.state, record.snapshot.logEpoch).control;
    if (JSON.stringify(control) !== JSON.stringify(record.snapshot.control)) {
      this.emitConversation(record, [{ op: "state.updated", patch: { control } }]);
    }
  }

  private async safelyPersist(record: SessionRecord, requireFile = false): Promise<void> {
    try {
      const saved = await this.persist(record);
      if (!saved && requireFile && record.projection.getRows().some(row => row.kind === "userInput")) {
        throw new Error("Pi JSONL was not created after the run");
      }
      if (saved && record.state.piBookmarkError === true) {
        delete record.state.piBookmarkError;
        delete record.state.piBookmarkErrorAt;
        this.bookmarkControlChanged(record);
      }
    } catch (error) {
      // Never turn an already accepted Pi prompt into a failed ACK: that would
      // invite a duplicate side effect. Surface the history failure in v4 state.
      console.warn("[pi-agent] session bookmark failed",
        error instanceof Error ? error.name : "unknown");
      if (record.state.piBookmarkError !== true) {
        record.state.piBookmarkError = true;
        record.state.piBookmarkErrorAt = Date.now();
        this.bookmarkControlChanged(record);
      }
    }
  }

  private loadWorkspace(params: ZCodeAgentWorkspaceTarget): Promise<void> {
    const workspaceKey = resolveWorkspaceKey(params);
    let pending = this.workspaceLoads.get(workspaceKey);
    if (pending) return pending;
    pending = (async () => {
      const bookmarks = await this.catalog.list(workspaceKey);
      for (const entry of bookmarks) {
        if (entry.workspacePath !== params.workspacePath || this.sessions.has(entry.sessionId)) continue;
        let view: PiSessionView | undefined;
        try {
          view = await this.supervisor.resumeSession(entry.workspacePath, entry.sessionFile, entry.sessionId);
          const [state, messages] = await Promise.all([
            this.supervisor.getState(entry.sessionId), this.supervisor.getMessages(entry.sessionId),
          ]);
          const projection = new PiMessageRows(entry.workspacePath);
          const rows = projection.restore(messages);
          state.messageCount = messages.length;
          const snapshot = conversationSnapshotSchema.parse({
            ...createPiV4Snapshot(view, state, randomUUID()),
            rows: { window: rows, totalCount: rows.length, firstRowId: rows[0]?.rowId ?? null },
          });
          const record: SessionRecord = {
            workspaceKey, workspaceId: entry.workspaceId, view, state, projection, snapshot,
            createdAt: entry.createdAt, lastActivityAt: entry.lastActivityAt,
          };
          this.sessions.set(entry.sessionId, record);
          this.emitIndex(workspaceKey, record);
        } catch (error) {
          if (view) await this.supervisor.closeSession(entry.sessionId);
          console.warn("[pi-agent] could not restore Pi history", entry.sessionId,
            error instanceof Error ? error.name : "unknown");
        }
      }
    })();
    this.workspaceLoads.set(workspaceKey, pending);
    return pending;
  }

  async helloConversationV4(): ReturnType<V4Methods["helloConversationV4"]> {
    return {
      kind: "hello", protocolVersion: V4_WIRE_PROTOCOL_VERSION,
      connectionId: this.connectionId, clientMode: "desktop-continuous", deliveryProfile: "continuous",
      serverTime: Date.now(),
      capabilities: { nativeDialogs: true, localTerminal: true, binaryFrames: false, compression: "none" },
      auth: {},
    };
  }

  async initializeConversationV4(clientHello: Parameters<V4Methods["initializeConversationV4"]>[0]): Promise<void> {
    clientHelloSchema.parse(clientHello);
  }

  async setConnectionFlowStateV4(_params: Parameters<V4Methods["setConnectionFlowStateV4"]>[0]): Promise<void> {
    // Local Pi sessions currently use continuous delivery; no Pi-level flow control exists.
  }

  private indexLog(workspaceKey: string): IndexLog {
    let log = this.indexLogs.get(workspaceKey);
    if (!log) { log = { epoch: randomUUID(), seq: 0 }; this.indexLogs.set(workspaceKey, log); }
    return log;
  }

  private summary(record: SessionRecord): SessionSummary {
    const rows = record.snapshot.rows.window;
    const lastAssistant = [...rows].reverse().find(row => row.kind === "assistantText");
    const firstUser = rows.find(row => row.kind === "userInput");
    const promptTitle = firstUser?.kind === "userInput" ? firstUser.text.trim().slice(0, 100) : "";
    return {
      sessionId: record.view.sessionId,
      workspaceId: record.workspaceId,
      title: record.snapshot.meta.title || promptTitle || "New Pi session",
      titleSource: record.snapshot.meta.title ? record.snapshot.meta.titleSource
        : promptTitle ? "generated" : "default",
      phase: record.snapshot.control.phase,
      sessionEnded: record.snapshot.control.sessionEnded,
      hasBackgroundWork: false,
      lastActivityAt: record.lastActivityAt,
      ...(lastAssistant?.kind === "assistantText" ? { lastAssistantPreview: lastAssistant.text.slice(0, 120) } : {}),
      createdAt: record.createdAt,
    };
  }

  private emitConversation(record: SessionRecord, deltas: ConversationDelta[]): void {
    if (deltas.length === 0) return;
    const priorSeq = record.snapshot.seq;
    const revision = record.snapshot.revision + 1;
    const all = [...deltas, { op: "state.updated" as const, patch: { revision } }];
    record.snapshot = conversationSnapshotSchema.parse({
      ...applyConversationDeltas(record.snapshot, all), seq: priorSeq + 1,
    });
    const topic = conversationTopic(record.view.sessionId);
    for (const sub of this.subscriptions.values()) {
      if (sub.topic !== topic || sub.workspaceKey !== record.workspaceKey) continue;
      const frame = conversationTopicFrameSchema.parse({
        topic, subscriptionId: sub.id, fromSeq: priorSeq, toSeq: record.snapshot.seq,
        sentAt: Date.now(), payload: { kind: "deltas", deltas: all },
      });
      for (const wire of piWireFrames(frame, "online", ++sub.ordinal)) {
        getEmitter(this.conversationEmitters, record.workspaceKey).fire(wire);
      }
    }
  }

  private emitIndex(workspaceKey: string, record: SessionRecord): void {
    const log = this.indexLog(workspaceKey);
    const fromSeq = log.seq++;
    const topic = sessionsIndexTopic(workspaceKey);
    for (const sub of this.subscriptions.values()) {
      if (sub.topic !== topic || sub.workspaceKey !== workspaceKey) continue;
      const frame = sessionsIndexTopicFrameSchema.parse({
        topic, subscriptionId: sub.id, fromSeq, toSeq: log.seq,
        sentAt: Date.now(), payload: { kind: "deltas", deltas: [{ op: "session.upserted", session: this.summary(record) }] },
      });
      for (const wire of piWireFrames(frame, "online", ++sub.ordinal)) {
        getEmitter(this.indexEmitters, workspaceKey).fire(wire);
      }
    }
  }

  private emitIndexRemoval(record: SessionRecord): void {
    const log = this.indexLog(record.workspaceKey);
    const fromSeq = log.seq++;
    const topic = sessionsIndexTopic(record.workspaceKey);
    for (const sub of this.subscriptions.values()) {
      if (sub.topic !== topic || sub.workspaceKey !== record.workspaceKey) continue;
      const frame = sessionsIndexTopicFrameSchema.parse({
        topic, subscriptionId: sub.id, fromSeq, toSeq: log.seq, sentAt: Date.now(),
        payload: { kind: "deltas", deltas: [{ op: "session.removed", sessionId: record.view.sessionId }] },
      });
      for (const wire of piWireFrames(frame, "online", ++sub.ordinal)) {
        getEmitter(this.indexEmitters, record.workspaceKey).fire(wire);
      }
    }
  }

  private onPiRecord(sessionId: string, event: Record<string, unknown>): void {
    const record = this.sessions.get(sessionId);
    if (!record) return;
    const deltas = record.projection.apply(event);
    if (deltas.length > 0) {
      record.lastActivityAt = Date.now();
      record.state.messageCount = record.projection.getRows().length;
    }
    if (event.type === "message_end" || event.type === "agent_settled") {
      void this.safelyPersist(record, event.type === "agent_settled");
    }
    if (deltas.length === 0) return;
    this.emitConversation(record, deltas);
    this.emitIndex(record.workspaceKey, record);
  }

  private onPiChange(view: PiSessionView): void {
    const record = this.sessions.get(view.sessionId);
    if (!record) return;
    const oldPhase = record.view.phase;
    record.view = view;
    if (oldPhase !== view.phase && ["accepted", "running", "retrying", "compacting"].includes(view.phase)) {
      record.state.piRunStartedAt ??= Date.now();
    }
    if (oldPhase !== view.phase && view.phase === "error") record.state.piErrorAt = Date.now();
    const projected = createPiV4Snapshot(view, record.state, record.snapshot.logEpoch);
    const patch: StatePatch = {};
    if (JSON.stringify(projected.control) !== JSON.stringify(record.snapshot.control)) patch.control = projected.control;
    if (JSON.stringify(projected.inputRouting) !== JSON.stringify(record.snapshot.inputRouting)) patch.inputRouting = projected.inputRouting;
    if (Object.keys(patch).length > 0) {
      record.lastActivityAt = Date.now();
      this.emitConversation(record, [{ op: "state.updated", patch }]);
      this.emitIndex(record.workspaceKey, record);
    }
  }

  private recordFor(params: ZCodeAgentWorkspaceTarget, sessionId: string): SessionRecord {
    const record = this.sessions.get(sessionId);
    if (!record || record.workspaceKey !== resolveWorkspaceKey(params)) throw new Error("Pi session is not owned by this workspace");
    return record;
  }

  async sendConversationCommandV4(params: ZCodeAgentConversationCommandParams): Promise<CommandAck> {
    const parsed = parseCommandEnvelope(params.envelope);
    if (!parsed.ok) return failure(params.envelope.commandId, "pi.invalidCommand", parsed.error.message);
    const envelope = parsed.envelope;
    const workspaceKey = resolveWorkspaceKey(params);
    const key = `${workspaceKey}:${envelope.sessionId ?? "create"}:${envelope.commandId}`;
    const previous = this.commandResults.get(key);
    if (previous) { const ack = await previous; return { ...ack, status: ack.status === "accepted" ? "duplicate" : ack.status }; }
    const pending = this.dispatch(params, envelope).then(ack => {
      if (ack.status === "failed") {
        const reason = `${envelope.type}:${ack.reasonCode ?? "unknown"}`;
        if (!this.reportedCommandFailures.has(reason)) {
          this.reportedCommandFailures.add(reason);
          // Never log prompts, workspace paths, provider credentials or error messages.
          console.warn("[pi-agent] native command rejected", reason);
        }
      }
      return commandAckSchema.parse(ack);
    });
    this.commandResults.set(key, pending);
    return pending;
  }

  private async dispatch(params: ZCodeAgentConversationCommandParams, envelope: ZCodeAgentConversationCommandParams["envelope"]): Promise<CommandAck> {
    const workspaceKey = resolveWorkspaceKey(params);
    const commandId = envelope.commandId;
    let record: SessionRecord | undefined;
    try {
      if (envelope.type === "createSession") {
        const payload = envelope.payload as { workspaceId: string; firstInput?: { text: string; modelSelection?: { providerId: string; modelId: string; options?: { reasoningLevel?: string } } } };
        const view = await this.supervisor.createSession(params.workspacePath);
        const state = await this.supervisor.getState(view.sessionId);
        const projection = new PiMessageRows(params.workspacePath);
        const now = Date.now();
        record = {
          workspaceKey, workspaceId: payload.workspaceId, view, state, projection,
          snapshot: createPiV4Snapshot(view, state, randomUUID()), createdAt: now, lastActivityAt: now,
        };
        this.sessions.set(view.sessionId, record);
        this.emitIndex(workspaceKey, record);
        if (payload.firstInput) {
          await this.applyModelSelection(view.sessionId, payload.firstInput.modelSelection);
          projection.expectUserCommand(commandId);
          await this.supervisor.sendText(view.sessionId, payload.firstInput.text);
          await this.safelyPersist(record);
        }
        return {
          commandId, status: "accepted", revisionAtDecision: record.snapshot.revision,
          result: { type: "createSession", sessionId: view.sessionId,
            ...(payload.firstInput ? { input: { delivery: "startNow", inputId: randomUUID() } } : {}) },
        };
      }
      if (!envelope.sessionId) return failure(commandId, "pi.sessionRequired");
      await this.loadWorkspace(params);
      record = this.recordFor(params, envelope.sessionId);
      if (envelope.type === "sendText") {
        const payload = envelope.payload as { text: string; attachments?: unknown[]; requestedDelivery?: string; modelSelection?: { providerId: string; modelId: string; options?: { reasoningLevel?: string } } };
        if (payload.attachments?.length) return unsupported(commandId, "sendText attachments", record.snapshot.revision);
        if (payload.requestedDelivery && payload.requestedDelivery !== "startNow") return unsupported(commandId, "busy input", record.snapshot.revision);
        await this.applyModelSelection(record.view.sessionId, payload.modelSelection);
        record.projection.expectUserCommand(commandId);
        try {
          await this.supervisor.sendText(record.view.sessionId, payload.text);
          await this.safelyPersist(record);
        } catch (error) {
          // Unknown delivery may still yield a Pi user message; retain attribution then.
          if (!(error instanceof Error && "delivery" in error && error.delivery === "unknown")) {
            record.projection.cancelExpectedUserCommand(commandId);
          }
          throw error;
        }
        return { commandId, status: "accepted", revisionAtDecision: record.snapshot.revision,
          result: { type: "inputAccepted", delivery: "startNow", inputId: randomUUID() } };
      }
      if (envelope.type === "stop") {
        await this.supervisor.stop(record.view.sessionId);
        await this.safelyPersist(record, true);
        this.emitConversation(record, record.projection.markStopped());
        return { commandId, status: "accepted", revisionAtDecision: record.snapshot.revision };
      }
      if (envelope.type === "deleteSession") {
        if (record.snapshot.rows.totalCount > 0) return unsupported(commandId, "delete persisted Pi history", record.snapshot.revision);
        await this.supervisor.closeSession(record.view.sessionId);
        this.sessions.delete(record.view.sessionId);
        this.emitIndexRemoval(record);
        return { commandId, status: "accepted", revisionAtDecision: record.snapshot.revision };
      }
      return unsupported(commandId, envelope.type, record.snapshot.revision);
    } catch (error) {
      return failure(commandId, "pi.commandFailed", error instanceof Error ? error.message : String(error), record?.snapshot.revision ?? 0);
    }
  }

  private async applyModelSelection(sessionId: string, selection?: { providerId: string; modelId: string; options?: { reasoningLevel?: string } }): Promise<void> {
    if (!selection) return;
    const state = await this.supervisor.getState(sessionId);
    const model = state.model && typeof state.model === "object" ? state.model as Record<string, unknown> : {};
    if (model.provider !== selection.providerId || model.id !== selection.modelId ||
      (selection.options?.reasoningLevel && state.thinkingLevel !== selection.options.reasoningLevel)) {
      await this.supervisor.setModel(sessionId, selection.providerId, selection.modelId, selection.options?.reasoningLevel);
    }
  }

  async queryConversationCommandsV4(params: ZCodeAgentCommandsQueryParams): ReturnType<V4Methods["queryConversationCommandsV4"]> {
    const workspaceKey = resolveWorkspaceKey(params);
    const results = await Promise.all(params.commands.map(async command => ({
      key: command,
      result: await this.commandResults.get(`${workspaceKey}:${command.sessionId ?? "create"}:${command.commandId}`) ?? "unknown" as const,
    })));
    return { results };
  }

  private subscription(workspaceKey: string, topic: string): Subscription {
    const sub = { id: randomUUID(), workspaceKey, topic, ordinal: 0 };
    this.subscriptions.set(sub.id, sub);
    return sub;
  }

  async subscribeConversationV4(params: ZCodeAgentConversationSubscribeParams): ReturnType<V4Methods["subscribeConversationV4"]> {
    await this.loadWorkspace(params);
    const record = this.recordFor(params, params.sessionId);
    const sub = this.subscription(record.workspaceKey, conversationTopic(record.view.sessionId));
    queueMicrotask(() => this.sendConversationSnapshot(sub, record, "initial"));
    return { ack: { subscriptionId: sub.id, mode: "snapshot", logEpoch: record.snapshot.logEpoch } };
  }

  private sendConversationSnapshot(sub: Subscription, record: SessionRecord, deliveryKind: "initial" | "recovery"): void {
    if (this.subscriptions.get(sub.id) !== sub) return;
    const snapshot = conversationSnapshotSchema.parse(record.snapshot);
    const frame = conversationTopicFrameSchema.parse({
      topic: sub.topic, subscriptionId: sub.id, fromSeq: 0, toSeq: snapshot.seq,
      sentAt: Date.now(), payload: { kind: "snapshot", snapshot },
    });
    for (const wire of piWireFrames(frame, deliveryKind, ++sub.ordinal)) {
      getEmitter(this.conversationEmitters, sub.workspaceKey).fire(wire);
    }
  }

  async resyncConversationV4(params: ZCodeAgentConversationResyncParams): ReturnType<V4Methods["resyncConversationV4"]> {
    const sub = this.subscriptions.get(params.subscriptionId);
    if (!sub || sub.workspaceKey !== resolveWorkspaceKey(params) || !sub.topic.startsWith("conversation/")) throw new Error("Pi conversation subscription not owned");
    const record = this.recordFor(params, sub.topic.slice("conversation/".length));
    queueMicrotask(() => this.sendConversationSnapshot(sub, record, "recovery"));
    return { ack: { subscriptionId: sub.id, mode: "snapshot", logEpoch: record.snapshot.logEpoch } };
  }

  async unsubscribeConversationV4(params: ZCodeAgentConversationUnsubscribeParams): Promise<void> {
    this.forgetSubscription(params, "conversation/");
  }

  async conversationRowsRangeV4(params: ZCodeAgentConversationRowsRangeParams): ReturnType<V4Methods["conversationRowsRangeV4"]> {
    const record = this.recordFor(params, params.sessionId);
    const all = record.projection.getRows();
    const eligible = params.beforeRowId === undefined ? all : all.filter(row => row.rowId < params.beforeRowId!);
    const rows = eligible.slice(-params.limit);
    return { rows, atSeq: record.snapshot.seq, atRevision: record.snapshot.revision,
      atLogEpoch: record.snapshot.logEpoch, hasMore: eligible.length > rows.length };
  }

  onDynamicConversationFrame(params: ZCodeAgentWorkspaceTarget): ReturnType<V4Methods["onDynamicConversationFrame"]> {
    return getEmitter(this.conversationEmitters, resolveWorkspaceKey(params)).event;
  }

  async subscribeSessionsIndexV4(params: ZCodeAgentSessionsIndexSubscribeParams): ReturnType<V4Methods["subscribeSessionsIndexV4"]> {
    const key = resolveWorkspaceKey(params);
    await this.loadWorkspace(params);
    this.markWorkspaceAvailable(params);
    const log = this.indexLog(key);
    const sub = this.subscription(key, sessionsIndexTopic(key));
    queueMicrotask(() => this.sendIndexSnapshot(sub, log, "initial"));
    return { ack: { subscriptionId: sub.id, mode: "snapshot", logEpoch: log.epoch } };
  }

  private sendIndexSnapshot(sub: Subscription, log: IndexLog, deliveryKind: "initial" | "recovery"): void {
    if (this.subscriptions.get(sub.id) !== sub) return;
    const frame = sessionsIndexTopicFrameSchema.parse({
      topic: sub.topic, subscriptionId: sub.id, fromSeq: 0, toSeq: log.seq, sentAt: Date.now(),
      payload: { kind: "snapshot", snapshot: { protocolVersion: 1,
        workspaceId: sub.workspaceKey, logEpoch: log.epoch,
        sessions: [...this.sessions.values()].filter(record => record.workspaceKey === sub.workspaceKey).map(record => this.summary(record)),
      } },
    });
    for (const wire of piWireFrames(frame, deliveryKind, ++sub.ordinal)) {
      getEmitter(this.indexEmitters, sub.workspaceKey).fire(wire);
    }
  }

  async resyncSessionsIndexV4(params: ZCodeAgentConversationResyncParams): ReturnType<V4Methods["resyncSessionsIndexV4"]> {
    const sub = this.requireSubscription(params, "sessions-index/");
    const log = this.indexLog(sub.workspaceKey);
    queueMicrotask(() => this.sendIndexSnapshot(sub, log, "recovery"));
    return { ack: { subscriptionId: sub.id, mode: "snapshot", logEpoch: log.epoch } };
  }

  async unsubscribeSessionsIndexV4(params: ZCodeAgentConversationUnsubscribeParams): Promise<void> {
    this.forgetSubscription(params, "sessions-index/");
  }

  onDynamicSessionsIndexFrame(params: ZCodeAgentWorkspaceTarget): ReturnType<V4Methods["onDynamicSessionsIndexFrame"]> {
    return getEmitter(this.indexEmitters, resolveWorkspaceKey(params)).event;
  }

  async subscribeWorkspaceConfigV4(params: ZCodeAgentWorkspaceConfigSubscribeParams): ReturnType<V4Methods["subscribeWorkspaceConfigV4"]> {
    const key = resolveWorkspaceKey(params);
    const sub = this.subscription(key, workspaceConfigTopic(key));
    queueMicrotask(() => this.sendConfigSnapshot(sub, "initial"));
    return { ack: { subscriptionId: sub.id, mode: "snapshot", logEpoch: key } };
  }

  private sendConfigSnapshot(sub: Subscription, deliveryKind: "initial" | "recovery"): void {
    if (this.subscriptions.get(sub.id) !== sub) return;
    const frame = workspaceConfigTopicFrameSchema.parse({
      topic: sub.topic, subscriptionId: sub.id, fromSeq: 0, toSeq: 0, sentAt: Date.now(),
      payload: { kind: "snapshot", snapshot: { protocolVersion: 1, workspaceId: sub.workspaceKey,
        logEpoch: sub.workspaceKey, config: { configOptions: [], slashCommands: [] } } },
    });
    for (const wire of piWireFrames(frame, deliveryKind, ++sub.ordinal)) {
      getEmitter(this.configEmitters, sub.workspaceKey).fire(wire);
    }
  }

  async resyncWorkspaceConfigV4(params: ZCodeAgentConversationResyncParams): ReturnType<V4Methods["resyncWorkspaceConfigV4"]> {
    const sub = this.requireSubscription(params, "workspace-config/");
    queueMicrotask(() => this.sendConfigSnapshot(sub, "recovery"));
    return { ack: { subscriptionId: sub.id, mode: "snapshot", logEpoch: sub.workspaceKey } };
  }

  async unsubscribeWorkspaceConfigV4(params: ZCodeAgentConversationUnsubscribeParams): Promise<void> {
    this.forgetSubscription(params, "workspace-config/");
  }

  onDynamicWorkspaceConfigFrame(params: ZCodeAgentWorkspaceTarget): ReturnType<V4Methods["onDynamicWorkspaceConfigFrame"]> {
    return getEmitter(this.configEmitters, resolveWorkspaceKey(params)).event;
  }

  private requireSubscription(params: ZCodeAgentConversationResyncParams, prefix: string): Subscription {
    const sub = this.subscriptions.get(params.subscriptionId);
    if (!sub || sub.workspaceKey !== resolveWorkspaceKey(params) || !sub.topic.startsWith(prefix)) throw new Error("Pi subscription not owned");
    return sub;
  }

  private forgetSubscription(params: ZCodeAgentConversationUnsubscribeParams, prefix: string): void {
    const sub = this.subscriptions.get(params.subscriptionId);
    if (sub && sub.workspaceKey === resolveWorkspaceKey(params) && sub.topic.startsWith(prefix)) this.subscriptions.delete(sub.id);
  }

  dispose(): Promise<void> {
    if (this.disposePromise) return this.disposePromise;
    this.disposePromise = this.disposeOwned();
    return this.disposePromise;
  }

  private async disposeOwned(): Promise<void> {
    this.subscriptions.clear();
    await this.supervisor.dispose();
    await Promise.allSettled(this.catalogWrites.values());
    for (const [workspaceKey, target] of this.availableWorkspaces) {
      this.lifecycleEmitter.fire({ ...target, workspaceKey,
        runtimeIdentity: this.getWorkspaceRuntimeIdentity(target), state: "unavailable" });
    }
    this.availableWorkspaces.clear();
    this.lifecycleEmitter.dispose();
    this.restartEmitter.dispose();
    for (const emitter of [...this.conversationEmitters.values(), ...this.indexEmitters.values(), ...this.configEmitters.values()]) emitter.dispose();
  }
}
