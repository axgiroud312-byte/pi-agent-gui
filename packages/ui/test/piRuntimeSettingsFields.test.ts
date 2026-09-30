import assert from "node:assert/strict";
import { test } from "node:test";
import { PI_RUNTIME_SETTINGS_FIELDS, updatePiRuntimeSetting } from "../src/settings/piRuntimeSettingsFields.js";
import { piSettingsRoute } from "../src/settings/piSettingsRouting.js";

test("Pi runtime fields edit the actual settings document without losing unknown or nested options", () => {
  const before = { futureKey: { keep: true }, retry: { provider: { timeoutMs: 1234 }, maxRetries: 7 } };
  const edited = JSON.parse(updatePiRuntimeSetting(JSON.stringify(before), "retry.enabled", false));
  assert.deepEqual(edited, { ...before, retry: { ...before.retry, enabled: false } });
  const reset = JSON.parse(updatePiRuntimeSetting(JSON.stringify(edited), "retry.enabled", undefined));
  assert.deepEqual(reset, before);
  assert.throws(() => updatePiRuntimeSetting('{"retry":false}', "retry.enabled", true), /retry/u);
  assert.throws(() => updatePiRuntimeSetting("[]", "httpProxy", "http://localhost:7897"), /JSON/u);
  assert.throws(() => updatePiRuntimeSetting("{}", "notAPiSetting", true), /Pi/u);
  for (const invalid of [-1, 1.5, Infinity, NaN, "1234"] as const) {
    assert.throws(() => updatePiRuntimeSetting("{}", "retry.maxRetries", invalid), /Pi/u);
  }
  assert.throws(() => updatePiRuntimeSetting("{}", "retry.enabled", "false"), /Pi/u);
  assert.throws(() => updatePiRuntimeSetting("{}", "transport", "unknown-transport"), /Pi/u);
});

test("network and runtime forms use pinned Pi settings keys, with global-only fields identified", () => {
  for (const key of ["httpProxy", "shellPath", "sessionDir", "defaultThinkingLevel", "compaction.enabled",
    "retry.enabled", "transport", "images.blockImages", "enableSkillCommands", "enableInstallTelemetry"]) {
    assert(PI_RUNTIME_SETTINGS_FIELDS.some(field => field.path === key), key);
  }
  for (const key of ["httpProxy", "cacheWarming", "defaultProjectTrust"]) {
    assert.equal(PI_RUNTIME_SETTINGS_FIELDS.find(field => field.path === key)?.globalOnly, true, key);
  }
  assert(!PI_RUNTIME_SETTINGS_FIELDS.some(field => field.path === "memoryEnabled"));
});

test("desktop resource configuration and unsupported legacy features cannot fall through to ZCode settings", () => {
  for (const section of ["plugin", "skill", "commands", "memory"] as const) assert.equal(piSettingsRoute(section), "resources");
  for (const section of ["mcp", "hooks", "subagents", "automations", "migration"] as const) assert.equal(piSettingsRoute(section), "unsupported");
  for (const section of ["general", "appearance", "modelProvider", "shortcuts", "browser"] as const) assert.equal(piSettingsRoute(section), null);
});
