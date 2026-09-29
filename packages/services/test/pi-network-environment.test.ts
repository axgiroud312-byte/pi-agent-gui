import assert from "node:assert/strict";
import { test } from "node:test";
import { buildZCodeToolEnvPassthroughEnv, sanitizeZCodeRuntimeEnv } from "@zcode/shared";
import { PiSessionSupervisor } from "../src/pi-agent/pi-session-supervisor.js";

test("Pi recovers the terminal network environment captured by the desktop host", async () => {
  const shell = { HTTPS_PROXY: "http://127.0.0.1:17987", HTTP_PROXY: "http://127.0.0.1:17987",
    NO_PROXY: "localhost,127.0.0.1", NODE_EXTRA_CA_CERTS: "C:/certs/company.pem" };
  const host = { ...sanitizeZCodeRuntimeEnv(shell), ...buildZCodeToolEnvPassthroughEnv(shell) };
  assert.equal(host.HTTPS_PROXY, undefined, "the host still sanitizes its own network environment");
  const supervisor = new PiSessionSupervisor({ piEntry: "unused",
    env: { ...Object.fromEntries(Object.keys(shell).map(key => [key, undefined])), ...host } });
  try {
    const { env } = await supervisor.settingsEnvironment();
    for (const [key, value] of Object.entries(shell)) assert.equal(env[key], value, key);
  } finally { await supervisor.dispose(); }
});

test("explicit Pi network values win over captured shell values without restoring unrelated variables", async () => {
  const supervisor = new PiSessionSupervisor({ piEntry: "unused", env: {
    ...buildZCodeToolEnvPassthroughEnv({ HTTPS_PROXY: "http://old-proxy:8080", NODE_ENV: "development",
      npm_config_proxy: "http://npm-only:8080" }),
    HTTPS_PROXY: "http://selected-proxy:8080", npm_config_proxy: undefined,
  } });
  try {
    const { env } = await supervisor.settingsEnvironment();
    assert.equal(env.HTTPS_PROXY, "http://selected-proxy:8080");
    assert.equal(env.npm_config_proxy, undefined);
  } finally { await supervisor.dispose(); }
});
