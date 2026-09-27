import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { DefaultPackageManager, getAgentDir, SettingsManager, VERSION,
  type ExtensionAPI, type ExtensionCommandContext, type ExtensionContext, type PackageSource } from "@earendil-works/pi-coding-agent";
import {
  PI_CONTROL_COMMAND, PI_CONTROL_DESCRIPTION, PI_CONTROL_LIFECYCLE_PREFIX,
  PI_CONTROL_OPERATIONS, PI_CONTROL_PREFIX,
  PI_CONTROL_PROTOCOL, PI_CONTROL_VERSION, piControlIntent, piControlObject,
  type PiControlInfo, type PiControlIntent, type PiControlReply, type PiControlRequest,
  type PiAvailableResource, type PiResourcePackage,
} from "./pi-control-protocol.js";

interface Binding { info: PiControlInfo; emit(reply: PiControlReply): void }
interface ReloadOperation { request: PiControlRequest; fresh?: Binding }
interface ProcessState { binding?: Binding; reload?: ReloadOperation; busy: boolean }
const stateKey = Symbol.for("pi-agent-ide.control.v1");
const globals = globalThis as typeof globalThis & { [stateKey]?: ProcessState };
// Reload re-evaluates the module. Only operation correlation lives across it;
// no ExtensionContext or ExtensionAPI reference from the old generation does.
const state = globals[stateKey] ??= { busy: false };

class ControlError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}

async function resourceSettingsFor(ctx: ExtensionCommandContext): Promise<{
  packages: PiResourcePackage[]; availableResources: PiAvailableResource[];
  diagnostics: string[]; skillCommandsEnabled: boolean;
}> {
  const settings = SettingsManager.create(ctx.cwd, getAgentDir(), { projectTrusted: ctx.isProjectTrusted() });
  const manager = new DefaultPackageManager({ cwd: ctx.cwd, agentDir: getAgentDir(), settingsManager: settings });
  const global = settings.getGlobalSettings().packages ?? [];
  const project = settings.getProjectSettings().packages ?? [];
  const diagnostics = settings.drainErrors().map(item => `${item.scope}: ${item.error.message}`);
  const packages = manager.listConfiguredPackages().map(pkg => {
    const list = pkg.scope === "project" ? project : global;
    const configuration = list.find(entry => (typeof entry === "string" ? entry : entry.source) === pkg.source);
    return { ...pkg, configuration: configuration ?? pkg.source };
  });
  const availableResources: PiAvailableResource[] = [];
  try {
    const resolved = await manager.resolve(async () => "skip");
    for (const kind of ["extension", "skill", "prompt", "theme"] as const) {
      const entries = kind === "extension" ? resolved.extensions : kind === "skill" ? resolved.skills :
        kind === "prompt" ? resolved.prompts : resolved.themes;
      for (const entry of entries) availableResources.push({ kind, path: entry.path,
        enabled: entry.enabled, sourceInfo: { path: entry.path, ...entry.metadata } });
    }
  } catch (error) {
    diagnostics.push(`Pi resource discovery: ${error instanceof Error ? error.message : "failed"}`);
  }
  return { packages, availableResources, diagnostics, skillCommandsEnabled: settings.getEnableSkillCommands() };
}

