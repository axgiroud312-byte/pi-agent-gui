/* eslint-disable max-lines -- The v4 subscription registry and command admission share one Pi session ownership map. */
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, realpath, unlink } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { Emitter } from "@zcode/rpc";
import { resolveWorkspaceKey, type ZCodeConfigOption } from "@zcode/shared";
import {
  V4_WIRE_PROTOCOL_VERSION,
  applyConversationDeltas,
  v4AttachmentReadParamsSchema,
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
  type AttachmentRef,
  type CommandAck,
  type ConversationDelta,
  type ConversationSnapshot,
  type QueueItem,
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
  ZCodeAgentAttachmentBeginParams,
  ZCodeAgentAttachmentChunkParams,
  ZCodeAgentAttachmentTerminalParams,
  ZCodeAgentAttachmentReadParams,
  ZCodeAgentRuntimeLifecycleEvent,
  ZCodeAgentWorkspaceRuntimeIdentity,
} from "../zcode-agent/zcodeAgent.js";
import { getAppConfigDir } from "../paths.js";
import { PiCommandLedger } from "./pi-command-ledger.js";
import { PiMessageRows } from "./pi-message-rows.js";
import { PiSessionCatalog, type PiQueueRecoveryEntry, type PiSessionBookmark } from "./pi-session-catalog.js";
import { PiSessionLease } from "./pi-session-lease.js";
import { PiSessionSupervisor, type PiSessionView } from "./pi-session-supervisor.js";
import { sessionFileExists } from "./pi-session-path.js";
import { createPiV4Snapshot } from "./pi-v4-snapshot.js";
import { emptyPiExtensionUiState, reducePiExtensionUiState } from "./pi-extension-ui-state.js";
import { piWireFrames } from "./pi-v4-frames.js";
import { readPiPromptImages } from "./pi-prompt-images.js";
import { PiImageUploads } from "./pi-image-upload.js";
import { piControlView, type PiControlAction, type PiControlView } from "./pi-control-protocol.js";
import { PiQueueMediaStore } from "./pi-queue-media-store.js";
import { readPiSettingsDocuments, savePiSettingsDocument,
  type PiSettingsScope, type PiSettingsSnapshot } from "./pi-settings-documents.js";
import type { PiQueueCatalogV1 } from "./pi-queue-compat.js";
import { PiAuthManager, type PiAuthAction, type PiAuthMethod, type PiAuthView } from "./pi-auth-manager.js";
import { PiLlamaRouterClient } from "./pi-llama-router-client.js";
import { projectPiLlamaRouterModels, type PiLlamaRouterAction, type PiLlamaRouterProgressEvent,
  type PiLlamaRouterView } from "./pi-llama-router-service.js";

interface SessionRecord {
  workspaceKey: string;
  workspaceId: string;
  view: PiSessionView;
  state: Record<string, unknown>;
  projection: PiMessageRows;
  snapshot: ConversationSnapshot;
  createdAt: number;
  lastActivityAt: number;
  admissionGeneration: number;
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

export interface PiSessionDeletionPreview {
  sessionId: string;
  sessionFile: string;
  workspacePath: string;
  title: string;
  revision: string;
}

/** A confirmation is bound to the exact file bytes and filesystem identity. */
async function deletionRevision(file: string): Promise<string> {
  const before = await lstat(file);
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1) {
    throw new Error("Pi session history must be a regular, single-link file");
  }
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  const after = await lstat(file);
  if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size ||
    before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) {
    throw new Error("Pi session history changed during inspection");
  }
  return createHash("sha256").update(JSON.stringify({
    dev: before.dev, ino: before.ino, size: before.size,
    mtimeMs: before.mtimeMs, ctimeMs: before.ctimeMs, hash: hash.digest("hex"),
  })).digest("hex");
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
  | "attachmentBeginV4"
  | "attachmentChunkV4"
  | "attachmentCommitV4"
  | "attachmentAbortV4"
  | "attachmentReadV4"
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

type ReturnedQueue = { steering: string[]; followUp: string[] };
type PendingIntent = NonNullable<PiSessionBookmark["pendingIntent"]>;

function piQueueItems(queue: ReturnedQueue, source: "pi-rpc" | "pi-returned", offset = 0) {
  return [...queue.steering.map(text => ({ text, requested: "guide" as const })),
    ...queue.followUp.map(text => ({ text, requested: "queue" as const }))].map((item, index) => {
    const id = createHash("sha256").update(`${source}:${item.requested}:${index}:${item.text}`).digest("hex");
    return { sourceCommandId: `pi-${id}`, queueItemId: `pi-${id}`, clientId: source,
      kind: "sendText" as const, text: item.text, attachments: [],
      delivery: { requested: item.requested, admitted: item.requested },
      order: { admissionSeq: offset + index, queuePosition: offset + index },
      steer: { state: "notRequested" as const },
      dispatch: { state: "queued" as const }, admittedAt: Date.now() };
  });
}

function projectPiQueueCatalog(catalog: PiQueueCatalogV1, refs: Map<string, AttachmentRef[]>): QueueItem[] {
  return [...catalog.steering.map(item => ({ item, requested: "guide" as const })),
    ...catalog.followUp.map(item => ({ item, requested: "queue" as const }))].map(({ item, requested }, index) => ({
    sourceCommandId: `pi-${item.id}`, queueItemId: item.id, clientId: "pi-rpc",
    kind: "sendText" as const, text: item.text, attachments: refs.get(item.id) ?? [],
    delivery: { requested, admitted: requested },
    order: { admissionSeq: index, queuePosition: index },
    steer: { state: "notRequested" as const },
    dispatch: { state: "queued" as const }, admittedAt: Date.now(),
  }));
}

function matchesCompletedIntent(messages: unknown[], pending: PendingIntent): boolean {
  const users = messages.filter(message => typeof message === "object" && message !== null &&
    (message as Record<string, unknown>).role === "user") as Record<string, unknown>[];
  if (users.length < pending.priorUserCount + 1) return false;
  // Pi can deliver queued follow-ups before agent_settled. The admitted
  // foreground input is at its original history position, not necessarily last.
  const last = users[pending.priorUserCount]!;
  const content = typeof last.content === "string" ? last.content :
    Array.isArray(last.content) ? last.content.map(part => {
      const value = part as Record<string, unknown>;
      return value.type === "text" && typeof value.text === "string" ? value.text : "";
    }).join("") : "";
  return createHash("sha256").update(content).digest("hex") === pending.textHash;
}

function projectedIntentComplete(record: SessionRecord, pending: PendingIntent): boolean {
  const users = record.projection.getRows().filter(row => row.kind === "userInput");
  const last = users[pending.priorUserCount];
  return users.length >= pending.priorUserCount + 1 && last?.kind === "userInput" &&
    createHash("sha256").update(last.text).digest("hex") === pending.textHash &&
    !record.projection.hasIncompleteTurn();
}

/** Native v4 Agent seam backed exclusively by pinned Pi RPC sessions. */
export class PiNativeV4Service implements V4Methods {
  readonly supervisor: PiSessionSupervisor;

  /** Host-local readback for native task controls; Pi's session index remains authoritative. */
  async getPiSessionSummary(params: ZCodeAgentWorkspaceTarget & { sessionId: string }): Promise<SessionSummary> {
    await this.loadSession(params, params.sessionId);
    return this.summary(this.recordFor(params, params.sessionId));
  }

  /** Cold Pi history readback; never resumes or writes the selected JSONL. */
  async inspectSessionDeletion(params: ZCodeAgentWorkspaceTarget & { sessionId: string }): Promise<PiSessionDeletionPreview> {
    this.assertWorkspaceOpen(params);
    const directory = await realpath(await this.supervisor.sessionDirectory(params.workspacePath));
    const workspacePath = await realpath(params.workspacePath);
    const candidates = (await SessionManager.list(params.workspacePath, directory))
      .filter(session => session.id === params.sessionId &&
        resolve(session.cwd).toLowerCase() === resolve(workspacePath).toLowerCase());
    if (candidates.length !== 1) throw new Error("Pi session not found in this workspace or identity is ambiguous");
    const session = candidates[0]!;
    const sessionFile = await realpath(session.path);
    if (resolve(dirname(sessionFile)).toLowerCase() !== resolve(directory).toLowerCase() ||
      basename(sessionFile) !== basename(session.path) ||
      (await lstat(session.path)).isSymbolicLink()) {
      throw new Error("Pi session history path changed or escaped its session directory");
    }
    return { sessionId: session.id, sessionFile, workspacePath,
      title: session.name?.trim() || session.firstMessage.trim().slice(0, 100) || "New Pi session",
      revision: await deletionRevision(sessionFile) };
  }

