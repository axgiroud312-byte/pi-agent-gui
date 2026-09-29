import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { PiNativeV4Service } from "../src/pi-agent/pi-native-v4-service.js";
import { PiSessionSupervisor } from "../src/pi-agent/pi-session-supervisor.js";

test("model save reports committed-but-busy then refreshes the same Pi child when idle", { timeout: 30_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-model-config-service-"));
  const profile = join(root, "profile");
  let observeRequest!: () => void;
  const requestObserved = new Promise<void>(resolve => { observeRequest = resolve; });
  const server = createServer(async (request, response) => {
    for await (const _ of request) { /* drain */ }
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.write(`data: ${JSON.stringify({ id: "held", object: "chat.completion.chunk", created: 1,
      choices: [{ index: 0, delta: { role: "assistant", content: "held" }, finish_reason: null }] })}\n\n`);
    observeRequest();
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address !== "string");
  await mkdir(profile);
  const baseUrl = `http://127.0.0.1:${address.port}/v1`;
  await writeFile(join(profile, "models.json"), JSON.stringify({ providers: {
    fixture: { baseUrl, api: "openai-completions", apiKey: "fixture", models: [{ id: "first" }] },
  } }));
  await writeFile(join(profile, "settings.json"), JSON.stringify({ defaultProvider: "fixture", defaultModel: "first" }));
  const supervisor = new PiSessionSupervisor({
    piEntry: fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent/rpc-entry")),
    env: { PI_CODING_AGENT_DIR: profile },
    rpcArgs: ["--offline", "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-context-files",
      "--extension", fileURLToPath(new URL("../src/pi-agent/pi-control-bridge-extension.ts", import.meta.url))],
  });
  const service = new PiNativeV4Service(supervisor, join(root, "catalog"));
  const target = { workspacePath: root };
  try {
    const created = await service.sendConversationCommandV4({ ...target, envelope: {
      commandId: randomUUID(), clientId: "model-test", sessionId: null, issuedAt: Date.now(),
      type: "createSession", payload: { workspaceId: root },
    } });
    assert.equal(created.result?.type, "createSession");
    if (created.result?.type !== "createSession") throw new Error("No session");
    const sessionId = created.result.sessionId;
    const pid = supervisor.getSession(sessionId)?.pid;
    const auth = await service.readPiAuth(target);
    await service.sendConversationCommandV4({ ...target, envelope: {
      commandId: randomUUID(), clientId: "model-test", sessionId, issuedAt: Date.now(),
      type: "sendText", payload: { text: "hold this turn" },
    } });
    const view = await service.readPiModelConfig(target);
    await requestObserved;
    const result = await service.savePiModelConfig({ ...target, expectedRevision: view.revision,
      providerId: "fixture", config: { baseUrl, api: "openai-completions", modelIds: ["first", "second"] } });
    assert.equal(result.synchronized, false);
    assert((await readFile(join(profile, "models.json"), "utf8")).includes('"second"'));
    assert.equal(await supervisor.stop(sessionId, supervisor.getSession(sessionId)?.foregroundExecutionId), "stopped");
    await service.refreshPiAuth({ ...target, generation: auth.generation });
    const catalog = await service.readPiModelCatalog({ ...target, sessionId });
    assert(catalog.options?.some(model => model.value === "fixture/second"));
    assert.equal(supervisor.getSession(sessionId)?.pid, pid);
  } finally {
    await service.dispose();
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
});