async function toggleResource(ctx: ExtensionCommandContext,
  intent: Extract<PiControlIntent, { operation: "resource_toggle" }>): Promise<void> {
  const settings = SettingsManager.create(ctx.cwd, getAgentDir(), { projectTrusted: ctx.isProjectTrusted() });
  if (settings.drainErrors().length) throw new ControlError("SETTINGS_INVALID", "Pi settings cannot be read safely");
  const manager = new DefaultPackageManager({ cwd: ctx.cwd, agentDir: getAgentDir(), settingsManager: settings });
  const resources = await manager.resolve(async () => "skip");
  const entries = intent.kind === "skill" ? resources.skills : resources.prompts;
  const entry = entries.find(item => resolve(item.path) === resolve(intent.path));
  if (!entry || entry.metadata.origin !== "top-level" || entry.metadata.scope === "temporary") {
    throw new ControlError("RESOURCE_NOT_FOUND", "Pi top-level resource is unavailable; refresh the catalog");
  }
  if (entry.metadata.scope === "project" && !ctx.isProjectTrusted()) {
    throw new ControlError("PROJECT_UNTRUSTED", "Trust this project in Pi before changing project resources");
  }
  const scope = entry.metadata.scope;
  const current = intent.kind === "skill" ? scope === "project" ? settings.getProjectSettings().skills ?? [] :
    settings.getGlobalSettings().skills ?? [] : scope === "project" ? settings.getProjectSettings().prompts ?? [] :
      settings.getGlobalSettings().prompts ?? [];
  const baseDir = entry.metadata.baseDir ?? (scope === "project" ? resolve(ctx.cwd, ".pi") : getAgentDir());
  const pattern = relative(baseDir, entry.path);
  const updated = current.filter(value => value.replace(/^[!+-]/, "") !== pattern);
  updated.push(`${intent.enabled ? "+" : "-"}${pattern}`);
  if (intent.kind === "skill") {
    if (scope === "project") settings.setProjectSkillPaths(updated);
    else settings.setSkillPaths(updated);
  } else if (scope === "project") settings.setProjectPromptTemplatePaths(updated);
  else settings.setPromptTemplatePaths(updated);
  await settings.flush();
  if (settings.drainErrors().length) throw new ControlError("SETTINGS_WRITE_FAILED", "Pi settings write failed");
}

function promptFilePath(ctx: ExtensionCommandContext, kind: "replace" | "append",
  scope: "user" | "project"): string {
  return resolve(scope === "project" ? resolve(ctx.cwd, ".pi") : getAgentDir(),
    kind === "replace" ? "SYSTEM.md" : "APPEND_SYSTEM.md");
}

async function promptFilesFor(ctx: ExtensionCommandContext) {
  const options = ctx.getSystemPromptOptions();
  const files: Array<{ kind: "replace" | "append"; scope: "user" | "project";
    path: string; active: boolean }> = [];
  for (const scope of ["user", "project"] as const) {
    if (scope === "project" && !ctx.isProjectTrusted()) continue;
    for (const kind of ["replace", "append"] as const) {
      const path = promptFilePath(ctx, kind, scope);
      try {
        const content = await readFile(path, "utf8");
        const active = kind === "replace" ? options.customPrompt === content :
          Boolean(content && options.appendSystemPrompt?.includes(content));
        files.push({ kind, scope, path, active });
      } catch { /* No file in this scope. */ }
    }
  }
  for (const kind of ["replace", "append"] as const) {
    const chosen = files.find(file => file.kind === kind && file.scope === "project") ??
      files.find(file => file.kind === kind && file.scope === "user");
    for (const file of files) if (file.kind === kind && file !== chosen) file.active = false;
  }
  return files;
}

