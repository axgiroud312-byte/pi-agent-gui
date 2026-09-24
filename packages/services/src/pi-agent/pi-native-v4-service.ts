/* eslint-disable max-lines -- The v4 subscription registry and command admission share one Pi session ownership map. */
import { createHash, randomUUID } from "node:crypto";
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
import { PiCommandLedger } from "./pi-command-ledger.js";
import { PiMessageRows } from "./pi-message-rows.js";
import { PiSessionCatalog, type PiSessionBookmark } from "./pi-session-catalog.js";
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
  private readonly ledger: PiCommandLedger;
  private readonly catalogWrites = new Map<string, Promise<boolean>>();
  private readonly workspaceLoads = new Map<string, Promise<void>>();
  private readonly bookmarks = new Map<string, PiSessionBookmark>();
  private readonly sessionLoads = new Map<string, Promise<void>>();
  private readonly reconciliations = new Map<string, Promise<void>>();
  private readonly recordVersions = new Map<string, number>();
  private readonly workspaceClosures = new Map<string, Promise<void>>();
  private readonly workspaceGenerations = new Map<string, number>();
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
    const generation = this.workspaceGenerations.get(workspaceKey) ?? 1;
    return { workspaceKey, generation, identity: `pi:${workspaceKey}:${generation}` };
  }

  // A native workspace runtime is this stable Host service, NOT one of the Pi
  // session children. Closing an empty draft or a Pi process exit must not
  // invalidate all workspace index subscriptions and remount the composer.
  markWorkspaceAvailable(params: ZCodeAgentWorkspaceTarget): void {
    this.assertWorkspaceOpen(params);
    const workspaceKey = resolveWorkspaceKey(params);
    if (this.availableWorkspaces.has(workspaceKey)) return;
    this.availableWorkspaces.set(workspaceKey, params);
    this.lifecycleEmitter.fire({ ...params, workspaceKey,
      runtimeIdentity: this.getWorkspaceRuntimeIdentity(params), state: "available" });
  }

  constructor(supervisor: PiSessionSupervisor, catalogDir = join(getAppConfigDir(), "pi-sessions")) {
    this.supervisor = supervisor;
    this.catalog = new PiSessionCatalog(catalogDir);
    this.ledger = new PiCommandLedger(join(catalogDir, "command-admission"));
    supervisor.on("record", (sessionId, record) => this.onPiRecord(sessionId, record));
    supervisor.on("change", view => this.onPiChange(view));
  }

  private bookmarkFor(record: SessionRecord): PiSessionBookmark {
    const summary = this.summary(record);
    return {
      sessionId: record.view.sessionId, sessionFile: record.view.sessionFile,
      workspacePath: record.view.workspacePath, workspaceKey: record.workspaceKey,
      workspaceId: record.workspaceId, createdAt: record.createdAt,
      lastActivityAt: record.lastActivityAt, uncertainDelivery: record.view.uncertainDelivery || record.view.reconciliationRequired,
      title: summary.title, titleSource: summary.titleSource, phase: summary.phase, sessionEnded: summary.sessionEnded,
      rowIds: record.projection.getRowIds(),
      ...(record.state.piPendingIntent ? { pendingIntent: record.state.piPendingIntent as PiSessionBookmark["pendingIntent"] } : {}),
      commandAnchors: record.projection.getRows().flatMap(row => row.kind === "userInput" && row.sourceCommandId
        ? [{ textHash: createHash("sha256").update(row.text).digest("hex"), commandId: row.sourceCommandId }] : []),
    };
  }

  private persist(record: SessionRecord): Promise<boolean> {
    const id = record.view.sessionId;
    const previous = this.catalogWrites.get(id) ?? Promise.resolve(false);
    const pending = previous.catch(() => false).then(async () => {
      const bookmark = this.bookmarkFor(record);
      const saved = await this.catalog.save(bookmark);
      if (saved) this.bookmarks.set(id, bookmark);
      return saved;
    });
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

  private assertWorkspaceOpen(params: ZCodeAgentWorkspaceTarget): void {
    if (this.disposePromise || this.workspaceClosures.has(resolveWorkspaceKey(params))) {
      throw new Error("Pi workspace is closing or disposed");
    }
  }

  private loadWorkspace(params: ZCodeAgentWorkspaceTarget): Promise<void> {
    this.assertWorkspaceOpen(params);
    const workspaceKey = resolveWorkspaceKey(params);
    let pending = this.workspaceLoads.get(workspaceKey);
    if (pending) return pending;
    pending = (async () => {
      const bookmarks = await this.catalog.list(workspaceKey);
      this.assertWorkspaceOpen(params);
      for (const entry of bookmarks) {
        if (entry.workspacePath === params.workspacePath) this.bookmarks.set(entry.sessionId, entry);
      }
    })();
    this.workspaceLoads.set(workspaceKey, pending);
    return pending;
  }

  private async loadSession(params: ZCodeAgentWorkspaceTarget, sessionId: string): Promise<void> {
    await this.loadWorkspace(params);
    const current = this.sessions.get(sessionId);
    if (current && current.view.phase !== "exited") return;
    const entry = this.bookmarks.get(sessionId);
    if (!entry || entry.workspaceKey !== resolveWorkspaceKey(params)) throw new Error("Pi session is not indexed in this workspace");
    const pending = this.sessionLoads.get(sessionId);
    if (pending) return pending;
    const loading = (async () => {
      let view: PiSessionView | undefined;
      try {
        view = await this.supervisor.resumeSession(entry.workspacePath, entry.sessionFile, entry.sessionId);
        const [state, messages] = await Promise.all([
          this.supervisor.getState(sessionId), this.supervisor.getHistoryMessages(sessionId),
        ]);
        this.assertWorkspaceOpen(params);
        const projection = new PiMessageRows(entry.workspacePath);
        let rows = projection.restore(messages, entry.commandAnchors, entry.rowIds);
        state.messageCount = messages.length;
        if (messages.some(message => typeof message === "object" && message !== null &&
          (message as Record<string, unknown>).role === "compactionSummary")) state.piCompacted = true;
        // Only a matching Pi user message *after* the pre-admission history,
        // with Pi now idle, can discharge an unknown write. An absent or
        // ambiguous message remains blocked; never replay the original prompt.
        const pending = entry.pendingIntent;
        const users = messages.filter(message => typeof message === "object" && message !== null &&
          (message as Record<string, unknown>).role === "user") as Record<string, unknown>[];
        const matched = pending && users.length === pending.priorUserCount + 1 &&
          users.slice(pending.priorUserCount).some(message => {
          const content = typeof message.content === "string" ? message.content :
            Array.isArray(message.content) ? message.content.map(part => {
              const value = part as Record<string, unknown>;
              return value.type === "text" && typeof value.text === "string" ? value.text : "";
            }).join("") : "";
          return createHash("sha256").update(content).digest("hex") === pending.textHash;
        });
        const safeToContinue = matched && state.isStreaming === false && state.isCompacting === false &&
          Number(state.pendingMessageCount) === 0;
        if ((entry.uncertainDelivery || current?.view.uncertainDelivery || current?.view.reconciliationRequired) && !safeToContinue) {
          view = this.supervisor.requireReconciliation(sessionId,
            entry.uncertainDelivery === true || current?.view.uncertainDelivery === true);
        }
        if (pending && safeToContinue) {
          state.piPendingIntent = undefined;
          rows = projection.restore(messages, [...(entry.commandAnchors ?? []),
            { textHash: pending.textHash, commandId: pending.commandId }], entry.rowIds);
        } else state.piPendingIntent = pending;
        const snapshot = conversationSnapshotSchema.parse({
          ...createPiV4Snapshot(view, state, randomUUID()),
          rows: { window: rows, totalCount: rows.length, firstRowId: rows[0]?.rowId ?? null },
        });
        this.sessions.set(sessionId, { workspaceKey: entry.workspaceKey, workspaceId: entry.workspaceId,
          view, state, projection, snapshot, createdAt: entry.createdAt, lastActivityAt: entry.lastActivityAt });
        if (safeToContinue) await this.safelyPersist(this.sessions.get(sessionId)!);
        this.emitIndex(entry.workspaceKey, this.sessions.get(sessionId)!);
      } catch (error) {
        if (view) await this.supervisor.closeSession(sessionId);
        throw error;
      }
    })();
    this.sessionLoads.set(sessionId, loading);
    try { await loading; }
    finally { if (this.sessionLoads.get(sessionId) === loading) this.sessionLoads.delete(sessionId); }
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
    const version = (this.recordVersions.get(sessionId) ?? 0) + 1;
    this.recordVersions.set(sessionId, version);
    if (event.type === "queue_update") {
      const items = [
        ...(Array.isArray(event.steering) ? event.steering.map(text => ({ text, requested: "guide" as const })) : []),
        ...(Array.isArray(event.followUp) ? event.followUp.map(text => ({ text, requested: "queue" as const })) : []),
      ].filter(item => typeof item.text === "string");
      record.state.piQueueItems = items.map((item, index) => {
        const id = createHash("sha256").update(`${item.requested}:${index}:${item.text}`).digest("hex");
        return { sourceCommandId: `pi-${id}`, queueItemId: `pi-${id}`, clientId: "pi-rpc",
          kind: "sendText" as const, text: item.text, attachments: [],
          delivery: { requested: item.requested, admitted: item.requested },
          order: { admissionSeq: index, queuePosition: index }, steer: { state: "notRequested" as const },
          dispatch: { state: "queued" as const }, admittedAt: Date.now() };
      });
    }
    if (event.type === "auto_retry_start" || event.type === "summarization_retry_scheduled") {
      record.state.piRetryAttempt = event.attempt;
      record.state.piRetryMaxAttempts = event.maxAttempts;
      record.state.piRetryAt = Date.now() + (typeof event.delayMs === "number" ? event.delayMs : 0);
    }
    if (event.type === "compaction_end" && event.result && !event.aborted) record.state.piCompacted = true;
    if (event.type === "auto_retry_end" || event.type === "summarization_retry_finished" || event.type === "agent_settled") {
      delete record.state.piRetryAttempt;
    }
    const deltas = record.projection.apply(event);
    if (deltas.length > 0) {
      record.lastActivityAt = Date.now();
      record.state.messageCount = record.projection.getRows().length;
      this.emitConversation(record, deltas);
      this.emitIndex(record.workspaceKey, record);
    }
    if (event.type === "message_end" || event.type === "agent_settled") {
      void this.safelyPersist(record, event.type === "agent_settled");
    }
    if (event.type === "agent_settled" || (event.type === "compaction_end" && event.result && !event.aborted)) {
      this.reconcileSettled(record, version);
    }
    else if (event.type === "queue_update" || event.type === "auto_retry_start" || event.type === "auto_retry_end" ||
      event.type === "summarization_retry_scheduled" || event.type === "summarization_retry_finished") {
      const projected = createPiV4Snapshot(record.view, record.state, record.snapshot.logEpoch);
      this.emitConversation(record, [{ op: "state.updated", patch: { queue: projected.queue, control: projected.control } }]);
    }
  }

  private reconcileSettled(record: SessionRecord, version: number): void {
    const id = record.view.sessionId;
    const previous = this.reconciliations.get(id) ?? Promise.resolve();
    const pending = previous.catch(() => {}).then(async () => {
      try {
        const messages = await this.supervisor.getHistoryMessages(id);
        // An older read can complete after a later Pi record, or after a
        // workspace closes/reopens. Only apply the same settled generation.
        if (this.sessions.get(id) !== record || this.workspaceClosures.has(record.workspaceKey)) return;
        if (this.recordVersions.get(id) !== version) {
          // A notification/queue event after settled invalidated this read. A
          // newer *run* gets its own settled event; benign late records must
          // instead trigger another authoritative read, not strand old rows.
          if (["settled", "idle", "stopped", "error"].includes(record.view.phase)) {
            this.reconcileSettled(record, this.recordVersions.get(id)!);
          }
          return;
        }
        const deltas = record.projection.reconcile(messages);
        if (record.view.phase === "stopped") deltas.push(...record.projection.markStopped(
          typeof record.state.piStoppedCommandId === "string" ? record.state.piStoppedCommandId : undefined));
        record.state.messageCount = messages.length;
        if (!record.view.uncertainDelivery && !record.view.reconciliationRequired) delete record.state.piPendingIntent;
        await this.safelyPersist(record, true);
        if (deltas.length) {
          this.emitConversation(record, deltas);
          this.emitIndex(record.workspaceKey, record);
        }
      } catch (error) {
        if (this.sessions.get(id) !== record) return;
        record.state.piBookmarkError = true;
        record.state.piBookmarkErrorAt = Date.now();
        this.bookmarkControlChanged(record);
        console.warn("[pi-agent] Pi settled history reconciliation failed", error instanceof Error ? error.name : "unknown");
      }
    });
    this.reconciliations.set(id, pending);
    void pending.finally(() => { if (this.reconciliations.get(id) === pending) this.reconciliations.delete(id); });
  }

  private onPiChange(view: PiSessionView): void {
    const record = this.sessions.get(view.sessionId);
    if (!record) return;
    const oldPhase = record.view.phase;
    record.view = view;
    if (view.phase === "stopped" && view.clearedQueue) {
      const retained = [...view.clearedQueue.steering.map(text => ({ text, requested: "guide" as const })),
        ...view.clearedQueue.followUp.map(text => ({ text, requested: "queue" as const }))];
      record.state.piQueueItems = retained.map((item, index) => {
        const id = createHash("sha256").update(`${item.requested}:${index}:${item.text}`).digest("hex");
        return { sourceCommandId: `pi-${id}`, queueItemId: `pi-${id}`, clientId: "pi-rpc",
          kind: "sendText" as const, text: item.text, attachments: [],
          delivery: { requested: item.requested, admitted: item.requested },
          order: { admissionSeq: index, queuePosition: index }, steer: { state: "notRequested" as const },
          dispatch: { state: "queued" as const }, admittedAt: Date.now() };
      });
      record.state.piStoppedQueue = true;
    }
    if (view.phase === "accepted") record.state.piStoppedQueue = false;
    if (oldPhase !== view.phase && view.phase === "accepted") record.state.piRunStartedAt = Date.now();
    else if (oldPhase !== view.phase && ["running", "retrying", "compacting"].includes(view.phase)) {
      record.state.piRunStartedAt ??= Date.now();
    }
    if (oldPhase !== view.phase && view.phase === "error") record.state.piErrorAt = Date.now();
    const projected = createPiV4Snapshot(view, record.state, record.snapshot.logEpoch);
    const patch: StatePatch = {};
    if (JSON.stringify(projected.control) !== JSON.stringify(record.snapshot.control)) patch.control = projected.control;
    if (JSON.stringify(projected.inputRouting) !== JSON.stringify(record.snapshot.inputRouting)) patch.inputRouting = projected.inputRouting;
    if (JSON.stringify(projected.queue) !== JSON.stringify(record.snapshot.queue)) patch.queue = projected.queue;
    if (Object.keys(patch).length > 0) {
      record.lastActivityAt = Date.now();
      this.emitConversation(record, [{ op: "state.updated", patch }]);
      this.emitIndex(record.workspaceKey, record);
    }
    if (oldPhase !== view.phase && ["settled", "stopped", "error", "exited"].includes(view.phase)) {
      void this.safelyPersist(record);
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
    if (this.disposePromise || this.workspaceClosures.has(workspaceKey)) return failure(envelope.commandId, "pi.workspaceClosing");
    const pending = (async () => {
      // Reserve before ANY Pi side effect, including a new-session spawn. A crash
      // leaves 'pending', which is unknown delivery, never a replay invitation.
      let prior: CommandAck | "pending" | undefined;
      try {
        prior = await this.ledger.read(key);
        if (!prior && !(await this.ledger.reserve(key))) prior = await this.ledger.read(key) ?? "pending";
      } catch {
        return failure(envelope.commandId, "pi.admissionStorageUnavailable", "Cannot verify durable Pi command admission");
      }
      if (prior) return prior === "pending"
        ? failure(envelope.commandId, "pi.deliveryUnknown", "Command may have reached Pi; inspect history before retrying")
        : { ...prior, status: prior.status === "accepted" ? "duplicate" as const : prior.status };
      const ack = await this.dispatch(params, envelope);
      try { await this.ledger.settle(key, ack); }
      catch {
        // The reserved receipt still prevents replay. Never turn a successful
        // Pi admission into an ordinary failed ACK because persistence failed.
        if (ack.status === "accepted") return ack;
        return failure(envelope.commandId, "pi.deliveryUnknown", "Command receipt requires reconciliation");
      }
      return ack;
    })().then(ack => {
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
    let createdSessionId: string | undefined;
    try {
      this.assertWorkspaceOpen(params);
      if (envelope.type === "createSession") {
        const payload = envelope.payload as { workspaceId: string;
          firstInput?: { text: string; attachments?: unknown[]; mode?: string; planEnabled?: boolean;
            modelSelection?: { providerId: string; modelId: string; options?: { reasoningLevel?: string } } };
          config?: { mode?: string; planEnabled?: boolean; followupMode?: string;
            modelSelection?: { providerId: string; modelId: string; options?: { reasoningLevel?: string } };
            provider?: string; model?: string; thought?: string }; mcpServers?: unknown[];
          offPeakToolEnabled?: boolean; dynamicWorkflowEnabled?: boolean };
        const config = payload.config;
        const selection = config?.modelSelection;
        // The native draft always supplies these defaults and mirrors its
        // model selection as provider/model/thought. Accept only consistent
        // mirrors; never silently treat a different requested model as applied.
        const unsupportedConfig = Object.entries(config ?? {}).some(([key, value]) => {
          if (key === "mode") return value !== "build";
          if (key === "planEnabled") return value !== false;
          if (key === "followupMode") return value !== "queue";
          if (key === "modelSelection") return false;
          if (key === "provider") return Boolean(value) && value !== selection?.providerId;
          if (key === "model") return Boolean(value) && value !== selection?.modelId;
          if (key === "thought") return Boolean(value) && value !== selection?.options?.reasoningLevel;
          return true;
        });
        if (payload.firstInput?.attachments?.length || (payload.firstInput?.mode && payload.firstInput.mode !== "build") ||
          payload.firstInput?.planEnabled || unsupportedConfig ||
          payload.mcpServers?.length || payload.offPeakToolEnabled || payload.dynamicWorkflowEnabled) {
          return unsupported(commandId, "createSession execution constraints", 0);
        }
        const view = await this.supervisor.createSession(params.workspacePath);
        createdSessionId = view.sessionId;
        this.assertWorkspaceOpen(params);
        await this.applyModelSelection(view.sessionId, payload.firstInput?.modelSelection ?? selection);
        const state = await this.supervisor.getState(view.sessionId);
        this.assertWorkspaceOpen(params);
        const projection = new PiMessageRows(params.workspacePath);
        const now = Date.now();
        record = {
          workspaceKey, workspaceId: payload.workspaceId, view, state, projection,
          snapshot: createPiV4Snapshot(view, state, randomUUID()), createdAt: now, lastActivityAt: now,
        };
        this.sessions.set(view.sessionId, record);
        this.emitIndex(workspaceKey, record);
        if (payload.firstInput) {
          projection.expectUserCommand(commandId);
          record.state.piPendingIntent = { textHash: createHash("sha256").update(payload.firstInput.text).digest("hex"),
            commandId, priorUserCount: 0 };
          // Draft Pi JSONL may not exist yet; the durable command receipt still
          // fences replay of this first input across a Host crash.
          await this.safelyPersist(record);
          const outcome = await this.supervisor.sendText(view.sessionId, payload.firstInput.text);
          if (outcome === "noRun") {
            projection.cancelExpectedUserCommand(commandId);
            delete record.state.piPendingIntent;
          }
          await this.safelyPersist(record);
        }
        return {
          commandId, status: "accepted", revisionAtDecision: record.snapshot.revision,
          result: { type: "createSession", sessionId: view.sessionId,
            ...(payload.firstInput ? { input: { delivery: "startNow", inputId: randomUUID() } } : {}) },
        };
      }
      if (!envelope.sessionId) return failure(commandId, "pi.sessionRequired");
      await this.loadSession(params, envelope.sessionId);
      record = this.recordFor(params, envelope.sessionId);
      if (envelope.type === "sendText") {
        const payload = envelope.payload as { text: string; attachments?: unknown[]; requestedDelivery?: string;
          mode?: string; planEnabled?: boolean; modelSelection?: { providerId: string; modelId: string; options?: { reasoningLevel?: string } };
          browserAmbientContext?: unknown; context_refs?: unknown[]; heldQueueDisposition?: string;
          expectedHeldQueueItemIds?: string[]; modelExecution?: unknown; automationId?: string;
          offPeakTaskId?: string; offPeakRunType?: string; toolDisallowlist?: string[] };
        if (payload.attachments?.length || (payload.requestedDelivery && payload.requestedDelivery !== "startNow") ||
          (payload.mode && payload.mode !== "build") || payload.planEnabled || payload.browserAmbientContext ||
          payload.context_refs?.length || payload.heldQueueDisposition || payload.expectedHeldQueueItemIds?.length ||
          payload.modelExecution || payload.automationId || payload.offPeakTaskId || payload.offPeakRunType ||
          payload.toolDisallowlist?.length) return unsupported(commandId, "sendText execution constraints", record.snapshot.revision);
        if (record.view.uncertainDelivery || record.view.reconciliationRequired) {
          return failure(commandId, "pi.deliveryUnknown", "Pi input requires history reconciliation", record.snapshot.revision);
        }
        await this.applyModelSelection(record.view.sessionId, payload.modelSelection);
        record.projection.expectUserCommand(commandId);
        record.state.piPendingIntent = { textHash: createHash("sha256").update(payload.text).digest("hex"),
          commandId, priorUserCount: record.projection.getRows().filter(row => row.kind === "userInput").length };
        try {
          const saved = await this.persist(record);
          // Pi creates a draft JSONL on first input; no file exists yet for
          // an empty draft. The reserved command receipt still fences replay.
          if (!saved && record.projection.getRows().some(row => row.kind === "userInput")) {
            throw new Error("Cannot persist Pi input correlation before delivery");
          }
          const outcome = await this.supervisor.sendText(record.view.sessionId, payload.text);
          if (outcome === "noRun") {
            record.projection.cancelExpectedUserCommand(commandId);
            delete record.state.piPendingIntent;
          }
          await this.safelyPersist(record);
        } catch (error) {
          // Unknown delivery may still yield a Pi user message; retain attribution then.
          if (error instanceof Error && "delivery" in error && error.delivery === "unknown") {
            await this.safelyPersist(record);
          } else {
            record.projection.cancelExpectedUserCommand(commandId);
            delete record.state.piPendingIntent;
            await this.safelyPersist(record);
          }
          throw error;
        }
        return { commandId, status: "accepted", revisionAtDecision: record.snapshot.revision,
          result: { type: "inputAccepted", delivery: "startNow", inputId: randomUUID() } };
      }
      if (envelope.type === "stop") {
        const payload = envelope.payload as { expectedForegroundExecutionId?: string };
        const stoppedCommandId = record.projection.currentCommandId();
        const outcome = await this.supervisor.stop(record.view.sessionId, payload.expectedForegroundExecutionId);
        if (outcome !== "stopped") return {
          commandId, status: outcome === "stale" ? "stale" : "noop",
          reasonCode: `pi.stop.${outcome}`, revisionAtDecision: record.snapshot.revision,
        };
        record.state.piStoppedCommandId = stoppedCommandId;
        this.emitConversation(record, record.projection.markStopped(stoppedCommandId));
        await this.safelyPersist(record, true);
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
      if (createdSessionId && !record) await this.supervisor.closeSession(createdSessionId);
      if (record?.view.uncertainDelivery || record?.view.reconciliationRequired) await this.safelyPersist(record);
      return failure(commandId, record?.view.uncertainDelivery ? "pi.deliveryUnknown" : "pi.commandFailed",
        error instanceof Error ? error.message : String(error), record?.snapshot.revision ?? 0);
    }
  }

  private async applyModelSelection(sessionId: string, selection?: { providerId: string; modelId: string; options?: { reasoningLevel?: string } }): Promise<void> {
    if (!selection) return;
    const state = await this.supervisor.getState(sessionId);
    const model = state.model && typeof state.model === "object" ? state.model as Record<string, unknown> : {};
    const switched = model.provider !== selection.providerId || model.id !== selection.modelId;
    if (switched) await this.supervisor.setModel(sessionId, selection.providerId, selection.modelId);
    const selected = switched ? await this.supervisor.getState(sessionId) : state;
    const selectedModel = selected.model && typeof selected.model === "object" ? selected.model as Record<string, unknown> : {};
    const requested = selection.options?.reasoningLevel;
    // Native generic-provider choices are binary; Pi's RPC levels are not.
    // A model that cannot reason (including the GUI fixture) only exposes off.
    const level = requested === "disabled" ? "off" : requested === "enabled"
      ? selectedModel.reasoning === true
        ? selected.thinkingLevel === "off" ? "medium" : String(selected.thinkingLevel ?? "medium") : "off"
      : requested;
    if (level && !["off", "minimal", "low", "medium", "high", "xhigh", "max"].includes(level)) {
      throw new Error("The selected reasoning level is not supported by Pi");
    }
    if (level && selected.thinkingLevel !== level) {
      await this.supervisor.setModel(sessionId, selection.providerId, selection.modelId, level);
    }
  }

  async queryConversationCommandsV4(params: ZCodeAgentCommandsQueryParams): ReturnType<V4Methods["queryConversationCommandsV4"]> {
    const workspaceKey = resolveWorkspaceKey(params);
    const results = await Promise.all(params.commands.map(async command => {
      const key = `${workspaceKey}:${command.sessionId ?? "create"}:${command.commandId}`;
      const active = this.commandResults.get(key);
      if (active) return { key: command, result: await active };
      try {
        const receipt = await this.ledger.read(key);
        return { key: command, result: receipt === "pending"
          ? failure(command.commandId, "pi.deliveryUnknown", "Command may have reached Pi; inspect history")
          : receipt ?? "unknown" as const };
      } catch {
        return { key: command, result: failure(command.commandId, "pi.admissionStorageUnavailable") };
      }
    }));
    return { results };
  }

  private subscription(workspaceKey: string, topic: string): Subscription {
    const sub = { id: randomUUID(), workspaceKey, topic, ordinal: 0 };
    this.subscriptions.set(sub.id, sub);
    return sub;
  }

  async subscribeConversationV4(params: ZCodeAgentConversationSubscribeParams): ReturnType<V4Methods["subscribeConversationV4"]> {
    await this.loadSession(params, params.sessionId);
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
        sessions: [...this.bookmarks.values()].filter(entry => entry.workspaceKey === sub.workspaceKey)
          .map(entry => this.sessions.has(entry.sessionId) ? this.summary(this.sessions.get(entry.sessionId)!) : {
            sessionId: entry.sessionId, workspaceId: entry.workspaceId, title: entry.title ?? "Pi session",
            titleSource: entry.titleSource ?? "default" as const,
            // A cold index cannot claim an in-flight turn is still running.
            phase: entry.uncertainDelivery || entry.phase === "running" || entry.phase === "prewarming"
              ? "error" as const : entry.phase ?? "completedSuccess" as const,
            sessionEnded: entry.uncertainDelivery || entry.phase === "running" || entry.phase === "prewarming"
              ? false : entry.sessionEnded ?? true,
            hasBackgroundWork: false, lastActivityAt: entry.lastActivityAt, createdAt: entry.createdAt,
          }).concat([...this.sessions.values()].filter(record => record.workspaceKey === sub.workspaceKey &&
            !this.bookmarks.has(record.view.sessionId)).map(record => this.summary(record))),
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
    this.assertWorkspaceOpen(params);
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

  disposeWorkspace(params: ZCodeAgentWorkspaceTarget): Promise<void> {
    const key = resolveWorkspaceKey(params);
    const previous = this.workspaceClosures.get(key);
    if (previous) return previous;
    // Install the closing fence synchronously before asynchronous teardown starts.
    const pending = Promise.resolve().then(() => this.releaseWorkspace(params)).finally(() => {
      if (this.workspaceClosures.get(key) === pending) this.workspaceClosures.delete(key);
    });
    this.workspaceClosures.set(key, pending);
    return pending;
  }

  private async releaseWorkspace(params: ZCodeAgentWorkspaceTarget): Promise<void> {
    const key = resolveWorkspaceKey(params);
    const closeOwned = async () => {
      const results = await Promise.allSettled([...this.sessions.values()]
        .filter(record => record.workspaceKey === key).map(async record => {
          await this.supervisor.closeSession(record.view.sessionId);
          await this.catalogWrites.get(record.view.sessionId);
          this.sessions.delete(record.view.sessionId);
        }));
      const failures = results.filter(result => result.status === "rejected");
      if (failures.length) throw new AggregateError(failures.map(result => result.reason), "Pi workspace release failed");
    };
    await closeOwned();
    // Drain in-flight startup/admission too. They observe the closing fence and
    // cannot publish a late runtime after release has returned.
    await Promise.allSettled([
      ...(this.workspaceLoads.has(key) ? [this.workspaceLoads.get(key)!] : []),
      ...[...this.sessionLoads].filter(([id]) => this.bookmarks.get(id)?.workspaceKey === key).map(([, load]) => load),
      ...[...this.reconciliations].filter(([id]) => this.sessions.get(id)?.workspaceKey === key).map(([, pending]) => pending),
      ...[...this.commandResults].filter(([commandKey]) => commandKey.startsWith(`${key}:`)).map(([, result]) => result),
    ]);
    await closeOwned();
    for (const [id, sub] of this.subscriptions) if (sub.workspaceKey === key) this.subscriptions.delete(id);
    this.workspaceLoads.delete(key);
    for (const [id, entry] of this.bookmarks) if (entry.workspaceKey === key) this.bookmarks.delete(id);
    this.indexLogs.delete(key);
    const target = this.availableWorkspaces.get(key);
    if (target) this.lifecycleEmitter.fire({ ...target, workspaceKey: key,
      runtimeIdentity: this.getWorkspaceRuntimeIdentity(target), state: "unavailable" });
    this.availableWorkspaces.delete(key);
    this.workspaceGenerations.set(key, (this.workspaceGenerations.get(key) ?? 1) + 1);
    // Keep admission receipts until a durable replacement exists: deleting them
    // here would permit a known accepted command ID to execute again on reopen.
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
