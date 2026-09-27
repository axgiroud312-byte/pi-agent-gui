import { randomUUID } from "node:crypto";
import { VERSION, type ExtensionAPI, type ExtensionCommandContext, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  PI_CONTROL_COMMAND, PI_CONTROL_DESCRIPTION, PI_CONTROL_OPERATIONS, PI_CONTROL_PREFIX,
  PI_CONTROL_PROTOCOL, PI_CONTROL_VERSION, piControlIntent, piControlObject,
  type PiControlInfo, type PiControlReply, type PiControlRequest,
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
  });
  pi.on("session_shutdown", () => {
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
          reply(binding, { tools: pi.getAllTools(), activeTools: pi.getActiveTools(), commands: pi.getCommands(),
            promptOptions: ctx.getSystemPromptOptions(), systemPrompt: ctx.getSystemPrompt(),
            projectTrusted: ctx.isProjectTrusted() });
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
          case "reload": {
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
        const response: PiControlReply = { ...info, id: request?.id ?? "invalid",
          operation: request?.operation ?? "handshake", ok: false,
          error: { code: error instanceof ControlError ? error.code : "CONTROL_FAILED",
            message: error instanceof ControlError ? error.message : "Pi control failed; refresh its native state" } };
        if (target) target.emit(response);
        else failureTransport(PI_CONTROL_PREFIX + JSON.stringify(response), "info");
        if (state.reload?.request.id === request?.id) state.reload = undefined;
      } finally {
        if (ownsLock) state.busy = false;
      }
    },
  });
}