async function managePackage(ctx: ExtensionCommandContext,
  intent: Extract<PiControlIntent, { source: string }>): Promise<void> {
  if (intent.scope === "project" && !ctx.isProjectTrusted()) {
    throw new ControlError("PROJECT_UNTRUSTED", "Trust this project in Pi before managing project packages");
  }
  const settings = SettingsManager.create(ctx.cwd, getAgentDir(), { projectTrusted: ctx.isProjectTrusted() });
  const settingsErrors = settings.drainErrors();
  if (settingsErrors.length) throw new ControlError("SETTINGS_INVALID", "Pi settings cannot be read safely");
  const manager = new DefaultPackageManager({ cwd: ctx.cwd, agentDir: getAgentDir(), settingsManager: settings });
  const configured = manager.listConfiguredPackages().find(pkg => pkg.scope === intent.scope && pkg.source === intent.source);
  if (intent.operation !== "package_install" && !configured) {
    throw new ControlError("PACKAGE_NOT_FOUND", "Pi package is not configured in this scope");
  }
  switch (intent.operation) {
    case "package_install":
      await manager.install(intent.source, { local: intent.scope === "project" });
      await settings.reload();
      if (settings.drainErrors().length) throw new ControlError("SETTINGS_INVALID", "Pi settings changed during install");
      manager.addSourceToSettings(intent.source, { local: intent.scope === "project" });
      break;
    case "package_remove": {
      // Pi stores local sources relative to the settings directory, but its
      // remove API resolves input relative to cwd. Use Pi's installed path as
      // the stable absolute identity, including when the package was filtered.
      const source = configured!.source;
      const isLocal = !source.startsWith("npm:") && !source.startsWith("git:") &&
        !/^(?:https?|ssh|git):\/\//.test(source);
      const managerSource = isLocal ? configured!.installedPath ??
        resolve(intent.scope === "project" ? resolve(ctx.cwd, ".pi") : getAgentDir(), source) : source;
      if (isLocal && !isAbsolute(managerSource)) throw new ControlError("PACKAGE_PATH", "Pi local package path is invalid");
      await manager.remove(managerSource, { local: intent.scope === "project" });
      await settings.reload();
      if (settings.drainErrors().length) throw new ControlError("SETTINGS_INVALID", "Pi settings changed during removal");
      if (!manager.listConfiguredPackages().some(pkg => pkg.scope === intent.scope && pkg.source === source)) {
        throw new ControlError("PACKAGE_CONFLICT", "Pi package setting changed during removal; refresh before retrying");
      }
      if (!manager.removeSourceFromSettings(managerSource, { local: intent.scope === "project" })) {
        throw new ControlError("PACKAGE_NOT_REMOVED", "Pi did not remove this package setting");
      }
      break;
    }
    case "package_update": await manager.update(intent.source); break;
    case "package_filter": {
      const entries = intent.scope === "project" ? settings.getProjectSettings().packages ?? [] :
        settings.getGlobalSettings().packages ?? [];
      const updated: PackageSource[] = entries.map(entry => {
        const source = typeof entry === "string" ? entry : entry.source;
        if (source !== intent.source) return entry;
        if (typeof entry === "string") return { source, ...intent.filters };
        const { autoload: _autoload, extensions: _extensions, skills: _skills,
          prompts: _prompts, themes: _themes, ...other } = entry;
        return { ...other, source, ...intent.filters };
      });
      if (intent.scope === "project") settings.setProjectPackages(updated);
      else settings.setPackages(updated);
      break;
    }
  }
  await settings.flush();
  if (settings.drainErrors().length) throw new ControlError("SETTINGS_WRITE_FAILED", "Pi settings write failed");
}

function editablePaths(pi: ExtensionAPI, ctx: ExtensionCommandContext): Set<string> {
  const paths = new Set<string>();
  const add = (path: string) => paths.add(resolve(path));
  for (const command of pi.getCommands()) {
    if (command.source === "prompt" && command.sourceInfo.origin === "top-level" &&
      (command.sourceInfo.scope !== "project" || ctx.isProjectTrusted())) add(command.sourceInfo.path);
  }
  for (const skill of ctx.getSystemPromptOptions().skills ?? []) {
    if (skill.sourceInfo.origin === "top-level" &&
      (skill.sourceInfo.scope !== "project" || ctx.isProjectTrusted())) add(skill.filePath);
  }
  for (const file of ctx.getSystemPromptOptions().contextFiles ?? []) {
    if (ctx.isProjectTrusted() || !resolve(file.path).startsWith(resolve(ctx.cwd))) add(file.path);
  }
  for (const kind of ["replace", "append"] as const) {
    add(promptFilePath(ctx, kind, "user"));
    if (ctx.isProjectTrusted()) add(promptFilePath(ctx, kind, "project"));
  }
  return paths;
}

