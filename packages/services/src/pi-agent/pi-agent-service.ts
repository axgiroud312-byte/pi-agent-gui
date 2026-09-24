import { resolveWorkspaceKey } from "@zcode/shared";
import type { IZCodeAgentService, ZCodeAgentWorkspaceTarget } from "../zcode-agent/zcodeAgent.js";
import { PiNativeV4Service } from "./pi-native-v4-service.js";
import { PiSessionSupervisor } from "./pi-session-supervisor.js";

const idleEvent = () => ({ dispose() {} });
// The native Host observes these optional telemetry/CUA lanes at startup.
// Pi has no corresponding facts in #34, so emit none; never generalize this
// into a fake-success Event for future Agent features.
const inactiveObservations = new Set([
  "onDynamicLocalTtftFacts",
  "onDynamicConversationTelemetryFact",
  "onDynamicCuaPermissionObservation",
]);

/**
 * Fail closed at the native service boundary. Unimplemented ZCode Agent methods
 * must never acquire a legacy CLI or silently run the original model loop.
 */
export function createPiAgentService(
  piEntry: string,
  supervisor = new PiSessionSupervisor({ piEntry }),
): IZCodeAgentService {
  const bridge = new PiNativeV4Service(supervisor);
  const overrides: Record<string, unknown> = {
    prepareStorage: async () => {},
    getStorageStartupState: async () => null,
    onDynamicStorageStartupState: () => idleEvent,
    // Native workspace preparation needs an explicit projection even before a
    // Pi session exists. Pi has no plan mode or ZCode slash catalog to invent.
    readWorkspacePresentation: async (params: ZCodeAgentWorkspaceTarget) => ({
      workspace: { workspacePath: params.workspacePath,
        workspaceIdentity: params.workspaceIdentity, remoteSessionId: params.remoteSessionId,
        workspaceKey: resolveWorkspaceKey(params) },
      mode: "build" as const, slashCommands: [],
    }),
    initialize: async (params: ZCodeAgentWorkspaceTarget) => ({
      available: true,
      workspaceKey: resolveWorkspaceKey(params),
      protocolName: "Pi RPC",
      protocolVersion: 1,
      transportKind: "stdio" as const,
    }),
    syncAppRuntimePreferences: async () => {},
    getWorkspaceRuntimeIdentity: async (params: ZCodeAgentWorkspaceTarget) => bridge.getWorkspaceRuntimeIdentity(params),
    hasActiveCuaOperationTurn: () => false,
    disposeWorkspace: (params: ZCodeAgentWorkspaceTarget) => bridge.disposeWorkspace(params),
    disposeAll: () => { void bridge.dispose(); },
    disposeAllAndWait: () => bridge.dispose(),
  };
  const service = new Proxy(bridge, {
    get(target, property, receiver) {
      if (typeof property !== "string") return Reflect.get(target, property, receiver);
      if (property === "then") return undefined;
      if (Object.hasOwn(overrides, property)) return overrides[property];
      const value: unknown = Reflect.get(target, property, receiver);
      if (typeof value === "function") return value.bind(target);
      if (inactiveObservations.has(property)) return () => idleEvent;
      // ProxyChannel expects on* members to return an Event synchronously.
      // A rejected Promise here is misread as an Event and crashes later.
      if (/^on[A-Z]/u.test(property)) {
        return () => { throw new Error(`Pi Agent service does not implement ${property}`); };
      }
      return async () => { throw new Error(`Pi Agent service does not implement ${property}`); };
    },
  });
  return service as unknown as IZCodeAgentService;
}
