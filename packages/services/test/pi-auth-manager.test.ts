import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { Provider } from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { PiAuthManager } from "../src/pi-agent/pi-auth-manager.js";

async function awaitOperation(manager: PiAuthManager, id: string, waiting = false) {
  for (let count = 0; count < 150; count++) {
    const operation = (await manager.snapshot()).operations.find(item => item.id === id);
    if (operation && (waiting ? operation.prompts.length > 0 : !["running", "waiting"].includes(operation.outcome))) {
      return operation;
    }
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error("Pi auth operation did not reach its expected state");
}

test("fixed Pi ModelRuntime saves an API key without exposing it, resolves it, and logs out", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-auth-api-"));
  const agentDir = join(root, "agent");
  const secret = "fixture-api-secret-123";
  const ambientName = "PI_AUTH_TEST_AMBIENT";
  const previousAmbient = process.env[ambientName];
  process.env[ambientName] = "fixture-ambient-key";
  const runtime = await ModelRuntime.create({ authPath: join(agentDir, "auth.json"), modelsPath: null,
    refreshOnCreate: false });
  const base = runtime.getProvider("anthropic");
  assert.ok(base);
  const provider: Provider = { ...base, id: "auth-test-api", name: "Auth test API",
    auth: { apiKey: { name: "API key", login: async interaction => ({ type: "api_key",
      key: await interaction.prompt({ type: "secret", message: "Enter API key" }) }),
    check: async ({ ctx }) => await ctx.env(ambientName) ? { type: "api_key", source: ambientName } : undefined,
    resolve: async ({ credential, ctx }) => {
      const key = credential?.key ?? await ctx.env(ambientName);
      return key ? { auth: { apiKey: key } } : undefined;
    } } },
  };
  runtime.registerNativeProvider(provider);
  const manager = new PiAuthManager(agentDir, async () => runtime);
  try {
    const listed = await manager.snapshot();
    assert.equal(listed.providers.find(item => item.id === provider.id)?.methods[0]?.type, "api_key");
    const login = await manager.start(provider.id, "login", "api_key");
    const waiting = await awaitOperation(manager, login, true);
    assert.equal(waiting.prompts[0]?.type, "secret");
    manager.answer(login, waiting.prompts[0]!.id, secret);
    assert.equal((await awaitOperation(manager, login)).outcome, "saved");
    assert.equal((await manager.snapshot()).providers.find(item => item.id === provider.id)?.source, "stored");
    assert.ok((await readFile(join(agentDir, "auth.json"), "utf8")).includes(secret));
    assert.ok(!JSON.stringify(await manager.snapshot()).includes(secret));
    const resolve = await manager.start(provider.id, "resolve");
    assert.equal((await awaitOperation(manager, resolve)).outcome, "ready");
    const logout = await manager.start(provider.id, "logout");
    assert.equal((await awaitOperation(manager, logout)).outcome, "logged-out");
    assert.equal((await manager.snapshot()).providers.find(item => item.id === provider.id)?.source, "environment");
  } finally {
    manager.dispose();
    if (previousAmbient === undefined) delete process.env[ambientName];
    else process.env[ambientName] = previousAmbient;
    await rm(root, { recursive: true, force: true });
  }
});

test("fixed Pi OAuth callback, refresh and cancellation remain separate from saved credentials", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-auth-oauth-"));
  const agentDir = join(root, "agent");
  const runtime = await ModelRuntime.create({ authPath: join(agentDir, "auth.json"), modelsPath: null,
    refreshOnCreate: false });
  const base = runtime.getProvider("anthropic");
  assert.ok(base);
  let refreshed = 0;
  const provider: Provider = { ...base, id: "auth-test-oauth", name: "Auth test OAuth",
    auth: { oauth: { name: "OAuth fixture", login: async interaction => {
      interaction.notify({ type: "auth_url", url: "https://auth.example.test/authorize" });
      const code = await interaction.prompt({ type: "manual_code", message: "Paste callback code" });
      return { type: "oauth", access: `access-${code}`, refresh: `refresh-${code}`, expires: Date.now() - 1 };
    }, refresh: async credential => {
      refreshed++;
      return { ...credential, access: "refreshed-access", expires: Date.now() + 3_600_000 };
    }, toAuth: async credential => ({ apiKey: credential.access }) } },
  };
  runtime.registerNativeProvider(provider);
  const manager = new PiAuthManager(agentDir, async () => runtime);
  try {
    const cancelled = await manager.start(provider.id, "login", "oauth");
    assert.equal((await awaitOperation(manager, cancelled, true)).prompts[0]?.type, "manual_code");
    manager.cancel(cancelled);
    assert.equal((await awaitOperation(manager, cancelled)).outcome, "cancelled");
    assert.equal((await manager.snapshot()).providers.find(item => item.id === provider.id)?.configured, false);
    const login = await manager.start(provider.id, "login", "oauth");
    const waiting = await awaitOperation(manager, login, true);
    assert.equal(waiting.notices[0]?.type, "auth_url");
    manager.answer(login, waiting.prompts[0]!.id, "manual-code");
    assert.equal((await awaitOperation(manager, login)).outcome, "saved");
    const resolve = await manager.start(provider.id, "resolve");
    assert.equal((await awaitOperation(manager, resolve)).outcome, "ready");
    assert.equal(refreshed, 1);
    assert.ok(!JSON.stringify(await manager.snapshot()).includes("manual-code"));
  } finally { manager.dispose(); await rm(root, { recursive: true, force: true }); }
});

test("concurrent Pi auth starts claim one operation after lazy runtime creation", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-auth-concurrent-"));
  const agentDir = join(root, "agent");
  const runtime = await ModelRuntime.create({ authPath: join(agentDir, "auth.json"), modelsPath: null,
    refreshOnCreate: false });
  let release!: (value: ModelRuntime) => void;
  const gate = new Promise<ModelRuntime>(resolve => { release = resolve; });
  const manager = new PiAuthManager(agentDir, () => gate);
  try {
    const first = manager.start("anthropic", "resolve");
    const second = manager.start("anthropic", "resolve");
    release(runtime);
    const outcomes = await Promise.allSettled([first, second]);
    assert.equal(outcomes.filter(item => item.status === "fulfilled").length, 1,
      "only one auth operation can own the lazy runtime");
    const accepted = outcomes.find(item => item.status === "fulfilled");
    assert(accepted && accepted.status === "fulfilled");
    await awaitOperation(manager, accepted.value);
  } finally { manager.dispose(); await rm(root, { recursive: true, force: true }); }
});