  /** Delete only a cold, confirmed Pi JSONL. Product leases do not bind external CLI writers. */
  async deletePersistedSession(params: ZCodeAgentWorkspaceTarget & { sessionId: string;
    expectedSessionFile: string; expectedRevision: string }): Promise<void> {
    const workspaceKey = resolveWorkspaceKey(params);
    const admissionKey = `${workspaceKey}:${params.sessionId}`;
    const assertCold = () => {
      if (this.sessions.has(params.sessionId) || this.supervisor.getSession(params.sessionId) ||
        this.sessionLoads.has(params.sessionId) || this.sessionAdmissions.has(admissionKey)) {
        throw new Error("Pi session is active; close it before deleting its history");
      }
      const bookmark = this.bookmarks.get(params.sessionId);
      if (bookmark && (bookmark.pendingIntent || bookmark.uncertainDelivery || bookmark.returnedQueue ||
        bookmark.queueRecovery?.length || bookmark.interruptedQueueRecovery?.length)) {
        throw new Error("Pi session has unresolved delivery or queued recovery; reconcile it before deletion");
      }
    };
    assertCold();
    await this.loadWorkspace(params);
    assertCold();
    const preview = await this.inspectSessionDeletion(params);
    if (preview.sessionFile !== params.expectedSessionFile || preview.revision !== params.expectedRevision) {
      throw new Error("Pi session history changed since deletion confirmation");
    }
    const lease = await PiSessionLease.acquire(preview.sessionFile);
    let deleted = false;
    let releaseFailure: { error: unknown } | undefined;
    try {
      assertCold();
      const current = await this.inspectSessionDeletion(params);
      if (current.sessionFile !== preview.sessionFile || current.revision !== params.expectedRevision) {
        throw new Error("Pi session history changed since deletion confirmation");
      }
      await unlink(current.sessionFile);
      deleted = true;
      if (this.bookmarks.get(params.sessionId)?.workspaceKey === workspaceKey) {
        this.bookmarks.delete(params.sessionId);
      }
      try { this.emitIndexRemoval(workspaceKey, params.sessionId); }
      catch { console.warn("[pi-agent] deleted session index broadcast failed"); }
      try { await this.catalog.remove(params.sessionId, workspaceKey, current.sessionFile); }
      catch { console.warn("[pi-agent] deleted session bookmark cleanup failed"); }
    } finally {
      try { await lease.release(); }
      catch (error) {
        releaseFailure = { error };
      }
    }
    if (releaseFailure) {
      if (!deleted) throw releaseFailure.error;
      // The authoritative JSONL is already gone. A cleanup error must not
      // tell the user deletion failed and encourage a retry against new data.
      console.warn("[pi-agent] deleted session lease cleanup failed");
    }
  }

  async readPiSettings(params: ZCodeAgentWorkspaceTarget): Promise<PiSettingsSnapshot> {
    const { env, rpcArgs } = this.supervisor.settingsEnvironment();
    return readPiSettingsDocuments(params.workspacePath, env, rpcArgs);
  }

  async savePiSettings(params: ZCodeAgentWorkspaceTarget & {
    scope: PiSettingsScope; expectedRevision: string; text: string;
  }): Promise<PiSettingsSnapshot> {
    const { env, rpcArgs } = this.supervisor.settingsEnvironment();
    return savePiSettingsDocument(params.workspacePath, env, { ...params, rpcArgs });
  }
  private readonly sessions = new Map<string, SessionRecord>();
  private readonly subscriptions = new Map<string, Subscription>();
  private readonly indexLogs = new Map<string, IndexLog>();
  private readonly commandResults = new Map<string, Promise<CommandAck>>();
  private readonly sessionAdmissions = new Map<string, Promise<CommandAck>>();
  private readonly treeOperations = new Set<string>();
  private readonly reportedCommandFailures = new Set<string>();
  private readonly reportedRecordTypes = new Set<string>();
  private readonly catalog: PiSessionCatalog;
  private readonly ledger: PiCommandLedger;
  private readonly imageUploads = new PiImageUploads();
  private readonly queueMedia: PiQueueMediaStore;
  private readonly queueRefreshes = new Map<string, Promise<void>>();
  private readonly catalogWrites = new Map<string, Promise<boolean>>();
  private readonly workspaceLoads = new Map<string, Promise<void>>();
  private readonly bookmarks = new Map<string, PiSessionBookmark>();
  private readonly sessionLoads = new Map<string, Promise<void>>();
  private readonly reconciliations = new Map<string, Promise<void>>();
  private readonly recordVersions = new Map<string, number>();
  private readonly workspaceClosures = new Map<string, Promise<void>>();
  private readonly workspaceGenerations = new Map<string, number>();
  private readonly extensionInteractionTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly pendingExtensionUi = new Map<string, SessionRecord["snapshot"]["piExtensionUi"]>();
  private readonly authManagers = new Map<string, PiAuthManager>();
  private disposePromise?: Promise<void>;
  private readonly conversationEmitters = new Map<string, Emitter<ConversationTopicWireCandidate>>();
  private readonly indexEmitters = new Map<string, Emitter<SessionsIndexTopicWireCandidate>>();
  private readonly configEmitters = new Map<string, Emitter<WorkspaceConfigTopicWireCandidate>>();
  private readonly lifecycleEmitter = new Emitter<ZCodeAgentRuntimeLifecycleEvent>();
  private readonly restartEmitter = new Emitter<{ workspaceKey: string }>();
  private readonly llamaProgressEmitter = new Emitter<PiLlamaRouterProgressEvent>();
  private readonly llamaOperations = new Map<string, { client: PiLlamaRouterClient; modelId: string }>();
  private readonly llamaReservations = new Set<string>();
  private readonly availableWorkspaces = new Map<string, ZCodeAgentWorkspaceTarget>();
  private readonly connectionId = randomUUID();

  // These are real service events. The native RPC Channel treats every onXxx
  // member as an Event and subscribes to it during Host/window startup.
  readonly onAgentRuntimeLifecycle = this.lifecycleEmitter.event;
  readonly onAgentRuntimeRestarted = this.restartEmitter.event;
  readonly onPiLlamaRouterProgress = this.llamaProgressEmitter.event;

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
    this.queueMedia = new PiQueueMediaStore(join(catalogDir, "queue-media"));
    this.ledger = new PiCommandLedger(join(catalogDir, "command-admission"));
    supervisor.on("record", (sessionId, record) => this.onPiRecord(sessionId, record));
    supervisor.on("change", view => this.onPiChange(view));
    supervisor.on("diagnostic", (_sessionId, diagnostic) => {
      // stderr can contain prompts, paths and credentials. Preserve only its
      // bounded category; protocol faults already project an error via change.
      if (this.reportedRecordTypes.size < 32) {
        const key = `diagnostic:${diagnostic.kind}`;
        if (!this.reportedRecordTypes.has(key)) {
          this.reportedRecordTypes.add(key);
          console.warn("[pi-agent] Pi runtime diagnostic", diagnostic.kind);
        }
      }
    });
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
      ...(record.state.piReturnedQueue ? { returnedQueue: record.state.piReturnedQueue as ReturnedQueue } : {}),
      ...(record.state.piQueueRecovery ? { queueRecovery: record.state.piQueueRecovery as PiQueueRecoveryEntry[] } : {}),
      ...(record.state.piInterruptedQueueRecovery ? {
        interruptedQueueRecovery: record.state.piInterruptedQueueRecovery as PiQueueRecoveryEntry[],
      } : {}),
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

  private async refreshRuntimeFacts(record: SessionRecord): Promise<void> {
    // Runtime enrichment is additive: minimal lifecycle test doubles and older
    // hosts may implement admission without these read-only query helpers.
    if (typeof this.supervisor.refreshState !== "function" || typeof this.supervisor.command !== "function") return;
    const [state, levels, stats] = await Promise.all([
      this.supervisor.refreshState(record.view.sessionId),
      this.supervisor.command(record.view.sessionId, { type: "get_available_thinking_levels" }).catch(() => undefined),
      this.supervisor.command(record.view.sessionId, { type: "get_session_stats" }).catch(() => undefined),
    ]);
    Object.assign(record.state, state);
    const levelObject = levels && typeof levels === "object" ? levels as Record<string, unknown> : {};
    if (Array.isArray(levelObject.levels)) record.state.piThinkingLevels = levelObject.levels;
    if (stats && typeof stats === "object") record.state.piSessionStats = stats;
    if (typeof this.supervisor.getQueueCatalog === "function") {
      try { await this.refreshQueueFacts(record); }
      catch { record.state.piQueueCompatible = false; }
    }
    const projected = createPiV4Snapshot(record.view, record.state, record.snapshot.logEpoch);
    this.emitConversation(record, [{ op: "state.updated", patch: {
      config: projected.config, usage: projected.usage, inputRouting: projected.inputRouting,
      availability: projected.availability,
    } }]);
  }

