import type { ExtensionAPI, ExtensionCommandContext, SessionEntry, SessionTreeNode } from "@earendil-works/pi-coding-agent";

export const PI_CONTROL_PROTOCOL = 1;
export const PI_CONTROL_VERSION = "1.1.0";
export const PI_CONTROL_COMMAND = "pi-ide-control-v1";
export const PI_CONTROL_DESCRIPTION = "Pi Agent IDE public control bridge v1";
export const PI_CONTROL_PREFIX = "pi-ide-control:";
export const PI_CONTROL_OPERATIONS = ["handshake", "inspect", "navigate", "label", "set_tools", "reload", "refresh_models"] as const;
export type PiControlOperation = typeof PI_CONTROL_OPERATIONS[number];

export type PiControlIntent =
  | { operation: "navigate"; targetId: string; summarize: boolean; customInstructions?: string }
  | { operation: "label"; targetId: string; label: string | null }
  | { operation: "set_tools"; names: string[] }
  | { operation: "reload" }
  | { operation: "refresh_models" };
export type PiControlAction = PiControlIntent & { generation: string; sessionId: string };

export interface PiControlRequest {
  protocol: number;
  id: string;
  operation: PiControlOperation;
  generation?: string;
  sessionId?: string;
  params?: PiControlIntent;
}
export interface PiControlInfo {
  protocol: number;
  bridgeVersion: string;
  piVersion: string;
  generation: string;
  sessionId: string;
  mode: string;
  operations: PiControlOperation[];
}
export interface PiControlInspection {
  tools: ReturnType<ExtensionAPI["getAllTools"]>;
  activeTools: string[];
  commands: ReturnType<ExtensionAPI["getCommands"]>;
  promptOptions: ReturnType<ExtensionCommandContext["getSystemPromptOptions"]>;
  systemPrompt: string;
  projectTrusted: boolean;
}
export interface PiControlResult { cancelled?: boolean; editorText?: string; reloaded?: boolean; modelsRefreshed?: boolean }
export interface PiControlReply extends PiControlInfo {
  id: string;
  operation: PiControlOperation;
  ok: boolean;
  result?: PiControlInspection | PiControlResult;
  error?: { code: string; message: string };
}
export interface PiControlSnapshot {
  info: PiControlInfo;
  inspection: PiControlInspection;
  tree: SessionTreeNode[];
  entries: SessionEntry[];
  leafId: string | null;
  result?: PiControlResult;
}

/** Renderer view omits the expanded system prompt and extension inspection data. */
export type PiControlView = Pick<PiControlSnapshot, "info" | "tree" | "entries" | "leafId" | "result">;
export function piControlView(snapshot: PiControlSnapshot): PiControlView {
  return { info: snapshot.info, tree: snapshot.tree, entries: snapshot.entries,
    leafId: snapshot.leafId, ...(snapshot.result ? { result: snapshot.result } : {}) };
}

export function piControlRecord(record: Record<string, unknown>): boolean {
  return record.type === "extension_ui_request" && record.method === "notify" &&
    typeof record.message === "string" && record.message.startsWith(PI_CONTROL_PREFIX);
}
export function piControlObject(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function identifier(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 200 && !value.includes("\0");
}
export function piControlIntent(value: unknown): PiControlIntent {
  const input = piControlObject(value);
  switch (input.operation) {
    case "reload": return { operation: "reload" };
    case "refresh_models": return { operation: "refresh_models" };
    case "navigate":
      if (identifier(input.targetId) && typeof input.summarize === "boolean" &&
        (input.customInstructions === undefined || typeof input.customInstructions === "string" && input.customInstructions.length <= 32_768)) {
        return { operation: "navigate", targetId: input.targetId, summarize: input.summarize,
          ...(typeof input.customInstructions === "string" ? { customInstructions: input.customInstructions } : {}) };
      }
      break;
    case "label":
      if (identifier(input.targetId) && (input.label === null || typeof input.label === "string" &&
        input.label.length <= 500 && !input.label.includes("\0"))) {
        return { operation: "label", targetId: input.targetId, label: input.label as string | null };
      }
      break;
    case "set_tools":
      if (Array.isArray(input.names) && input.names.length <= 1000 && input.names.every(identifier)) {
        return { operation: "set_tools", names: [...new Set(input.names as string[])] };
      }
      break;
  }
  throw new Error("Invalid Pi control intent");
}
export function piControlAction(value: unknown): PiControlAction {
  const input = piControlObject(value);
  if (!identifier(input.generation) || !identifier(input.sessionId)) throw new Error("Pi control binding is missing");
  return { ...piControlIntent(value), generation: input.generation, sessionId: input.sessionId };
}
