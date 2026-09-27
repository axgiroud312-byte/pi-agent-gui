import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { ProxyChannel } from "@zcode/rpc";
import { PiSessionSupervisor } from "../src/pi-agent/pi-session-supervisor.js";
import { PiNativeV4Service } from "../src/pi-agent/pi-native-v4-service.js";
import { PI_CONTROL_COMMAND } from "../src/pi-agent/pi-control-protocol.js";

test("auth view reads runtime extension providers from the same Pi RPC child without rerunning factories",
  { timeout: 30_000 }, async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-native-auth-runtime-provider-"));
    const profile = join(root, "profile");
    const extensions = join(profile, "extensions");
    const marker = join(root, "factory-runs.txt");
    await mkdir(extensions, { recursive: true });
    await writeFile(join(extensions, "fixture-provider.js"), `
import { appendFileSync } from "node:fs";
export default function (pi) {
  appendFileSync(${JSON.stringify(marker)}, "loaded\\n");
  pi.registerProvider("fixture-extension-oauth", {
    name: "Fixture extension OAuth", baseUrl: "http://127.0.0.1:1/v1",
    api: "openai-completions", models: [{ id: "fixture-model", name: "Fixture model",
      input: ["text"], contextWindow: 4096, maxTokens: 256 }],
    oauth: { name: "Fixture OAuth", async login() { throw new Error("No live account"); },
      async refreshToken(value) { return value; }, getApiKey(value) { return value.access; } }
  });
  pi.registerProvider("anthropic", { name: "Fixture Anthropic Override",
    baseUrl: "http://127.0.0.1:1/v1", apiKey: "fixture-override-only" });
}
`);
    const supervisor = new PiSessionSupervisor({
      piEntry: fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent/rpc-entry")),
      env: { PI_CODING_AGENT_DIR: profile, PI_TELEMETRY: "0" },
      rpcArgs: ["--offline", "--no-skills", "--no-prompt-templates", "--no-context-files",
        "--extension", fileURLToPath(new URL("../src/pi-agent/pi-control-bridge-extension.ts", import.meta.url))],
    });
    const service = new PiNativeV4Service(supervisor, join(root, "catalog"));
    const target = { workspacePath: root };
    try {
      const noSession = await service.readPiAuth(target);
      assert.equal(noSession.runtimeCatalogStatus, "no-session");
      await assert.rejects(readFile(marker, "utf8"), { code: "ENOENT" },
        "opening the auth view must not execute any extension factory");
      const created = await service.sendConversationCommandV4({ ...target, envelope: {
        commandId: randomUUID(), clientId: "auth-runtime-test", sessionId: null, issuedAt: Date.now(),
        type: "createSession", payload: { workspaceId: root },
      } });
      assert.equal(created.result?.type, "createSession");
      if (created.result?.type !== "createSession") throw new Error("Pi session creation failed");
      const sessionId = created.result.sessionId;
      const processId = supervisor.getSession(sessionId)?.pid;
      const factoryRuns = await readFile(marker, "utf8");
      const first = await service.readPiAuth(target);
      const extension = first.providers.find(item => item.id === "fixture-extension-oauth");
      assert.equal(extension?.runtimeOnly, true);
      assert.equal(extension?.configured, false);
      assert.equal(extension?.methods.find(item => item.type === "oauth")?.canLogin, false);
      assert.equal(first.runtimeCatalogStatus, "ready");
      const overridden = first.providers.find(item => item.id === "anthropic");
      assert.equal(overridden?.runtimeOnly, true,
        "a Pi extension override must hide the built-in auth method for the same provider ID");
      await assert.rejects(service.startPiAuth({ ...target, generation: first.generation,
        providerId: "anthropic", action: "login", method: "api_key" }),
      /not available in this GUI|不可在 GUI/iu);
      await assert.rejects(service.startPiAuth({ ...target, generation: first.generation,
        providerId: "fixture-extension-oauth", action: "login", method: "oauth" }),
      /not available in this GUI|不可在 GUI/iu);
      await service.readPiAuth(target);
      assert.equal(await readFile(marker, "utf8"), factoryRuns,
        "inspecting auth must not reload or execute the extension factory again");
      assert.equal(supervisor.getSession(sessionId)?.pid, processId);
    } finally { await service.dispose(); await rm(root, { recursive: true, force: true }); }
  });

