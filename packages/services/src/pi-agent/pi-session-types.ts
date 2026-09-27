import type { PiRpcClient, RpcDiagnostic, RpcExit } from "./pi-rpc-client.js";
import type { PiSessionLease } from "./pi-session-lease.js";
import type { PiControlBridge } from "./pi-control-bridge.js";

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
  reconciliationRequired?: boolean;
  foregroundExecutionId?: string;
  /** A direct fixed Pi `bash` RPC owns this foreground execution. */
  directBash?: boolean;
  /** A direct fixed Pi `compact` RPC owns this foreground execution. */
  directCompaction?: boolean;
  queuePaused?: boolean;
  clearedQueue?: { steering: string[]; followUp: string[] };
  error?: string;
}

export interface PiSessionSupervisorOptions {
  piEntry: string;
  executable?: string;
  env?: NodeJS.ProcessEnv;
  rpcArgs?: string[];
  clientFactory?: (options: ConstructorParameters<typeof PiRpcClient>[0]) => PiRpcClient;
}

export interface SessionRuntime {
  view: PiSessionView;
  client: PiRpcClient;
  controlBridge: PiControlBridge;
  generation: string;
  stopping: boolean;
  acceptRunEvents: boolean;
  hadRunError: boolean;
  persistentRunError: boolean;
  modelRetryError?: string;
  pendingExtensionRequests: Set<string>;
  lease: PiSessionLease;
}

export type SupervisorEvents = {
  change: [view: PiSessionView];
  record: [sessionId: string, record: Record<string, unknown>];
  diagnostic: [sessionId: string, diagnostic: RpcDiagnostic];
  exit: [sessionId: string, exit: RpcExit];
};