async function readResource(pi: ExtensionAPI, ctx: ExtensionCommandContext, path: string) {
  if (!editablePaths(pi, ctx).has(resolve(path))) {
    throw new ControlError("RESOURCE_NOT_LOADED", "This file is not an editable Pi resource in the current generation");
  }
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.size > 1_048_576) {
    throw new ControlError("RESOURCE_UNSAFE", "Pi resource must be a regular file under 1 MiB");
  }
  const content = await readFile(path, "utf8");
  return { path, content, hash: createHash("sha256").update(content).digest("hex") };
}

async function writeResource(pi: ExtensionAPI, ctx: ExtensionCommandContext,
  intent: Extract<PiControlIntent, { operation: "resource_write" }>): Promise<void> {
  const before = await readResource(pi, ctx, intent.path);
  if (before.hash !== intent.expectedHash) {
    throw new ControlError("RESOURCE_CONFLICT", "Pi resource changed on disk; reload its contents before saving");
  }
  const temp = `${intent.path}.pi-ide-${randomUUID()}.tmp`;
  try {
    await writeFile(temp, intent.content, { flag: "wx" });
    // Check again after writing the temporary file. External editors do not
    // honor this bridge lock, so report any observed change instead of silently
    // replacing it. A same-instant external rename remains a filesystem race.
    if ((await readResource(pi, ctx, intent.path)).hash !== intent.expectedHash) {
      throw new ControlError("RESOURCE_CONFLICT", "Pi resource changed while saving");
    }
    await rename(temp, intent.path);
  } finally { await rm(temp, { force: true }); }
}

async function createResource(ctx: ExtensionCommandContext,
  intent: Extract<PiControlIntent, { operation: "resource_create" }>): Promise<void> {
  if (intent.scope === "project" && !ctx.isProjectTrusted()) {
    throw new ControlError("PROJECT_UNTRUSTED", "Trust this project in Pi before creating a project prompt");
  }
  const path = promptFilePath(ctx, intent.kind, intent.scope);
  await mkdir(dirname(path), { recursive: true });
  try { await writeFile(path, intent.content, { flag: "wx" }); }
  catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "EEXIST") {
      throw new ControlError("RESOURCE_CONFLICT", "Pi prompt file already exists; reload before editing");
    }
    throw error;
  }
}

