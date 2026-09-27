import type { ExtensionAPI, ExtensionCommandContext, PackageSource, SessionEntry, SessionTreeNode,
  SourceInfo } from "@earendil-works/pi-coding-agent";

export const PI_CONTROL_PROTOCOL = 1;
export const PI_CONTROL_VERSION = "1.1.0";
export const PI_CONTROL_COMMAND = "pi-ide-control-v1";
export const PI_CONTROL_DESCRIPTION = "Pi Agent IDE public control bridge v1";
export const PI_CONTROL_PREFIX = "pi-ide-control:";
export const PI_CONTROL_OPERATIONS = ["handshake", "inspect", "navigate", "label", "set_tools", "reload",
  "refresh_models", "router_auth", "router_refresh",
  "package_install", "package_remove", "package_update", "package_filter", "resource_read", "resource_write",
  "resource_create", "resource_toggle"] as const;
export type PiControlOperation = typeof PI_CONTROL_OPERATIONS[number];

export type PiPackageScope = "user" | "project";
export type PiPackageFilters = Omit<Extract<PackageSource, object>, "source">;
export interface PiResourcePackage { source: string; scope: PiPackageScope; filtered: boolean;
  installedPath?: string; configuration: PackageSource }
export interface PiAvailableResource { kind: "extension" | "skill" | "prompt" | "theme";
  path: string; enabled: boolean; sourceInfo: SourceInfo }
export interface PiResourceCatalog {
  commands: ReturnType<ExtensionAPI["getCommands"]>;
  skills: Array<{ name: string; description: string; filePath: string; sourceInfo: SourceInfo }>;
  contextFiles: Array<{ path: string; content: string }>;
  customSystemPrompt: string | null;
  appendSystemPrompt: string;
  effectiveSystemPrompt: string;
  projectTrusted: boolean;
  packages: PiResourcePackage[];
  systemPromptFiles: Array<{ kind: "replace" | "append"; scope: PiPackageScope;
    path: string; active: boolean }>;
  availableResources: PiAvailableResource[];
  diagnostics: string[];
  skillCommandsEnabled: boolean;
}

export type PiControlIntent =
  | { operation: "navigate"; targetId: string; summarize: boolean; customInstructions?: string }
  | { operation: "label"; targetId: string; label: string | null }
  | { operation: "set_tools"; names: string[] }
  | { operation: "reload" }
  | { operation: "refresh_models" }
  | { operation: "package_install" | "package_remove" | "package_update"; source: string; scope: PiPackageScope }
  | { operation: "package_filter"; source: string; scope: PiPackageScope; filters: PiPackageFilters }
  | { operation: "resource_read"; path: string }
  | { operation: "resource_write"; path: string; expectedHash: string; content: string }
  | { operation: "resource_create"; kind: "replace" | "append"; scope: PiPackageScope; content: string }
  | { operation: "resource_toggle"; kind: "skill" | "prompt"; path: string; enabled: boolean };
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
  packages: PiResourcePackage[];
  systemPromptFiles: PiResourceCatalog["systemPromptFiles"];
  availableResources: PiAvailableResource[];
  diagnostics: string[];
  skillCommandsEnabled: boolean;
}
export interface PiControlResult { cancelled?: boolean; editorText?: string; reloaded?: boolean;
  modelsRefreshed?: boolean;
  // Host-only router auth result never enters PiControlView or renderer RPC.
  serverUrl?: string; apiKey?: string; catalogRefreshed?: boolean;
  resource?: { path: string; content: string; hash: string } }
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

/** Renderer gets resource contents only for an explicit resource-panel request. */
export type PiControlView = Pick<PiControlSnapshot, "info" | "tree" | "entries" | "leafId" | "result"> &
  { resources: PiResourceCatalog };
