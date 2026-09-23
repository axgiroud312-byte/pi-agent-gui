import type {
  ConversationSnapshot,
  SessionActionAvailability,
  SessionControl,
} from "@zcode/shared/zcode-protocol-v4";
import type { PiSessionPhase, PiSessionView } from "./pi-session-supervisor.js";

const unavailable = (reasonCode: string) => ({ allowed: false as const, reasonCode });

function availability(): SessionActionAvailability {
  // Capability tickets enable actions only after their Pi implementation lands.
  return {
    fork: unavailable("pi.notImplemented"),
    compact: unavailable("pi.notImplemented"),
    switchModelConfig: unavailable("pi.notImplemented"),
    setFollowupMode: unavailable("pi.notImplemented"),
    queueEdit: unavailable("pi.notImplemented"),
    sendQueuedNow: unavailable("pi.notImplemented"),
    pauseGoal: unavailable("pi.notImplemented"),
    resumeGoal: unavailable("pi.notImplemented"),
  };
}

function nativePhase(phase: PiSessionPhase, hasHistory: boolean): SessionControl["phase"] {
  switch (phase) {
    case "starting":
    case "accepted":
      return "prewarming";
    case "running":
    case "retrying":
    case "compacting":
    case "stopping":
      return "running";
    case "settled":
      return "completedSuccess";
    case "stopped":
      return "completedInterrupted";
    case "error":
    case "exited":
      return "error";
    case "idle":
      return hasHistory ? "completedSuccess" : "draft";
  }
}

/** Pi facts mapped into the frozen native v4 snapshot; no ZCode execution state is consulted. */
export function createPiV4Snapshot(
  view: PiSessionView,
  state: Record<string, unknown>,
  logEpoch: string,
): ConversationSnapshot {
  const model = state.model && typeof state.model === "object" && !Array.isArray(state.model)
    ? state.model as Record<string, unknown>
    : {};
  const provider = typeof model.provider === "string" && model.provider !== "unknown" ? model.provider : "";
  const modelId = typeof model.id === "string" && model.id !== "unknown" ? model.id : "";
  const hasHistory = typeof state.messageCount === "number" && state.messageCount > 0;
  const phase = nativePhase(view.phase, hasHistory);
  const running = phase === "running" || phase === "prewarming";
  const now = Date.now();
  const runStartedAt = typeof state.piRunStartedAt === "number" ? state.piRunStartedAt : now;
  const errorAt = typeof state.piErrorAt === "number" ? state.piErrorAt : now;
  const control: SessionControl = {
    phase,
    sessionEnded: phase === "completedSuccess" || phase === "completedInterrupted",
    canStop: running && view.phase !== "stopping",
    stopState: view.phase === "stopping" ? "stopping" : running ? "stoppable" : "idle",
    stopTargetKind: view.phase === "compacting" ? "compact" : running ? "assistant" : "unknown",
    activeWorks: running ? [{ kind: "primaryTurn", startedAt: runStartedAt }] : [],
    lastError: view.error ? {
      code: view.uncertainDelivery ? "pi.deliveryUnknown" : "pi.runtimeError",
      message: view.error,
      recoverable: !view.uncertainDelivery,
      at: errorAt,
      source: "runtime",
    } : state.piBookmarkError === true ? {
      code: "pi.historyBookmarkFailed",
      message: "Pi history could not be indexed. Keep this session open and check app data storage.",
      recoverable: true,
      at: typeof state.piBookmarkErrorAt === "number" ? state.piBookmarkErrorAt : now,
      source: "runtime",
    } : null,
    apiRetry: null,
  };
  return {
    protocolVersion: 1,
    sessionId: view.sessionId,
    logEpoch,
    seq: 0,
    revision: 0,
    control,
    availability: availability(),
    inputRouting: running
      ? { mode: "reject", reasonCode: "pi.busyInputRequiresQueueTicket" }
      : view.uncertainDelivery || view.phase === "exited"
        ? { mode: "reject", reasonCode: "pi.sessionUnavailable" }
        : { mode: "startNow" },
    meta: { title: typeof state.sessionName === "string" ? state.sessionName : "", titleSource: "default" },
    config: {
      provider,
      model: modelId,
      thought: typeof state.thinkingLevel === "string" ? state.thinkingLevel : "",
      thoughtLevels: [],
      followupMode: "queue",
      mode: "build",
    },
    modelTransition: null,
    usage: {
      contextWindow: null,
      cumulative: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
    },
    queue: { items: [], autoDrain: true },
    pendingInteractions: [],
    pendingCommands: [],
    backgroundWorks: [],
    subagents: { revision: 0, childSessionIds: [], running: [], endedTotal: 0 },
    goal: null,
    plan: null,
    workspaceHookAdmission: null,
    rows: { window: [], totalCount: 0, firstRowId: null },
  };
}