export default function piControlExtension(pi: ExtensionAPI): void {
  let binding: Binding | undefined;
  const bind = (ctx: ExtensionContext): Binding => ({
    info: { protocol: PI_CONTROL_PROTOCOL, bridgeVersion: PI_CONTROL_VERSION, piVersion: VERSION,
      generation: randomUUID(), sessionId: ctx.sessionManager.getSessionId(), mode: ctx.mode,
      operations: [...PI_CONTROL_OPERATIONS] },
    emit: reply => ctx.ui.notify(PI_CONTROL_PREFIX + JSON.stringify(reply), "info"),
  });
  pi.on("session_start", (_event, ctx) => {
    binding = bind(ctx);
    state.binding = binding;
    if (state.reload) state.reload.fresh = binding;
    ctx.ui.notify(PI_CONTROL_LIFECYCLE_PREFIX + JSON.stringify({ protocol: 1,
      kind: "start", generation: binding.info.generation }), "info");
  });
  pi.on("session_shutdown", (_event, ctx) => {
    if (binding) ctx.ui.notify(PI_CONTROL_LIFECYCLE_PREFIX + JSON.stringify({ protocol: 1,
      kind: "shutdown", generation: binding.info.generation }), "info");
    if (state.binding === binding) state.binding = undefined;
    binding = undefined;
  });

  pi.registerCommand(PI_CONTROL_COMMAND, {
    description: PI_CONTROL_DESCRIPTION,
    handler: async (args, ctx: ExtensionCommandContext) => {
      const failureTransport = ctx.ui.notify;
      let request: PiControlRequest | undefined;
      let ownsLock = false;
      const reply = (target: Binding, result?: PiControlReply["result"]) =>
        target.emit({ ...target.info, id: request!.id, operation: request!.operation, ok: true, result });
      try {
        const input = piControlObject(JSON.parse(args));
        if (typeof input.id !== "string" || !input.id || input.id.length > 200) {
          throw new ControlError("INVALID_REQUEST", "Pi control correlation ID is missing");
        }
        request = input as unknown as PiControlRequest;
        if (request.protocol !== PI_CONTROL_PROTOCOL) throw new ControlError("VERSION_MISMATCH", "Pi control protocol mismatch");
        if (!PI_CONTROL_OPERATIONS.includes(request.operation)) throw new ControlError("UNSUPPORTED", "Pi control operation unsupported");
        if (!binding || ctx.mode !== "rpc") throw new ControlError("UNBOUND", "Pi RPC control is not bound");
        if (request.operation === "handshake") { reply(binding); return; }
        if (request.generation !== binding.info.generation || request.sessionId !== ctx.sessionManager.getSessionId()) {
          throw new ControlError("STALE_CONTEXT", "Pi control context is stale");
        }
        if (state.busy || !ctx.isIdle() || ctx.hasPendingMessages()) {
          throw new ControlError("BUSY", "Pi must be idle for this control");
        }
        state.busy = true; ownsLock = true;
        if (request.operation === "inspect") {
          const resourceSettings = await resourceSettingsFor(ctx);
          reply(binding, { tools: pi.getAllTools(), activeTools: pi.getActiveTools(), commands: pi.getCommands(),
            promptOptions: ctx.getSystemPromptOptions(), systemPrompt: ctx.getSystemPrompt(),
            projectTrusted: ctx.isProjectTrusted(), ...resourceSettings,
            systemPromptFiles: await promptFilesFor(ctx) });
          return;
        }
        if (request.operation === "router_auth") {
          const provider = await ctx.modelRegistry.getProviderAuth("llama.cpp");
          if (!provider) throw new ControlError("UNCONFIGURED", "Configure llama.cpp with Pi login or LLAMA_BASE_URL");
          const envUrl = provider.env?.LLAMA_BASE_URL;
          const serverUrl = typeof envUrl === "string" && envUrl ? envUrl : provider.auth.baseUrl;
          if (typeof serverUrl !== "string" || !serverUrl) {
            throw new ControlError("UNCONFIGURED", "Pi llama.cpp provider has no router URL");
          }
          reply(binding, { serverUrl, apiKey: provider.auth.apiKey });
          return;
        }
        if (request.operation === "router_refresh") {
          const result = await ctx.modelRegistry.refresh({ providers: ["llama.cpp"], allowNetwork: true,
            signal: AbortSignal.timeout(15_000) });
          if (result.aborted) throw new ControlError("TIMEOUT", "Pi llama.cpp catalog refresh timed out");
          const failure = result.errors.get("llama.cpp");
          if (failure) throw failure;
          reply(binding, { catalogRefreshed: true });
          return;
        }
        const intent = piControlIntent(request.params);
        if (intent.operation !== request.operation) throw new ControlError("INVALID_REQUEST", "Pi control operation mismatch");
        switch (intent.operation) {
          case "navigate": {
            const entry = ctx.sessionManager.getEntry(intent.targetId);
            if (!entry) throw new ControlError("ENTRY_NOT_FOUND", "Pi tree entry does not exist");
            const wasLeaf = ctx.sessionManager.getLeafId() === entry.id;
            const content = entry.type === "message" && entry.message.role === "user" ? entry.message.content
              : entry.type === "custom_message" ? entry.content : undefined;
            if (Array.isArray(content) && content.some(part => part.type === "image")) {
              throw new ControlError("IMAGE_RECOVERY_UNSUPPORTED", "Pi tree editing cannot restore image attachments losslessly");
            }
            const editorText = content === undefined || wasLeaf ? undefined : typeof content === "string" ? content
              : content.filter(part => part.type === "text").map(part => part.text).join("");
            const result = await ctx.navigateTree(intent.targetId,
              { summarize: intent.summarize, customInstructions: intent.customInstructions });
            if (!result.cancelled && !wasLeaf) {
              // An unsummarized navigation can move only the in-memory leaf.
              // A native Pi custom entry makes the selected branch the JSONL
              // tail, so reload and a fresh Pi process restore that leaf.
              pi.appendEntry("pi-agent-ide.tree-navigation.v1",
                { targetId: intent.targetId, summarized: intent.summarize });
            }
            reply(binding, { cancelled: result.cancelled,
              ...(!result.cancelled && editorText !== undefined ? { editorText } : {}) });
            break;
          }
          case "label":
            if (!ctx.sessionManager.getEntry(intent.targetId)) throw new ControlError("ENTRY_NOT_FOUND", "Pi tree entry does not exist");
            pi.setLabel(intent.targetId, intent.label || undefined);
            reply(binding);
            break;
          case "set_tools": {
            const known = new Set(pi.getAllTools().map(tool => tool.name));
            if (intent.names.some(name => !known.has(name))) throw new ControlError("UNKNOWN_TOOL", "Pi tool catalog changed");
            pi.setActiveTools(intent.names);
            reply(binding);
            break;
          }
          case "refresh_models": {
            const result = await ctx.modelRegistry.refresh({ allowNetwork: false });
            if (result.aborted || result.errors.size) {
              throw new ControlError("MODEL_REFRESH_FAILED", "Pi model directory could not be refreshed");
            }
            reply(binding, { modelsRefreshed: true });
            break;
          }
          case "resource_read":
            reply(binding, { resource: await readResource(pi, ctx, intent.path) });
            break;
          case "reload":
          case "package_install":
          case "package_remove":
          case "package_update":
          case "package_filter":
          case "resource_write":
          case "resource_create":
          case "resource_toggle": {
            if (intent.operation === "resource_write") await writeResource(pi, ctx, intent);
            else if (intent.operation === "resource_create") await createResource(ctx, intent);
            else if (intent.operation === "resource_toggle") await toggleResource(ctx, intent);
            else if (intent.operation !== "reload") await managePackage(ctx, intent);
            const operation: ReloadOperation = { request };
            state.reload = operation;
            await ctx.reload();
            // The old command frame continues after reload. Only a fresh binding
            // may acknowledge success; neither ctx nor pi is read from here.
            if (!operation.fresh) throw new ControlError("RELOAD_UNBOUND", "Pi reload did not bind a fresh context");
            reply(operation.fresh, { reloaded: true });
            state.reload = undefined;
            break;
          }
        }
      } catch (error) {
        const target = state.binding;
        const info: PiControlInfo = target?.info ?? { protocol: PI_CONTROL_PROTOCOL,
          bridgeVersion: PI_CONTROL_VERSION, piVersion: VERSION, generation: "", sessionId: "", mode: "rpc",
          operations: [...PI_CONTROL_OPERATIONS] };
        const packageFailure = typeof request?.operation === "string" && request.operation.startsWith("package_");
        const response: PiControlReply = { ...info, id: request?.id ?? "invalid",
          operation: request?.operation ?? "handshake", ok: false,
          error: { code: error instanceof ControlError ? error.code : packageFailure ? "PACKAGE_FAILED" : "CONTROL_FAILED",
            message: error instanceof ControlError ? error.message :
              packageFailure && error instanceof Error ?
                `Pi package operation failed: ${error.message.replace(/:\/\/[^/@\s]+:[^/@\s]+@/g, "://[redacted]@")}` :
                "Pi control failed; refresh its native state" } };
        if (target) target.emit(response);
        else failureTransport(PI_CONTROL_PREFIX + JSON.stringify(response), "info");
        if (state.reload?.request.id === request?.id) state.reload = undefined;
      } finally {
        if (ownsLock) state.busy = false;
      }
    },
  });
}
