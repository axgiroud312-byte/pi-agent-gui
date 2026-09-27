import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { ProxyChannel } from "@zcode/rpc";
import { PiSessionSupervisor } from "../src/pi-agent/pi-session-supervisor.js";
import { PiNativeV4Service } from "../src/pi-agent/pi-native-v4-service.js";

test("native Pi service manages the exact RPC child's auth directory without a chat prompt", { timeout: 30_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-native-auth-service-"));
  const profile = join(root, "profile");
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
    const created = await service.sendConversationCommandV4({ workspacePath: root, envelope: {
      commandId: randomUUID(), clientId: "auth-test", sessionId: null, issuedAt: Date.now(),
      type: "createSession", payload: { workspaceId: root },
    } });
    assert.equal(created.result?.type, "createSession");
    if (created.result?.type !== "createSession") throw new Error("Pi session creation failed");
    const sessionId = created.result.sessionId;
    const pid = supervisor.getSession(sessionId)?.pid;
    const availableBefore = await supervisor.command(sessionId, { type: "get_available_models" }) as
      { models: Array<{ provider: string; id: string }> };
    const before = await channel.call<Awaited<ReturnType<typeof service.readPiAuth>>>("host", "readPiAuth", [target]);
    assert.equal(before.agentDir, profile);
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
    service.answerPiAuth({ ...target, generation: before.generation, operationId, promptId, value: secret });
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
  } finally { await service.dispose(); await rm(root, { recursive: true, force: true }); }
});