function visibleEntry(entry: SessionEntry): SessionEntry {
  if (entry.type !== "message") return entry;
  const message = { ...entry.message } as Record<string, unknown>;
  delete message.sections;
  return { ...entry, message: message as typeof entry.message };
}
function visibleTree(nodes: SessionTreeNode[]): SessionTreeNode[] {
  return nodes.map(node => ({ ...node, entry: visibleEntry(node.entry), children: visibleTree(node.children) }));
}
export function piControlView(snapshot: PiControlSnapshot, includeResourceContent = false): PiControlView {
  const result = snapshot.result && (includeResourceContent ? snapshot.result :
    (({ resource: _resource, ...visible }) => visible)(snapshot.result));
  return { info: snapshot.info, tree: visibleTree(snapshot.tree), entries: snapshot.entries.map(visibleEntry),
    leafId: snapshot.leafId, ...(result ? { result } : {}),
    resources: { commands: snapshot.inspection.commands,
      skills: (snapshot.inspection.promptOptions.skills ?? []).map(skill => ({
        name: skill.name, description: skill.description, filePath: skill.filePath, sourceInfo: skill.sourceInfo })),
      contextFiles: (snapshot.inspection.promptOptions.contextFiles ?? []).map(file => ({
        path: file.path, content: includeResourceContent ? file.content : "" })),
      customSystemPrompt: includeResourceContent ? snapshot.inspection.promptOptions.customPrompt ?? null : null,
      appendSystemPrompt: includeResourceContent ? snapshot.inspection.promptOptions.appendSystemPrompt ?? "" : "",
      effectiveSystemPrompt: includeResourceContent ? snapshot.inspection.systemPrompt : "",
      projectTrusted: snapshot.inspection.projectTrusted, packages: snapshot.inspection.packages,
      systemPromptFiles: snapshot.inspection.systemPromptFiles,
      availableResources: snapshot.inspection.availableResources,
      diagnostics: snapshot.inspection.diagnostics,
      skillCommandsEnabled: snapshot.inspection.skillCommandsEnabled } };
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
function packageSource(value: unknown): value is string {
  if (typeof value !== "string" || !value.trim() || value.length > 2048 || value.includes("\0")) return false;
  const urlPart = value.startsWith("git:") ? value.slice(4) : value;
  if (/^(?:https?|ssh|git):\/\//i.test(urlPart)) {
    try { const url = new URL(urlPart); if (url.username || url.password) return false; }
    catch { return false; }
  }
  return true;
}
function packageScope(value: unknown): value is PiPackageScope {
  return value === "user" || value === "project";
}
function packageFilters(value: unknown): PiPackageFilters {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid Pi package filters");
  }
  const input = piControlObject(value);
  if (Object.keys(input).some(key => !["autoload", "extensions", "skills", "prompts", "themes"].includes(key)) ||
    input.autoload !== undefined && typeof input.autoload !== "boolean") throw new Error("Invalid Pi package filters");
  const filters: PiPackageFilters = {};
  if (typeof input.autoload === "boolean") filters.autoload = input.autoload;
  for (const key of ["extensions", "skills", "prompts", "themes"] as const) {
    const entries = input[key];
    if (entries === undefined) continue;
    if (!Array.isArray(entries) || entries.length > 200 ||
      !entries.every(entry => typeof entry === "string" && entry.length <= 1000 && !entry.includes("\0"))) {
      throw new Error("Invalid Pi package filters");
    }
    filters[key] = entries;
  }
  return filters;
}
function resourcePath(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 2048 && !value.includes("\0");
}
export function piControlIntent(value: unknown): PiControlIntent {
  const input = piControlObject(value);
  switch (input.operation) {
    case "reload": return { operation: "reload" };
    case "refresh_models": return { operation: "refresh_models" };
    case "package_install":
    case "package_remove":
    case "package_update":
      if (packageSource(input.source) && packageScope(input.scope)) {
        return { operation: input.operation, source: input.source, scope: input.scope };
      }
      break;
    case "package_filter":
      if (packageSource(input.source) && packageScope(input.scope)) {
        return { operation: "package_filter", source: input.source, scope: input.scope,
          filters: packageFilters(input.filters) };
      }
      break;
    case "resource_read":
      if (resourcePath(input.path)) return { operation: "resource_read", path: input.path };
      break;
    case "resource_write":
      if (resourcePath(input.path) && typeof input.expectedHash === "string" &&
        /^[a-f0-9]{64}$/.test(input.expectedHash) && typeof input.content === "string" &&
        new TextEncoder().encode(input.content).byteLength <= 1_048_576) {
        return { operation: "resource_write", path: input.path, expectedHash: input.expectedHash,
          content: input.content };
      }
      break;
    case "resource_create":
      if ((input.kind === "replace" || input.kind === "append") && packageScope(input.scope) &&
        typeof input.content === "string" && new TextEncoder().encode(input.content).byteLength <= 1_048_576) {
        return { operation: "resource_create", kind: input.kind, scope: input.scope, content: input.content };
      }
      break;
    case "resource_toggle":
      if ((input.kind === "skill" || input.kind === "prompt") && resourcePath(input.path) &&
        typeof input.enabled === "boolean") {
        return { operation: "resource_toggle", kind: input.kind, path: input.path, enabled: input.enabled };
      }
      break;
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