  private refreshQueueFacts(record: SessionRecord): Promise<void> {
    const id = record.view.sessionId;
    const prior = this.queueRefreshes.get(id) ?? Promise.resolve();
    const pending = prior.catch(() => {}).then(async () => {
      for (let attempt = 0; attempt < 4; attempt++) {
        const catalog = await this.supervisor.getQueueCatalog(id);
        const refs = new Map<string, AttachmentRef[]>();
        try {
          for (const item of [...catalog.steering, ...catalog.followUp]) {
            if (item.images.length === 0) continue;
            const full = await this.supervisor.readQueueItem(id, catalog.revision, item.id);
            refs.set(item.id, await this.queueMedia.materialize(id, full));
          }
          const current = await this.supervisor.getQueueCatalog(id);
          if (current.revision !== catalog.revision) continue;
          if (this.sessions.get(id) !== record) return;
          record.state.piQueueItems = projectPiQueueCatalog(current, refs);
          record.state.piQueueRecovery = [
            ...current.steering.map(item => ({ id: item.id, text: item.text,
              lane: "steering" as const, attachments: refs.get(item.id) ?? [] })),
            ...current.followUp.map(item => ({ id: item.id, text: item.text,
              lane: "followUp" as const, attachments: refs.get(item.id) ?? [] })),
          ];
          record.state.piQueueCompatible = true;
          record.state.piStoppedQueue = current.paused;
          const projected = createPiV4Snapshot(record.view, record.state, record.snapshot.logEpoch);
          this.emitConversation(record, [{ op: "state.updated", patch: {
            queue: projected.queue, availability: projected.availability,
          } }]);
          await this.safelyPersist(record);
          return;
        } catch (error) {
          if (error instanceof Error && /revision changed|consumed or removed/iu.test(error.message)) continue;
          throw error;
        }
      }
      throw new Error("Pi queue changed throughout readback");
    });
    this.queueRefreshes.set(id, pending);
    void pending.finally(() => { if (this.queueRefreshes.get(id) === pending) this.queueRefreshes.delete(id); })
      .catch(() => {});
    return pending;
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
      // Pi's fixed-version SessionManager owns JSONL discovery and workspace
      // filtering. App bookmarks only preserve display/control metadata. Older
      // lifecycle test doubles only implement admission, not discovery.
      const cliSessions = typeof this.supervisor.sessionDirectory === "function"
        ? await SessionManager.list(params.workspacePath,
          await this.supervisor.sessionDirectory(params.workspacePath)) : [];
      this.assertWorkspaceOpen(params);
      for (const entry of bookmarks) {
        if (entry.workspacePath === params.workspacePath) this.bookmarks.set(entry.sessionId, entry);
      }
      for (const session of cliSessions) {
        if (!/^[a-f0-9-]{36}$/iu.test(session.id) || !Number.isFinite(session.created.getTime()) ||
          !Number.isFinite(session.modified.getTime())) continue;
        const previous = this.bookmarks.get(session.id);
        if (previous && previous.workspaceKey !== workspaceKey) continue;
        const title = session.name?.trim() ||
          (session.firstMessage === "(no messages)" ? "" : session.firstMessage.trim().slice(0, 100));
        this.bookmarks.set(session.id, {
          ...previous,
          sessionId: session.id, sessionFile: previous?.sessionFile ?? session.path,
          workspacePath: params.workspacePath, workspaceKey,
          workspaceId: previous?.workspaceId ?? workspaceKey,
          createdAt: session.created.getTime(), lastActivityAt: session.modified.getTime(),
          title: title || undefined, titleSource: title
            ? session.name ? "custom" : "generated" : "default",
        });
      }
    })();
    this.workspaceLoads.set(workspaceKey, pending);
    return pending;
  }

  private async loadSession(params: ZCodeAgentWorkspaceTarget, sessionId: string): Promise<void> {
    await this.loadWorkspace(params);
    const current = this.sessions.get(sessionId);
    if (current && current.view.phase !== "exited") {
      if (current.state.piOfflinePending !== true || !await sessionFileExists(current.view.sessionFile)) return;
      this.sessions.delete(sessionId);
    }
    const entry = this.bookmarks.get(sessionId);
    if (!entry || entry.workspaceKey !== resolveWorkspaceKey(params)) throw new Error("Pi session is not indexed in this workspace");
    const pending = this.sessionLoads.get(sessionId);
    if (pending) return pending;
    const loading = (async () => {
      let view: PiSessionView | undefined;
      try {
        if (entry.pendingIntent && !await sessionFileExists(entry.sessionFile)) {
          // Pi may have run an extension without ever creating JSONL. The
          // persisted pointer remains visible, but no input may be replayed.
          const offlineView: PiSessionView = { sessionId, sessionFile: entry.sessionFile,
            workspacePath: entry.workspacePath, pid: 0, phase: "error", uncertainDelivery: true,
            reconciliationRequired: true,
            error: "Previous Pi input may have executed without writing history; inspect before recovery" };
          const projection = new PiMessageRows(entry.workspacePath);
          const state: Record<string, unknown> = { piPendingIntent: entry.pendingIntent,
            piOfflinePending: true, messageCount: 0 };
          state.piInterruptedQueueRecovery = [...(entry.interruptedQueueRecovery ?? []), ...(entry.queueRecovery ?? [])];
          if (entry.returnedQueue) {
            state.piReturnedQueue = entry.returnedQueue;
            state.piStoppedQueue = true;
            state.piQueueItems = piQueueItems(entry.returnedQueue, "pi-returned");
          }
          const rows = projection.restore([], entry.commandAnchors, entry.rowIds);
          this.sessions.set(sessionId, { workspaceKey: entry.workspaceKey, workspaceId: entry.workspaceId,
            view: offlineView, state, projection, admissionGeneration: entry.pendingIntent.generation ?? 0,
            snapshot: conversationSnapshotSchema.parse({ ...createPiV4Snapshot(offlineView, state, randomUUID()),
              rows: { window: rows, totalCount: rows.length, firstRowId: null } }),
            createdAt: entry.createdAt, lastActivityAt: entry.lastActivityAt });
          return;
        }
        view = await this.supervisor.resumeSession(entry.workspacePath, entry.sessionFile, entry.sessionId);
        const [state, messages] = await Promise.all([
          this.supervisor.getState(sessionId), this.supervisor.getHistoryMessages(sessionId),
        ]);
        state.piExtensionUi = this.pendingExtensionUi.get(sessionId) ?? emptyPiExtensionUiState();
        this.pendingExtensionUi.delete(sessionId);
        this.assertWorkspaceOpen(params);
        const projection = new PiMessageRows(entry.workspacePath);
        let rows = projection.restore(messages, entry.commandAnchors, entry.rowIds);
        state.messageCount = messages.length;
        state.piInterruptedQueueRecovery = [...(entry.interruptedQueueRecovery ?? []), ...(entry.queueRecovery ?? [])];
        if (messages.some(message => typeof message === "object" && message !== null &&
          (message as Record<string, unknown>).role === "compactionSummary")) state.piCompacted = true;
        // Only a matching Pi user message *after* the pre-admission history,
        // with Pi now idle, can discharge an unknown write. An absent or
        // ambiguous message remains blocked; never replay the original prompt.
        const pending = entry.pendingIntent;
        const matchedIntent = Boolean(pending && matchesCompletedIntent(messages, pending));
        if (pending && matchedIntent) rows = projection.restore(messages, [...(entry.commandAnchors ?? []),
          { textHash: pending.textHash, commandId: pending.commandId }], entry.rowIds);
        const safeToContinue = Boolean(matchedIntent &&
          !projection.hasIncompleteTurn() && state.isStreaming === false && state.isCompacting === false &&
          Number(state.pendingMessageCount) === 0);
        if ((projection.hasIncompleteTurn() || pending || entry.uncertainDelivery || current?.view.uncertainDelivery ||
          current?.view.reconciliationRequired) && !safeToContinue) {
          view = this.supervisor.requireReconciliation(sessionId,
            entry.uncertainDelivery === true || current?.view.uncertainDelivery === true);
        }
        if (pending && safeToContinue) {
          state.piPendingIntent = undefined;
        } else state.piPendingIntent = pending;
        if (entry.returnedQueue) {
          state.piReturnedQueue = entry.returnedQueue;
          state.piStoppedQueue = true;
          state.piQueueItems = piQueueItems(entry.returnedQueue, "pi-returned");
        }
        const snapshot = conversationSnapshotSchema.parse({
          ...createPiV4Snapshot(view, state, randomUUID()),
          rows: { window: rows, totalCount: rows.length, firstRowId: rows[0]?.rowId ?? null },
        });
        this.sessions.set(sessionId, { workspaceKey: entry.workspaceKey, workspaceId: entry.workspaceId,
          view, state, projection, snapshot, admissionGeneration: entry.pendingIntent?.generation ?? 0,
          createdAt: entry.createdAt, lastActivityAt: entry.lastActivityAt });
        const loaded = this.sessions.get(sessionId)!;
        await this.refreshRuntimeFacts(loaded);
        this.refreshWorkspaceConfig(entry.workspaceKey);
        if (safeToContinue) await this.safelyPersist(loaded);
        this.emitIndex(entry.workspaceKey, loaded);
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

  private emitIndexRemoval(workspaceKey: string, sessionId: string): void {
    const log = this.indexLog(workspaceKey);
    const fromSeq = log.seq++;
    const topic = sessionsIndexTopic(workspaceKey);
    for (const sub of this.subscriptions.values()) {
      if (sub.topic !== topic || sub.workspaceKey !== workspaceKey) continue;
      const frame = sessionsIndexTopicFrameSchema.parse({
        topic, subscriptionId: sub.id, fromSeq, toSeq: log.seq, sentAt: Date.now(),
        payload: { kind: "deltas", deltas: [{ op: "session.removed", sessionId }] },
      });
      for (const wire of piWireFrames(frame, "online", ++sub.ordinal)) {
        getEmitter(this.indexEmitters, workspaceKey).fire(wire);
      }
    }
  }

  private onPiRecord(sessionId: string, event: Record<string, unknown>): void {
    const record = this.sessions.get(sessionId);
    if (!record) {
      if (event.type === "extension_ui_request" && this.supervisor.getSession(sessionId)) {
        const prior = this.pendingExtensionUi.get(sessionId) ?? emptyPiExtensionUiState();
        const next = reducePiExtensionUiState(prior, event);
        if (next !== prior) this.pendingExtensionUi.set(sessionId, next);
      }
      return;
    }
    if (event.type === "extension_ui_request") {
      const prior = (record.state.piExtensionUi as SessionRecord["snapshot"]["piExtensionUi"] | undefined)
        ?? emptyPiExtensionUiState();
      const next = reducePiExtensionUiState(prior, event);
      if (next !== prior) {
        record.state.piExtensionUi = next;
        this.emitConversation(record, [{ op: "state.updated", patch: { piExtensionUi: next } }]);
      }
    }
    if (event.type === "extension_ui_request" && typeof event.id === "string" &&
      ["select", "confirm", "input", "editor"].includes(String(event.method))) {
      const options = event.method === "select" && Array.isArray(event.options)
        ? event.options.filter((value): value is string => typeof value === "string")
          .map(value => ({ optionId: value, label: value }))
        : event.method === "confirm"
          ? [{ optionId: "true", label: "Confirm" }, { optionId: "false", label: "Cancel" }]
          : undefined;
      const interactions = Array.isArray(record.state.piExtensionInteractions)
        ? record.state.piExtensionInteractions as Array<Record<string, unknown>> : [];
      const interaction = { interactionId: event.id, kind: "userInput" as const, anchorRowId: null,
        createdAt: Date.now(), payload: { kind: "userInput" as const,
          prompt: typeof event.title === "string" ? event.title : "Pi extension input",
          freeText: event.method === "input" || event.method === "editor",
          ...(options ? { options } : {}), input: { method: event.method,
            ...(typeof event.placeholder === "string" ? { placeholder: event.placeholder } : {}),
            ...(typeof event.message === "string" ? { message: event.message } : {}),
            ...(typeof event.prefill === "string" ? { prefill: event.prefill } : {}) } } };
      record.state.piExtensionInteractions = [...interactions.filter(item => item.interactionId !== event.id), interaction];
      const projected = createPiV4Snapshot(record.view, record.state, record.snapshot.logEpoch);
      this.emitConversation(record, [{ op: "state.updated", patch: { pendingInteractions: projected.pendingInteractions } }]);
      if (typeof event.timeout === "number" && event.timeout > 0) {
        const key = `${sessionId}:${event.id}`;
        clearTimeout(this.extensionInteractionTimers.get(key));
        const timer = setTimeout(() => {
          this.extensionInteractionTimers.delete(key);
          this.clearExtensionInteraction(record, event.id as string);
        }, event.timeout + 50);
        this.extensionInteractionTimers.set(key, timer);
      }
    }
    const version = (this.recordVersions.get(sessionId) ?? 0) + 1;
    this.recordVersions.set(sessionId, version);
    if (typeof event.type === "string" && ![
      "agent_start", "agent_end", "agent_settled", "message_start", "message_update", "message_end",
      "tool_execution_start", "tool_execution_update", "tool_execution_end", "queue_update",
      "pi_gui_queue_update_v1",
      "auto_retry_start", "auto_retry_end", "summarization_retry_scheduled",
      "summarization_retry_finished", "compaction_start", "compaction_end", "extension_error",
      "extension_ui_request", "extension_ui_response", "session_start", "session_shutdown", "entry_appended",
    ].includes(event.type) && this.reportedRecordTypes.size < 32 && !this.reportedRecordTypes.has(event.type)) {
      this.reportedRecordTypes.add(event.type);
      // Only the record type is logged. Unknown payloads may contain secrets.
      console.warn("[pi-agent] unprojected Pi record", event.type.slice(0, 64).replace(/[^a-z0-9_-]/giu, "?"));
    }
    if (event.type === "queue_update" && record.state.piQueueCompatible !== true) {
      const live = { steering: Array.isArray(event.steering) ? event.steering.filter((x): x is string => typeof x === "string") : [],
        followUp: Array.isArray(event.followUp) ? event.followUp.filter((x): x is string => typeof x === "string") : [] };
      record.state.piQueueItems = piQueueItems(live, "pi-rpc");
    }
    if (event.type === "pi_gui_queue_update_v1") {
      void this.refreshQueueFacts(record).catch(error => {
        console.warn("[pi-agent] queue readback failed", error instanceof Error ? error.name : "unknown");
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
    if (event.type === "agent_settled" && Array.isArray(record.state.piExtensionInteractions)) {
      for (const interaction of record.state.piExtensionInteractions as Array<Record<string, unknown>>) {
        if (typeof interaction.interactionId === "string") this.clearExtensionInteraction(record, interaction.interactionId);
      }
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
    if (event.type === "agent_settled") {
      this.reconcileSettled(record, version, record.admissionGeneration);
    }
    else if (event.type === "queue_update" && record.state.piQueueCompatible !== true ||
      event.type === "auto_retry_start" || event.type === "auto_retry_end" ||
      event.type === "summarization_retry_scheduled" || event.type === "summarization_retry_finished") {
      const projected = createPiV4Snapshot(record.view, record.state, record.snapshot.logEpoch);
      this.emitConversation(record, [{ op: "state.updated", patch: { queue: projected.queue, control: projected.control } }]);
    }
  }

  private clearExtensionInteraction(record: SessionRecord, interactionId: string): void {
    const timerKey = `${record.view.sessionId}:${interactionId}`;
    clearTimeout(this.extensionInteractionTimers.get(timerKey));
    this.extensionInteractionTimers.delete(timerKey);
    this.supervisor.forgetExtensionRequest(record.view.sessionId, interactionId);
    const interactions = Array.isArray(record.state.piExtensionInteractions)
      ? record.state.piExtensionInteractions as Array<Record<string, unknown>> : [];
    const next = interactions.filter(item => item.interactionId !== interactionId);
    if (next.length === interactions.length) return;
    record.state.piExtensionInteractions = next;
    const projected = createPiV4Snapshot(record.view, record.state, record.snapshot.logEpoch);
    this.emitConversation(record, [{ op: "state.updated", patch: { pendingInteractions: projected.pendingInteractions } }]);
  }

  private reconcileSettled(record: SessionRecord, version: number, admissionGeneration: number): void {
    const id = record.view.sessionId;
    const previous = this.reconciliations.get(id) ?? Promise.resolve();
    const pending = previous.catch(() => {}).then(async () => {
      try {
        const messages = await this.supervisor.getHistoryMessages(id);
        // An older read can complete after a later Pi record, or after a
        // workspace closes/reopens. Only apply the same settled generation.
        if (this.sessions.get(id) !== record || this.workspaceClosures.has(record.workspaceKey) ||
          record.admissionGeneration !== admissionGeneration) return;
        if (this.recordVersions.get(id) !== version) {
          // A notification/queue event after settled invalidated this read. A
          // newer *run* gets its own settled event; benign late records must
          // instead trigger another authoritative read, not strand old rows.
          if (["settled", "idle", "stopped", "error"].includes(record.view.phase)) {
            this.reconcileSettled(record, this.recordVersions.get(id)!, admissionGeneration);
          }
          return;
        }
        const deltas = record.projection.reconcile(messages);
        if (record.view.phase === "stopped") deltas.push(...record.projection.markStopped(
          typeof record.state.piStoppedCommandId === "string" ? record.state.piStoppedCommandId : undefined));
        record.state.messageCount = messages.length;
        const intent = record.state.piPendingIntent as PendingIntent | undefined;
        if (intent && intent.generation === admissionGeneration &&
          matchesCompletedIntent(messages, intent) && !record.projection.hasIncompleteTurn() &&
          !record.view.uncertainDelivery && !record.view.reconciliationRequired) {
          delete record.state.piPendingIntent;
        }
        record.state.piIncompleteTurn = record.projection.hasIncompleteTurn() || Boolean(record.state.piPendingIntent);
        if (record.state.piIncompleteTurn) {
          this.supervisor.requireReconciliation(id, false);
        }
        await this.safelyPersist(record, true);
        if (deltas.length) {
          this.emitConversation(record, deltas);
          this.emitIndex(record.workspaceKey, record);
        }
        this.onPiChange(record.view);
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
    if (!record) {
      if (view.phase === "exited") this.pendingExtensionUi.delete(view.sessionId);
      return;
    }
    const oldPhase = record.view.phase;
    record.view = view;
    if (view.phase === "settled") {
      const intent = record.state.piPendingIntent as PendingIntent | undefined;
      record.state.piIncompleteTurn = record.projection.hasIncompleteTurn() ||
        Boolean(intent && !projectedIntentComplete(record, intent));
    }
    if (view.phase === "stopped" && Array.isArray(record.state.piExtensionInteractions)) {
      record.state.piExtensionInteractions = [];
    }
    if (view.phase === "stopped" && view.clearedQueue) {
      record.state.piReturnedQueue = view.clearedQueue;
      record.state.piQueueItems = piQueueItems(view.clearedQueue, "pi-returned");
      record.state.piStoppedQueue = true;
    }
    if (view.phase === "stopped" && view.queuePaused === true) record.state.piStoppedQueue = true;
    if (view.phase === "accepted" && view.queuePaused !== true && !record.state.piReturnedQueue) {
      record.state.piStoppedQueue = false;
    }
    if (oldPhase !== view.phase && view.phase === "accepted") record.state.piRunStartedAt = Date.now();
    else if (oldPhase !== view.phase && ["running", "retrying", "compacting"].includes(view.phase)) {
      record.state.piRunStartedAt ??= Date.now();
    }
    if (oldPhase !== view.phase && view.phase === "error") record.state.piErrorAt = Date.now();
    const projected = createPiV4Snapshot(view, record.state, record.snapshot.logEpoch);
    const patch: StatePatch = {};
    if (view.phase === "exited" &&
      (record.state.piExtensionUi as SessionRecord["snapshot"]["piExtensionUi"] | undefined)) {
      record.state.piExtensionUi = emptyPiExtensionUiState();
      patch.piExtensionUi = record.state.piExtensionUi as SessionRecord["snapshot"]["piExtensionUi"];
    }
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

  private async synchronizePiAuthSessions(agentDir: string): Promise<void> {
    // Service bookmarks can outlive a Pi child (for example, native task
    // prewarming followed by task replacement). Only a currently leased child
    // can observe refreshed credentials. Do not turn this into a bypass for a
    // live child's reconciliation or public bridge checks below.
    const records = [...this.sessions.values()].filter(record => {
      const active = this.supervisor.getSession(record.view.sessionId);
      return active?.pid === record.view.pid && active.sessionFile === record.view.sessionFile &&
        this.supervisor.getAgentDirectory(record.view.workspacePath) === agentDir;
    });
    for (const record of records) {
      const sessionId = record.view.sessionId;
      const key = `${record.workspaceKey}:${sessionId}`;
      if (this.treeOperations.has(key)) throw new Error("Pi control is busy; refresh providers when idle");
      this.treeOperations.add(key);
      let stage = "admission";
      try {
        // A GUI ACK can finish after the Pi result is visible. Fence new input,
        // then let the prior admitted command finish before reading Pi state.
        const admission = this.sessionAdmissions.get(key);
        if (admission) {
          let timer: ReturnType<typeof setTimeout> | undefined;
          try {
            await Promise.race([admission.catch(() => undefined), new Promise<never>((_resolve, reject) => {
              timer = setTimeout(() => reject(new Error("Pi command admission is still active")), 10_000);
            })]);
          } finally { clearTimeout(timer); }
        }
        if (record.state.piPendingIntent || !["idle", "settled", "stopped"].includes(record.view.phase)) {
          throw new Error("Pi session must be idle before synchronizing provider authentication");
        }
        stage = "bridge-inspection";
        const current = await this.supervisor.readControlBridge(sessionId);
        stage = "model-refresh";
        await this.supervisor.runControlBridge(sessionId, { operation: "refresh_models",
          sessionId, generation: current.info.generation });
        stage = "runtime-facts";
        await this.refreshRuntimeFacts(record);
      } catch (error) {
        const code = error && typeof error === "object" && "code" in error && typeof error.code === "string"
          ? error.code : error instanceof Error ? error.name : "unknown";
        console.warn("[pi-auth] active Pi model refresh failed", code, stage, {
          phase: record.view.phase, pendingIntent: Boolean(record.state.piPendingIntent),
          admission: this.sessionAdmissions.has(key),
        });
        throw error;
      } finally { this.treeOperations.delete(key); }
    }
  }

  private authFor(params: ZCodeAgentWorkspaceTarget): PiAuthManager {
    this.assertWorkspaceOpen(params);
    const agentDir = this.supervisor.getAgentDirectory(params.workspacePath);
    let manager = this.authManagers.get(agentDir);
    if (!manager) {
      manager = new PiAuthManager(agentDir, undefined, () => this.synchronizePiAuthSessions(agentDir));
      this.authManagers.set(agentDir, manager);
    }
    return manager;
  }

  private currentAuth(params: ZCodeAgentWorkspaceTarget & { generation: string }): PiAuthManager {
    const manager = this.authFor(params);
    if (manager.generation !== params.generation) throw new Error("Pi auth view is stale; refresh providers");
    return manager;
  }

  readPiAuth(params: ZCodeAgentWorkspaceTarget): Promise<PiAuthView> {
    return this.authFor(params).snapshot();
  }

  refreshPiAuth(params: ZCodeAgentWorkspaceTarget & { generation: string }): Promise<PiAuthView> {
    return this.currentAuth(params).refresh();
  }

  startPiAuth(params: ZCodeAgentWorkspaceTarget & { generation: string; providerId: string;
    action: PiAuthAction; method?: PiAuthMethod }): Promise<string> {
    return this.currentAuth(params).start(params.providerId, params.action, params.method);
  }

  async answerPiAuth(params: ZCodeAgentWorkspaceTarget & { generation: string;
    operationId: string; promptId: string; value: string }): Promise<void> {
    this.currentAuth(params).answer(params.operationId, params.promptId, params.value);
  }

  async cancelPiAuth(params: ZCodeAgentWorkspaceTarget & { generation: string;
    operationId: string }): Promise<void> {
    this.currentAuth(params).cancel(params.operationId);
  }

  async readPiControlTree(params: ZCodeAgentWorkspaceTarget & { sessionId: string;
    includeResourceContent?: boolean }): Promise<PiControlView> {
    this.assertWorkspaceOpen(params);
    await this.loadSession(params, params.sessionId);
    this.recordFor(params, params.sessionId);
    return piControlView(await this.supervisor.readControlBridge(params.sessionId),
      params.includeResourceContent === true);
  }

  private async reconcilePiTreeHistory(record: SessionRecord): Promise<void> {
    const messages = await this.supervisor.getHistoryMessages(record.view.sessionId);
    const deltas = record.projection.reconcile(messages);
    record.state.messageCount = messages.length;
    record.state.piIncompleteTurn = record.projection.hasIncompleteTurn();
    if (deltas.length) {
      this.emitConversation(record, deltas);
      this.emitIndex(record.workspaceKey, record);
    }
    await this.safelyPersist(record);
  }

  async runPiControlTree(params: ZCodeAgentWorkspaceTarget & { sessionId: string; action: PiControlAction;
    includeResourceContent?: boolean }): Promise<PiControlView> {
    this.assertWorkspaceOpen(params);
    await this.loadSession(params, params.sessionId);
    const record = this.recordFor(params, params.sessionId);
    const key = `${record.workspaceKey}:${params.sessionId}`;
    if (this.treeOperations.has(key) || this.sessionAdmissions.has(key) || record.state.piPendingIntent ||
      !["idle", "settled", "stopped"].includes(record.view.phase)) {
      throw new Error("Pi session is busy or requires history reconciliation before tree control");
    }
    this.treeOperations.add(key);
    try {
      const result = await this.supervisor.runControlBridge(params.sessionId, params.action);
      if (params.action.operation === "navigate") await this.reconcilePiTreeHistory(record);
      if (["reload", "package_install", "package_remove", "package_update", "package_filter",
        "resource_write", "resource_create", "resource_toggle"].includes(params.action.operation)) {
        await this.refreshRuntimeFacts(record);
        this.refreshWorkspaceConfig(record.workspaceKey);
      }
      return piControlView(result, params.includeResourceContent === true);
    } catch (error) {
      if (params.action.operation === "navigate") {
        try { await this.reconcilePiTreeHistory(record); }
        catch { /* Preserve the original control error; next read reports native facts. */ }
      }
      throw error;
    } finally {
      this.treeOperations.delete(key);
    }
  }

  async cancelPiTreeNavigation(params: ZCodeAgentWorkspaceTarget & { sessionId: string }): Promise<void> {
    this.assertWorkspaceOpen(params);
    this.recordFor(params, params.sessionId);
    await this.supervisor.cancelTreeNavigation(params.sessionId);
  }

  private async llamaClient(record: SessionRecord): Promise<PiLlamaRouterClient> {
    const auth = await this.supervisor.getLlamaAuth(record.view.sessionId);
    return new PiLlamaRouterClient(auth.serverUrl, auth.apiKey);
  }

  private async piModelOption(record: SessionRecord): Promise<ZCodeConfigOption> {
    const catalog = await this.supervisor.command(record.view.sessionId, { type: "get_available_models" });
    const catalogObject = catalog && typeof catalog === "object" ? catalog as Record<string, unknown> : {};
    const models = Array.isArray(catalogObject.models) ? catalogObject.models : [];
    const currentModel = record.state.model && typeof record.state.model === "object"
      ? record.state.model as Record<string, unknown> : {};
    return { id: "model", name: "Pi model", category: "pi-model", type: "select",
      currentValue: typeof currentModel.provider === "string" && typeof currentModel.id === "string"
        ? `${currentModel.provider}/${currentModel.id}` : "",
      options: models.flatMap(raw => {
        const model = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
        if (typeof model.provider !== "string" || typeof model.id !== "string") return [];
        const selected = currentModel.provider === model.provider && currentModel.id === model.id;
        const levels = selected && Array.isArray(record.state.piThinkingLevels)
          ? record.state.piThinkingLevels.filter((level): level is string => typeof level === "string") : undefined;
        return [{ value: `${model.provider}/${model.id}`,
          name: typeof model.name === "string" ? model.name : model.id,
          description: `${model.provider} · ${Array.isArray(model.input) ? model.input.join(", ") : "text"}`,
          origin: "native" as const, modelProviderId: model.provider, modelProviderName: model.provider,
          modelThoughtLevels: levels ?? ["off"],
          ...(levels ? { modelDefaultThoughtLevel: typeof record.state.thinkingLevel === "string"
            ? record.state.thinkingLevel : levels[0] } : {}) }];
      }) };
  }

  async readPiModelCatalog(params: ZCodeAgentWorkspaceTarget & { sessionId: string }): Promise<ZCodeConfigOption> {
    this.assertWorkspaceOpen(params);
    await this.loadSession(params, params.sessionId);
    return this.piModelOption(this.recordFor(params, params.sessionId));
  }

  async runPiShell(params: ZCodeAgentWorkspaceTarget & { sessionId: string; command: string;
    excludeFromContext: boolean }): Promise<import("./pi-session-supervisor.js").PiShellResult> {
    this.assertWorkspaceOpen(params);
    await this.loadSession(params, params.sessionId);
    const record = this.recordFor(params, params.sessionId);
    if (record.state.piPendingIntent) throw new Error("Pi input requires history reconciliation before shell");
    if (this.treeOperations.has(`${record.workspaceKey}:${record.view.sessionId}`)) {
      throw new Error("Pi tree control is active");
    }
    const result = await this.supervisor.runBash(record.view.sessionId, params.command, params.excludeFromContext);
    await this.reconcilePiTreeHistory(record);
    return result;
  }

  async readPiLlamaRouter(params: ZCodeAgentWorkspaceTarget & { sessionId: string }): Promise<PiLlamaRouterView> {
    this.assertWorkspaceOpen(params);
    await this.loadSession(params, params.sessionId);
    const record = this.recordFor(params, params.sessionId);
    const client = await this.llamaClient(record);
    const models = await client.list();
    // Pi's pinned provider only consults /props when an unloaded preset exists.
    const hasPreset = models.some(model => model.status.value === "unloaded" && model.source === "preset");
    const modelsAutoload = hasPreset ? (await client.props()).models_autoload === true : false;
    return { provider: "llama.cpp", piVersion: "0.87.0", serverUrl: client.serverUrl,
      modelsAutoload, models: projectPiLlamaRouterModels(models, modelsAutoload) };
  }

  async runPiLlamaRouter(params: ZCodeAgentWorkspaceTarget & { sessionId: string;
    action: PiLlamaRouterAction }): Promise<PiLlamaRouterView> {
    this.assertWorkspaceOpen(params);
    await this.loadSession(params, params.sessionId);
    const record = this.recordFor(params, params.sessionId);
    const { kind, modelId } = params.action;
    if (kind !== "load" && kind !== "unload" && kind !== "download") {
      throw new Error("Unsupported llama.cpp router action");
    }
    if (typeof modelId !== "string" || !modelId || modelId.length > 512 || modelId.includes("\0")) {
      throw new Error("Invalid llama.cpp model ID");
    }
    if (this.llamaReservations.has(params.sessionId)) throw new Error("A llama.cpp operation is already active in this session");
    this.llamaReservations.add(params.sessionId);
    try {
      const client = await this.llamaClient(record);
      this.llamaOperations.set(params.sessionId, { client, modelId });
      if (kind === "unload") await client.unload(modelId);
      else {
        const onProgress = (progress: PiLlamaRouterProgressEvent["progress"]) =>
          this.llamaProgressEmitter.fire({ sessionId: params.sessionId, modelId, action: kind, progress });
        if (kind === "load") await client.load(modelId, onProgress);
        else await client.download(modelId, onProgress);
      }
      await this.supervisor.refreshLlamaModels(params.sessionId);
      this.refreshWorkspaceConfig(record.workspaceKey, record.view.sessionId);
      return await this.readPiLlamaRouter(params);
    } finally { this.llamaOperations.delete(params.sessionId); this.llamaReservations.delete(params.sessionId); }
  }

  async cancelPiLlamaRouter(params: ZCodeAgentWorkspaceTarget & { sessionId: string;
    modelId: string }): Promise<PiLlamaRouterView> {
    this.assertWorkspaceOpen(params);
    await this.loadSession(params, params.sessionId);
    const record = this.recordFor(params, params.sessionId);
    const active = this.llamaOperations.get(params.sessionId);
    if (active && active.modelId !== params.modelId) throw new Error("Another llama.cpp model operation is active");
    const client = active?.client ?? await this.llamaClient(record);
    await client.cancel(params.modelId);
    await this.supervisor.refreshLlamaModels(params.sessionId);
    this.refreshWorkspaceConfig(record.workspaceKey, record.view.sessionId);
    return await this.readPiLlamaRouter(params);
  }

  async attachmentBeginV4(params: ZCodeAgentAttachmentBeginParams): Promise<ReturnType<PiImageUploads["begin"]>> {
    this.assertWorkspaceOpen(params);
    this.recordFor(params, params.sessionId);
    return Promise.resolve(this.imageUploads.begin(resolveWorkspaceKey(params), params));
  }

  async attachmentChunkV4(params: ZCodeAgentAttachmentChunkParams): Promise<ReturnType<PiImageUploads["chunk"]>> {
    this.assertWorkspaceOpen(params);
    this.recordFor(params, params.sessionId);
    return Promise.resolve(this.imageUploads.chunk(resolveWorkspaceKey(params), params));
  }

  attachmentCommitV4(params: ZCodeAgentAttachmentTerminalParams): ReturnType<PiImageUploads["commit"]> {
    this.assertWorkspaceOpen(params);
    this.recordFor(params, params.sessionId);
    return this.imageUploads.commit(resolveWorkspaceKey(params), params);
  }

  async attachmentAbortV4(params: ZCodeAgentAttachmentTerminalParams): Promise<void> {
    this.assertWorkspaceOpen(params);
    this.recordFor(params, params.sessionId);
    this.imageUploads.abort(resolveWorkspaceKey(params), params);
  }

  async attachmentReadV4(params: ZCodeAgentAttachmentReadParams): ReturnType<V4Methods["attachmentReadV4"]> {
    const { ref, offset, limit, target, attachmentIndex } = v4AttachmentReadParamsSchema.parse({
      sessionId: params.sessionId, ref: params.ref, offset: params.offset, limit: params.limit,
      ...(params.target ? { target: params.target } : {}),
      ...(params.attachmentIndex !== undefined ? { attachmentIndex: params.attachmentIndex } : {}),
    });
    const record = this.recordFor(params, params.sessionId);
    const row = record.projection.getRows().find(item =>
      (item.kind === "userInput" || item.kind === "extensionMessage") &&
      item.attachments?.some(attachment => attachment.ref === ref));
    if (!row || (row.kind !== "userInput" && row.kind !== "extensionMessage") ||
      (target && (row.rowId !== target.rowId || row.entityId !== target.entityId ||
      row.attachments?.[attachmentIndex!]?.ref !== ref))) throw new Error("Pi image is not in this session row");
    const image = record.projection.image(ref);
    if (!image || !["image/png", "image/jpeg", "image/gif", "image/webp"].includes(image.mimeType)) {
      throw new Error("Pi image is not available in this session");
    }
    const bytes = Buffer.from(image.data, "base64");
    if (bytes.length > 20 * 1024 * 1024 || offset > bytes.length) throw new Error("Pi image read is out of bounds");
    const end = Math.min(offset + limit, bytes.length);
    return { dataBase64: bytes.subarray(offset, end).toString("base64"), mediaType: image.mimeType,
      totalBytes: bytes.length, nextOffset: end < bytes.length ? end : null };
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
      const ack = await this.dispatchSerialized(params, envelope);
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

  private dispatchSerialized(params: ZCodeAgentConversationCommandParams,
    envelope: ZCodeAgentConversationCommandParams["envelope"]): Promise<CommandAck> {
    if (!envelope.sessionId || !["sendText", "deleteSession", "stop", "sendQueuedNow",
      "editQueueItem", "reorderQueueItem", "deleteQueueItem", "setAutoDrain"].includes(envelope.type)) {
      return this.dispatch(params, envelope);
    }
    const key = `${resolveWorkspaceKey(params)}:${envelope.sessionId}`;
    const prior = this.sessionAdmissions.get(key) ?? Promise.resolve({} as CommandAck);
    const pending = prior.catch(() => ({} as CommandAck)).then(() => this.dispatch(params, envelope));
    this.sessionAdmissions.set(key, pending);
    void pending.finally(() => {
      if (this.sessionAdmissions.get(key) === pending) this.sessionAdmissions.delete(key);
    }).catch(() => {});
    return pending;
  }

  private async dispatch(params: ZCodeAgentConversationCommandParams, envelope: ZCodeAgentConversationCommandParams["envelope"]): Promise<CommandAck> {
    const workspaceKey = resolveWorkspaceKey(params);
    const commandId = envelope.commandId;
    let record: SessionRecord | undefined;
    let createdSessionId: string | undefined;
    let firstPromptAttempted = false;
    try {
      this.assertWorkspaceOpen(params);
      if (envelope.type === "createSession") {
        const payload = envelope.payload as { workspaceId: string;
          firstInput?: { text: string; attachments?: AttachmentRef[]; mode?: string; planEnabled?: boolean;
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
        if ((payload.firstInput?.mode && payload.firstInput.mode !== "build") ||
          payload.firstInput?.planEnabled || unsupportedConfig ||
          payload.mcpServers?.length || payload.offPeakToolEnabled || payload.dynamicWorkflowEnabled) {
          return unsupported(commandId, "createSession execution constraints", 0);
        }
        const view = await this.supervisor.createSession(params.workspacePath);
        createdSessionId = view.sessionId;
        this.assertWorkspaceOpen(params);
        await this.applyModelSelection(view.sessionId, payload.firstInput?.modelSelection ?? selection);
        const state = await this.supervisor.getState(view.sessionId);
        state.piExtensionUi = this.pendingExtensionUi.get(view.sessionId) ?? emptyPiExtensionUiState();
        this.pendingExtensionUi.delete(view.sessionId);
        this.assertWorkspaceOpen(params);
        const projection = new PiMessageRows(params.workspacePath);
        const now = Date.now();
        record = {
          workspaceKey, workspaceId: payload.workspaceId, view, state, projection,
          snapshot: createPiV4Snapshot(view, state, randomUUID()), admissionGeneration: 0,
          createdAt: now, lastActivityAt: now,
        };
        this.sessions.set(view.sessionId, record);
        await this.refreshRuntimeFacts(record);
        this.refreshWorkspaceConfig(workspaceKey);
        this.emitIndex(workspaceKey, record);
        if (payload.firstInput) {
          record.admissionGeneration++;
          this.recordVersions.set(view.sessionId, (this.recordVersions.get(view.sessionId) ?? 0) + 1);
          projection.expectUserCommand(commandId);
          record.state.piPendingIntent = { textHash: createHash("sha256").update(payload.firstInput.text).digest("hex"),
            commandId, priorUserCount: 0, generation: record.admissionGeneration };
          // The pointer must exist before the first prompt can execute. Pi may
          // handle an extension command without ever writing user JSONL.
          if (!await this.persist(record)) throw new Error("Cannot persist Pi session identity before delivery");
          firstPromptAttempted = true;
          const images = await readPiPromptImages(payload.firstInput.attachments);
          const outcome = await this.supervisor.sendText(view.sessionId, payload.firstInput.text, images);
          if (outcome === "noRun") {
            projection.cancelExpectedUserCommand(commandId);
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
        if (this.treeOperations.has(`${record.workspaceKey}:${record.view.sessionId}`)) {
          return failure(commandId, "pi.treeControlBusy", "Pi tree control is active", record.snapshot.revision);
        }
        const payload = envelope.payload as { text: string; attachments?: AttachmentRef[]; requestedDelivery?: string;
          mode?: string; planEnabled?: boolean; modelSelection?: { providerId: string; modelId: string; options?: { reasoningLevel?: string } };
          browserAmbientContext?: unknown; context_refs?: unknown[]; heldQueueDisposition?: string;
          expectedHeldQueueItemIds?: string[]; modelExecution?: unknown; automationId?: string;
          offPeakTaskId?: string; offPeakRunType?: string; toolDisallowlist?: string[] };
        if ((payload.mode && payload.mode !== "build") || payload.planEnabled || payload.browserAmbientContext ||
          payload.context_refs?.length || payload.heldQueueDisposition || payload.expectedHeldQueueItemIds?.length ||
          payload.modelExecution || payload.automationId || payload.offPeakTaskId || payload.offPeakRunType ||
          payload.toolDisallowlist?.length) return unsupported(commandId, "sendText execution constraints", record.snapshot.revision);
        // The composer freezes its routing intent at click time. Never infer it
        // from a later snapshot here: a second idle foreground admission could
        // otherwise become an unintended queued side effect behind the winner.
        const requested = payload.requestedDelivery ?? "startNow";
        const busyDelivery = requested === "queue" || requested === "guide";
        if ((record.state.piPendingIntent && !(busyDelivery &&
          ["accepted", "running", "retrying", "compacting"].includes(record.view.phase))) ||
          record.view.uncertainDelivery || record.view.reconciliationRequired) {
          return failure(commandId, "pi.deliveryUnknown", "Pi input requires history reconciliation", record.snapshot.revision);
        }
        const images = await readPiPromptImages(payload.attachments);
        if (requested === "queue" || requested === "guide") {
          const queueItemId = await this.supervisor.enqueueText(record.view.sessionId, payload.text,
            requested === "guide" ? "steer" : "followUp", images);
          if (!queueItemId) throw new Error("Pinned Pi omitted queue item identity after admission");
          try { await this.refreshQueueFacts(record); }
          catch (error) {
            record.state.piQueueCompatible = false;
            console.warn("[pi-agent] accepted queue readback pending", error instanceof Error ? error.name : "unknown");
          }
          return { commandId, status: "accepted", revisionAtDecision: record.snapshot.revision,
            result: { type: "inputAccepted", delivery: requested, inputId: queueItemId } };
        }
        record.admissionGeneration++;
        this.recordVersions.set(record.view.sessionId, (this.recordVersions.get(record.view.sessionId) ?? 0) + 1);
        await this.applyModelSelection(record.view.sessionId, payload.modelSelection);
        record.projection.expectUserCommand(commandId);
        record.state.piPendingIntent = { textHash: createHash("sha256").update(payload.text).digest("hex"),
          commandId, priorUserCount: record.projection.getRows().filter(row => row.kind === "userInput").length,
          generation: record.admissionGeneration };
        try {
          const saved = await this.persist(record);
          if (!saved) throw new Error("Cannot persist Pi input correlation before delivery");
          const outcome = await this.supervisor.sendText(record.view.sessionId, payload.text, images);
          if (outcome === "noRun") {
            record.projection.cancelExpectedUserCommand(commandId);
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
      if (["editQueueItem", "reorderQueueItem", "deleteQueueItem", "sendQueuedNow", "setAutoDrain"]
        .includes(envelope.type)) {
        if (envelope.baseRevision !== record.snapshot.revision) return {
          commandId, status: "stale", reasonCode: "pi.queueSnapshotChanged",
          revisionAtDecision: record.snapshot.revision,
        };
        let catalog = await this.supervisor.getQueueCatalog(record.view.sessionId);
        const payload = envelope.payload as { queueItemId?: string; newText?: string;
          beforeQueueItemId?: string | null; autoDrain?: boolean };
        const item = [...catalog.steering, ...catalog.followUp].find(entry => entry.id === payload.queueItemId);
        if (envelope.type !== "setAutoDrain" && !item) return {
          commandId, status: "noop", reasonCode: "pi.queueItemGone", revisionAtDecision: record.snapshot.revision,
        };
        if (envelope.type === "setAutoDrain") {
          if (payload.autoDrain === false) catalog = await this.supervisor.setQueuePaused(
            record.view.sessionId, catalog.revision, true);
          else if (payload.autoDrain === true) {
            const resumed = await this.supervisor.resumeQueue(record.view.sessionId, catalog.revision);
            catalog = resumed.catalog;
          }
          await this.refreshQueueFacts(record);
          return { commandId, status: "accepted", revisionAtDecision: record.snapshot.revision };
        }
        if (envelope.type === "sendQueuedNow") {
          if (record.view.foregroundExecutionId) {
            const stopped = await this.supervisor.stop(record.view.sessionId, record.view.foregroundExecutionId);
            if (stopped !== "stopped") return {
              commandId, status: "stale", reasonCode: `pi.stop.${stopped}`,
              revisionAtDecision: record.snapshot.revision,
            };
            catalog = await this.supervisor.getQueueCatalog(record.view.sessionId);
          } else if (!catalog.paused) {
            catalog = await this.supervisor.setQueuePaused(record.view.sessionId, catalog.revision, true);
          }
          const full = await this.supervisor.readQueueItem(record.view.sessionId, catalog.revision, item!.id);
          await this.queueMedia.materialize(record.view.sessionId, full);
          record.admissionGeneration++;
          record.projection.expectUserCommand(commandId);
          record.state.piPendingIntent = { textHash: createHash("sha256").update(full.text).digest("hex"),
            commandId, priorUserCount: record.projection.getRows().filter(row => row.kind === "userInput").length,
            generation: record.admissionGeneration };
          if (!await this.persist(record)) throw new Error("Cannot persist Pi queue promotion before delivery");
          const outcome = await this.supervisor.sendText(record.view.sessionId, full.text, full.images);
          if (outcome !== "run") {
            record.state.piQueueCompatible = false;
            await this.safelyPersist(record);
            return { commandId, status: "accepted", revisionAtDecision: record.snapshot.revision };
          }
          try {
            const afterAdmission = await this.supervisor.getQueueCatalog(record.view.sessionId);
            await this.supervisor.mutateQueue(record.view.sessionId, afterAdmission.revision,
              { kind: "take", id: full.id });
            await this.refreshQueueFacts(record);
          } catch (error) {
            record.state.piQueueCompatible = false;
            this.supervisor.requireReconciliation(record.view.sessionId, true);
            console.warn("[pi-agent] accepted queue promotion requires reconciliation",
              error instanceof Error ? error.name : "unknown");
          }
          await this.safelyPersist(record);
          return { commandId, status: "accepted", revisionAtDecision: record.snapshot.revision };
        }
        try {
          await this.supervisor.mutateQueue(record.view.sessionId, catalog.revision,
            envelope.type === "reorderQueueItem"
              ? { kind: "move", id: item!.id, beforeId: payload.beforeQueueItemId ?? null }
              : envelope.type === "editQueueItem"
                ? { kind: "replace", id: item!.id, text: payload.newText ?? "" }
                : { kind: "take", id: item!.id });
          await this.refreshQueueFacts(record);
          return { commandId, status: "accepted", revisionAtDecision: record.snapshot.revision };
        } catch (error) {
          if (error instanceof Error && /revision changed|consumed or removed/iu.test(error.message)) return {
            commandId, status: "stale", reasonCode: "pi.queueChanged", revisionAtDecision: record.snapshot.revision,
          };
          throw error;
        }
      }
      if (envelope.type === "resolveInteraction") {
        const payload = envelope.payload as { interactionId: string; answer: { optionId?: string; freeText?: string;
          action?: "accept" | "decline" | "cancel" } };
        const interactions = Array.isArray(record.state.piExtensionInteractions)
          ? record.state.piExtensionInteractions as Array<Record<string, unknown>> : [];
        const interaction = interactions.find(item => item.interactionId === payload.interactionId);
        if (!interaction) return { commandId, status: "noop", reasonCode: "proto.alreadyResolved",
          revisionAtDecision: record.snapshot.revision };
        const interactionPayload = interaction.payload && typeof interaction.payload === "object"
          ? interaction.payload as Record<string, unknown> : {};
        const input = interactionPayload.input && typeof interactionPayload.input === "object"
          ? interactionPayload.input as Record<string, unknown> : {};
        const answer = payload.answer;
        const method = input.method;
        if (answer.action !== "cancel") {
          if (method === "select" && (typeof answer.optionId !== "string" ||
            !Array.isArray(interactionPayload.options) ||
            !interactionPayload.options.some(option => typeof option === "object" && option !== null &&
              (option as Record<string, unknown>).optionId === answer.optionId))) {
            return failure(commandId, "pi.invalidExtensionChoice", "Choose an offered Pi extension option",
              record.snapshot.revision);
          }
          if (method === "confirm" && answer.action !== "accept" && answer.action !== "decline" &&
            answer.optionId !== "true" && answer.optionId !== "false") {
            return failure(commandId, "pi.invalidExtensionConfirmation", "Confirm or decline the Pi extension request",
              record.snapshot.revision);
          }
          if ((method === "input" || method === "editor") && typeof answer.freeText !== "string") {
            return failure(commandId, "pi.invalidExtensionText", "Submit text or cancel the Pi extension request",
              record.snapshot.revision);
          }
        }
        await this.supervisor.respondExtension(record.view.sessionId, payload.interactionId,
          answer.action === "cancel" ? { cancelled: true }
            : input.method === "confirm" ? { confirmed: answer.action === "accept" || answer.optionId === "true" }
              : { value: answer.freeText ?? answer.optionId ?? "" });
        clearTimeout(this.extensionInteractionTimers.get(`${record.view.sessionId}:${payload.interactionId}`));
        this.extensionInteractionTimers.delete(`${record.view.sessionId}:${payload.interactionId}`);
        this.clearExtensionInteraction(record, payload.interactionId);
        return { commandId, status: "accepted", revisionAtDecision: record.snapshot.revision,
          result: { type: "resolveInteraction", resolvedBy: { clientId: envelope.clientId,
            ...(answer.optionId ? { optionId: answer.optionId } : {}) } } };
      }
      if (envelope.type === "compact") {
        await this.supervisor.command(record.view.sessionId, { type: "compact" });
        await this.refreshRuntimeFacts(record);
        return { commandId, status: "accepted", revisionAtDecision: record.snapshot.revision };
      }
      if (envelope.type === "switchModelConfig") {
        const payload = envelope.payload as { provider: string; model: string; thought: string };
        await this.supervisor.setModel(record.view.sessionId, payload.provider, payload.model, payload.thought);
        await this.refreshRuntimeFacts(record);
        this.refreshWorkspaceConfig(record.workspaceKey, record.view.sessionId);
        return { commandId, status: "accepted", revisionAtDecision: record.snapshot.revision };
      }
      if (envelope.type === "setFollowupMode") {
        const payload = envelope.payload as { mode: "queue" | "guide" };
        record.state.piDeliveryMode = payload.mode;
        await this.refreshRuntimeFacts(record);
        return { commandId, status: "accepted", revisionAtDecision: record.snapshot.revision };
      }
      if (envelope.type === "renameSession") {
        const payload = envelope.payload as { title: string };
        await this.supervisor.command(record.view.sessionId, { type: "set_session_name", name: payload.title });
        record.state.sessionName = payload.title;
        const projected = createPiV4Snapshot(record.view, record.state, record.snapshot.logEpoch);
        this.emitConversation(record, [{ op: "state.updated", patch: { meta: { ...projected.meta, titleSource: "custom" } } }]);
        this.emitIndex(record.workspaceKey, record);
        await this.safelyPersist(record);
        return { commandId, status: "accepted", revisionAtDecision: record.snapshot.revision };
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
        this.emitIndexRemoval(record.workspaceKey, record.view.sessionId);
        return { commandId, status: "accepted", revisionAtDecision: record.snapshot.revision };
      }
      return unsupported(commandId, envelope.type, record.snapshot.revision);
    } catch (error) {
      if (createdSessionId && (!record || !firstPromptAttempted)) {
        await this.supervisor.closeSession(createdSessionId);
        if (record) {
          this.sessions.delete(createdSessionId);
          this.emitIndexRemoval(record.workspaceKey, record.view.sessionId);
          record = undefined;
        }
      }
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
    queueMicrotask(() => { void this.sendConfigSnapshot(sub, "initial"); });
    return { ack: { subscriptionId: sub.id, mode: "snapshot", logEpoch: key } };
  }

  private refreshWorkspaceConfig(workspaceKey: string, preferredSessionId?: string): void {
    for (const sub of this.subscriptions.values()) {
      if (sub.workspaceKey === workspaceKey && sub.topic === workspaceConfigTopic(workspaceKey)) {
        void this.sendConfigSnapshot(sub, "recovery", preferredSessionId);
      }
    }
  }

  private async sendConfigSnapshot(sub: Subscription, deliveryKind: "initial" | "recovery",
    preferredSessionId?: string): Promise<void> {
    if (this.subscriptions.get(sub.id) !== sub) return;
    const preferred = preferredSessionId ? this.sessions.get(preferredSessionId) : undefined;
    const record = preferred?.workspaceKey === sub.workspaceKey ? preferred :
      [...this.sessions.values()].find(candidate => candidate.workspaceKey === sub.workspaceKey);
    let configOptions: ZCodeConfigOption[] = [];
    let slashCommands: Array<Record<string, unknown>> = [];
    if (record && typeof this.supervisor.command === "function") {
      const [modelOption, commands] = await Promise.all([
        this.piModelOption(record).catch(() => undefined),
        this.supervisor.command(record.view.sessionId, { type: "get_commands" }).catch(() => undefined),
      ]);
      if (modelOption) configOptions = [modelOption];
      const commandObject = commands && typeof commands === "object" ? commands as Record<string, unknown> : {};
      slashCommands = (Array.isArray(commandObject.commands) ? commandObject.commands : []).flatMap(raw => {
        const command = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
        if (typeof command.name !== "string") return [];
        return [{ name: command.name, description: typeof command.description === "string"
          ? command.description : `Pi ${String(command.source ?? "resource")} command`, source: "custom" as const }];
      });
    }
    if (this.subscriptions.get(sub.id) !== sub) return;
    const frame = workspaceConfigTopicFrameSchema.parse({
      topic: sub.topic, subscriptionId: sub.id, fromSeq: 0, toSeq: 0, sentAt: Date.now(),
      payload: { kind: "snapshot", snapshot: { protocolVersion: 1, workspaceId: sub.workspaceKey,
        logEpoch: sub.workspaceKey, config: { configOptions, slashCommands } } },
    });
    for (const wire of piWireFrames(frame, deliveryKind, ++sub.ordinal)) {
      getEmitter(this.configEmitters, sub.workspaceKey).fire(wire);
    }
  }

  async resyncWorkspaceConfigV4(params: ZCodeAgentConversationResyncParams): ReturnType<V4Methods["resyncWorkspaceConfigV4"]> {
    const sub = this.requireSubscription(params, "workspace-config/");
    queueMicrotask(() => { void this.sendConfigSnapshot(sub, "recovery"); });
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
    const failures: unknown[] = [];
    const collect = (results: PromiseSettledResult<unknown>[]) => {
      for (const result of results) if (result.status === "rejected") failures.push(result.reason);
    };
    const closeOwned = async () => {
      const results = await Promise.allSettled([...this.sessions.values()]
        .filter(record => record.workspaceKey === key).map(async record => {
          const sessionId = record.view.sessionId;
          const closed = await Promise.allSettled([
            this.supervisor.closeSession(sessionId), this.catalogWrites.get(sessionId),
          ]);
          this.sessions.delete(sessionId);
          collect(closed);
        }));
      collect(results);
    };
    await closeOwned();
    // Drain in-flight startup/admission too. They observe the closing fence and
    // cannot publish a late runtime after release has returned.
    collect(await Promise.allSettled([
      ...(this.workspaceLoads.has(key) ? [this.workspaceLoads.get(key)!] : []),
      ...[...this.sessionLoads].filter(([id]) => this.bookmarks.get(id)?.workspaceKey === key).map(([, load]) => load),
      ...[...this.reconciliations].filter(([id]) => this.sessions.get(id)?.workspaceKey === key).map(([, pending]) => pending),
      ...[...this.commandResults].filter(([commandKey]) => commandKey.startsWith(`${key}:`)).map(([, result]) => result),
    ]));
    await closeOwned();
    collect(await Promise.allSettled([this.imageUploads.releaseWorkspace(key)]));
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
    if (failures.length) throw new AggregateError(failures, "Pi workspace release failed");
  }

  dispose(): Promise<void> {
    if (this.disposePromise) return this.disposePromise;
    this.disposePromise = this.disposeOwned();
    return this.disposePromise;
  }

  private async disposeOwned(): Promise<void> {
    for (const manager of this.authManagers.values()) manager.dispose();
    this.authManagers.clear();
    this.subscriptions.clear();
    for (const timer of this.extensionInteractionTimers.values()) clearTimeout(timer);
    this.extensionInteractionTimers.clear();
    // Supervisor fences and drains starts (including the lease-to-registration
    // window). Then drain their service admissions before returning to the host.
    const failures: unknown[] = [];
    const collect = (results: PromiseSettledResult<unknown>[]) => {
      for (const result of results) if (result.status === "rejected") failures.push(result.reason);
    };
    collect(await Promise.allSettled([this.supervisor.dispose()]));
    collect(await Promise.allSettled([
      ...this.workspaceClosures.values(), ...this.workspaceLoads.values(),
      ...this.sessionLoads.values(), ...this.commandResults.values(),
    ]));
    collect(await Promise.allSettled(this.reconciliations.values()));
    collect(await Promise.allSettled(this.catalogWrites.values()));
    collect(await Promise.allSettled([this.imageUploads.dispose()]));
    for (const [workspaceKey, target] of this.availableWorkspaces) {
      this.lifecycleEmitter.fire({ ...target, workspaceKey,
        runtimeIdentity: this.getWorkspaceRuntimeIdentity(target), state: "unavailable" });
    }
    this.availableWorkspaces.clear();
    this.lifecycleEmitter.dispose();
    this.restartEmitter.dispose();
    this.llamaProgressEmitter.dispose();
    for (const emitter of [...this.conversationEmitters.values(), ...this.indexEmitters.values(), ...this.configEmitters.values()]) emitter.dispose();
    if (failures.length) throw new AggregateError(failures, "Pi global disposal failed");
  }
}