test("native Pi service manages the exact RPC child's auth directory without a chat prompt", { timeout: 30_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-native-auth-service-"));
  const profile = join(root, "profile");
  const server = createServer(async (request, response) => {
    for await (const _ of request) { /* drain */ }
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.end(`data: ${JSON.stringify({ id: "auth-service", object: "chat.completion.chunk", created: 1,
      model: "test-local-model", choices: [{ index: 0,
        delta: { role: "assistant", content: "AUTH_TEST_REPLY" }, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`);
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address !== "string");
  await mkdir(profile);
  await writeFile(join(profile, "models.json"), JSON.stringify({ providers: {
    "test-local-provider": { baseUrl: `http://127.0.0.1:${address.port}/v1`, api: "openai-completions",
      apiKey: "local-test-only", models: [{ id: "test-local-model" }] },
  } }));
  await writeFile(join(profile, "settings.json"), JSON.stringify({
    defaultProvider: "test-local-provider", defaultModel: "test-local-model",
  }));
  const extension = fileURLToPath(new URL("../src/pi-agent/pi-control-bridge-extension.ts", import.meta.url));
  const supervisor = new PiSessionSupervisor({
    piEntry: fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent/rpc-entry")),
    env: { PI_CODING_AGENT_DIR: profile, PI_TELEMETRY: "0" },
    rpcArgs: ["--offline", "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-context-files",
      "--extension", extension],
  });
  const service = new PiNativeV4Service(supervisor, join(root, "catalog"));
  const channel = ProxyChannel.fromService<string>(service);
  const target = { workspacePath: root };
  try {
    const beforeSession = await service.readPiModelCatalog(target);
    assert(beforeSession.options?.some(model => model.value === "test-local-provider/test-local-model"),
      "a configured Pi model must be selectable before the first GUI session");
    const created = await service.sendConversationCommandV4({ workspacePath: root, envelope: {
      commandId: randomUUID(), clientId: "auth-test", sessionId: null, issuedAt: Date.now(),
      type: "createSession", payload: { workspaceId: root },
    } });
    assert.equal(created.result?.type, "createSession");
    if (created.result?.type !== "createSession") throw new Error("Pi session creation failed");
    const sessionId = created.result.sessionId;
    const pid = supervisor.getSession(sessionId)?.pid;
    const settled = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { supervisor.off("record", listener); reject(new Error("Pi did not settle")); }, 10_000);
      const listener = (id: string, event: Record<string, unknown>) => {
        if (id === sessionId && event.type === "agent_settled") {
          clearTimeout(timer); supervisor.off("record", listener); resolve();
        }
      };
      supervisor.on("record", listener);
    });
    const sent = await service.sendConversationCommandV4({ workspacePath: root, envelope: {
      commandId: randomUUID(), clientId: "auth-test", sessionId, issuedAt: Date.now(),
      type: "sendText", payload: { text: "Verify existing Pi session before auth" },
    } });
    assert.equal(sent.status, "accepted", sent.message);
    await settled;
    const availableBefore = await supervisor.command(sessionId, { type: "get_available_models" }) as
      { models: Array<{ provider: string; id: string }> };
    const commands = await supervisor.command(sessionId, { type: "get_commands" }) as
      { commands: Array<{ name: string; source: string }> };
    assert(commands.commands.some(command => command.name === PI_CONTROL_COMMAND && command.source === "extension"),
      "the live Pi RPC child must have registered the public bridge");
    const bridgeBefore = await supervisor.readControlBridge(sessionId);
    assert.equal(bridgeBefore.info.piVersion, "0.87.0");
    assert(bridgeBefore.info.operations.includes("refresh_models"));
    // The native task UI may prewarm a Pi child and then abandon that task
    // while another session remains selected. Its service bookmark survives
    // after the supervisor closes the child; auth must refresh only live Pi.
    const abandoned = await service.sendConversationCommandV4({ workspacePath: root, envelope: {
      commandId: randomUUID(), clientId: "auth-test", sessionId: null, issuedAt: Date.now(),
      type: "createSession", payload: { workspaceId: root },
    } });
    assert.equal(abandoned.result?.type, "createSession");
    if (abandoned.result?.type !== "createSession") throw new Error("Pi abandoned session creation failed");
    const abandonedId = abandoned.result.sessionId;
    assert.ok(supervisor.getSession(abandonedId));
    await supervisor.closeSession(abandonedId);
    assert.equal(supervisor.getSession(abandonedId), undefined);
    assert.ok((service as unknown as { sessions: Map<string, unknown> }).sessions.has(abandonedId),
      "the persisted service bookmark must still exist for regression coverage");
    const admissionKey = `${root}:${sessionId}`;
    const admissions = (service as unknown as { sessionAdmissions: Map<string, Promise<unknown>> }).sessionAdmissions;
    let finishAdmission!: () => void;
    const delayedAdmission = new Promise<void>(resolve => { finishAdmission = resolve; });
    admissions.set(admissionKey, delayedAdmission);
    void delayedAdmission.finally(() => admissions.delete(admissionKey));
    const before = await channel.call<Awaited<ReturnType<typeof service.readPiAuth>>>("host", "readPiAuth", [target]);
    assert.equal(before.agentDir, profile);
    assert.equal(before.catalogError, false);
    assert.equal(before.providers.find(provider => provider.id === "test-local-provider")?.configured, true,
      "the auth center must include the custom provider from this Pi profile");
    assert.equal(before.providers.find(provider => provider.id === "anthropic")?.configured, false);
    const operationId = await service.startPiAuth({ ...target, generation: before.generation,
      providerId: "anthropic", action: "login", method: "api_key" });
    let promptId: string | undefined;
    for (let count = 0; count < 100; count++) {
      promptId = (await service.readPiAuth(target)).operations.find(op => op.id === operationId)?.prompts[0]?.id;
      if (promptId) break;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.ok(promptId);
    const secret = "fixture-only-anthropic-key";
    await service.answerPiAuth({ ...target, generation: before.generation, operationId, promptId, value: secret });
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal((await service.readPiAuth(target)).operations.find(op => op.id === operationId)?.outcome,
      "running", "the auth result must wait for the earlier accepted GUI command");
    finishAdmission();
    let outcome: string | undefined;
    for (let count = 0; count < 100; count++) {
      outcome = (await service.readPiAuth(target)).operations.find(op => op.id === operationId)?.outcome;
      if (outcome !== "waiting" && outcome !== "running") break;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.equal(outcome, "saved");
    assert.ok((await readFile(join(profile, "auth.json"), "utf8")).includes(secret));
    assert.ok(!JSON.stringify(await service.readPiAuth(target)).includes(secret));
    assert.equal(supervisor.getSession(sessionId)?.pid, pid);
    const availableAfter = await supervisor.command(sessionId, { type: "get_available_models" }) as
      { models: Array<{ provider: string; id: string }> };
    assert(availableAfter.models.some(model => model.provider === "anthropic"),
      "the same Pi RPC session must see the newly saved provider credential");
    assert(availableAfter.models.length >= availableBefore.models.length);
    const after = await service.readPiAuth(target);
    assert.equal(after.providers.find(provider => provider.id === "anthropic")?.source, "stored");
    const logoutId = await service.startPiAuth({ ...target, generation: after.generation,
      providerId: "anthropic", action: "logout" });
    let logoutOutcome: string | undefined;
    for (let count = 0; count < 100; count++) {
      logoutOutcome = (await service.readPiAuth(target)).operations.find(op => op.id === logoutId)?.outcome;
      if (logoutOutcome !== "running" && logoutOutcome !== "waiting") break;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.equal(logoutOutcome, "logged-out");
    const availableLoggedOut = await supervisor.command(sessionId, { type: "get_available_models" }) as
      { models: Array<{ provider: string; id: string }> };
    assert.equal(availableLoggedOut.models.some(model => model.provider === "anthropic"),
      availableBefore.models.some(model => model.provider === "anthropic"),
      "same-session model availability must return to its previous credential source");
    assert.equal(supervisor.getSession(sessionId)?.pid, pid);
  } finally {
    await service.dispose();
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
});

test("live Pi child without the public bridge fails closed after credential commit", { timeout: 20_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-native-auth-missing-bridge-"));
  const profile = join(root, "profile");
  await mkdir(profile);
  await writeFile(join(profile, "models.json"), JSON.stringify({ providers: {
    "local-test-provider": { baseUrl: "http://127.0.0.1:1/v1", api: "openai-completions",
      apiKey: "local-test-only", models: [{ id: "local-test-model" }] },
  } }));
  const supervisor = new PiSessionSupervisor({
    piEntry: fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent/rpc-entry")),
    env: { PI_CODING_AGENT_DIR: profile, PI_TELEMETRY: "0" },
    rpcArgs: ["--offline", "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-context-files"],
  });
  const service = new PiNativeV4Service(supervisor, join(root, "catalog"));
  const target = { workspacePath: root };
  try {
    const created = await service.sendConversationCommandV4({ workspacePath: root, envelope: {
      commandId: randomUUID(), clientId: "auth-test", sessionId: null, issuedAt: Date.now(),
      type: "createSession", payload: { workspaceId: root },
    } });
    assert.equal(created.result?.type, "createSession");
    if (created.result?.type !== "createSession") throw new Error("Pi session creation failed");
    const sessionId = created.result.sessionId;
    const pid = supervisor.getSession(sessionId)?.pid;
    assert.ok(pid, "the no-bridge session must still be an active Pi child");
    const commands = await supervisor.command(sessionId, { type: "get_commands" }) as
      { commands: Array<{ name: string }> };
    assert(!commands.commands.some(command => command.name === PI_CONTROL_COMMAND));
    const before = await service.readPiAuth(target);
    const operationId = await service.startPiAuth({ ...target, generation: before.generation,
      providerId: "anthropic", action: "login", method: "api_key" });
    let promptId: string | undefined;
    for (let count = 0; count < 100; count++) {
      promptId = (await service.readPiAuth(target)).operations.find(op => op.id === operationId)?.prompts[0]?.id;
      if (promptId) break;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.ok(promptId);
    const secret = "fixture-only-missing-bridge-key";
    await service.answerPiAuth({ ...target, generation: before.generation, operationId, promptId, value: secret });
    let outcome: string | undefined;
    for (let count = 0; count < 100; count++) {
      outcome = (await service.readPiAuth(target)).operations.find(op => op.id === operationId)?.outcome;
      if (outcome !== "waiting" && outcome !== "running") break;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.equal(outcome, "committed-sync-failed");
    assert.ok((await readFile(join(profile, "auth.json"), "utf8")).includes(secret));
    assert.ok(!JSON.stringify(await service.readPiAuth(target)).includes(secret));
    assert.equal(supervisor.getSession(sessionId)?.pid, pid,
      "missing bridge must not silently close or replace the active Pi process");
  } finally {
    await service.dispose();
    await rm(root, { recursive: true, force: true });
  }
});
