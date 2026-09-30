import assert from "node:assert/strict";
import { test } from "node:test";
import { SettingsManager } from "@earendil-works/pi-coding-agent";
import { PI_RUNTIME_SETTINGS_FIELDS, updatePiRuntimeSetting } from "../src/settings/piRuntimeSettingsFields.js";

const readers: Record<string, (settings: SettingsManager) => unknown> = {
  defaultProvider: settings => settings.getDefaultProvider(),
  defaultModel: settings => settings.getDefaultModel(),
  defaultThinkingLevel: settings => settings.getDefaultThinkingLevel(),
  httpProxy: settings => settings.getGlobalSettings().httpProxy,
  transport: settings => settings.getTransport(),
  httpIdleTimeoutMs: settings => settings.getHttpIdleTimeoutMs(),
  websocketConnectTimeoutMs: settings => settings.getWebSocketConnectTimeoutMs(),
  "compaction.enabled": settings => settings.getCompactionEnabled(),
  "compaction.reserveTokens": settings => settings.getCompactionReserveTokens(),
  "compaction.keepRecentTokens": settings => settings.getCompactionKeepRecentTokens(),
  "retry.enabled": settings => settings.getRetryEnabled(),
  "retry.maxRetries": settings => settings.getRetrySettings().maxRetries,
  "retry.baseDelayMs": settings => settings.getRetrySettings().baseDelayMs,
  "retry.maxAgentDelayMs": settings => settings.getRetrySettings().maxAgentDelayMs,
  "retry.provider.timeoutMs": settings => settings.getProviderRetrySettings().timeoutMs,
  "retry.provider.maxRetries": settings => settings.getProviderRetrySettings().maxRetries,
  steeringMode: settings => settings.getSteeringMode(),
  followUpMode: settings => settings.getFollowUpMode(),
  cacheWarming: settings => settings.getCacheWarmingMode(),
  "images.autoResize": settings => settings.getImageAutoResize(),
  "images.blockImages": settings => settings.getBlockImages(),
  shellPath: settings => settings.getShellPath(),
  shellCommandPrefix: settings => settings.getShellCommandPrefix(),
  sessionDir: settings => settings.getGlobalSettings().sessionDir,
  enableSkillCommands: settings => settings.getEnableSkillCommands(),
  defaultProjectTrust: settings => settings.getDefaultProjectTrust(),
  enableInstallTelemetry: settings => settings.getEnableInstallTelemetry(),
  enableAnalytics: settings => settings.getEnableAnalytics(),
};

for (const field of PI_RUNTIME_SETTINGS_FIELDS) {
  test(`form ${field.path} is consumed by pinned Pi's public settings reader`, () => {
    const value = field.kind === "boolean" ? false : field.kind === "number" ? 1234 :
      field.kind === "enum" ? field.options?.at(-1) : "fixture-value";
    assert.notEqual(value, undefined);
    const edited = JSON.parse(updatePiRuntimeSetting('{"futureKey":{"keep":true}}', field.path, value));
    const pi = SettingsManager.inMemory(edited);
    const reader = readers[field.path];
    assert(reader, field.path);
    assert.equal(reader(pi), value, field.path);
    assert.deepEqual(edited.futureKey, { keep: true });
  });
}
