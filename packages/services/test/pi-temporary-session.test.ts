import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdir, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { on, once } from "node:events";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { PiQueueMediaStore } from "../src/pi-agent/pi-queue-media-store.js";
import { PiSessionSupervisor } from "../src/pi-agent/pi-session-supervisor.js";
import { PiNativeV4Service } from "../src/pi-agent/pi-native-v4-service.js";

test("temporary GUI session uses Pi --no-session and never creates a resumable bookmark", { timeout: 30_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-temporary-session-"));
  const profile = join(root, "profile");
  const history = join(root, "history");
  const catalog = join(root, "catalog");
  let providerRequests = 0;
  const provider = createServer(async (request, response) => {
    for await (const _ of request) { /* drain */ }
    providerRequests++;
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.write(`data: ${JSON.stringify({ id: "temporary-model", object: "chat.completion.chunk", created: 1,
      model: "temporary-model", choices: [{ index: 0, delta: { role: "assistant", content: "TEMP_OK" },
        finish_reason: null }] })}\n\n`);
    response.write(`data: ${JSON.stringify({ id: "temporary-model", object: "chat.completion.chunk", created: 1,
      model: "temporary-model", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\n`);
    response.end("data: [DONE]\n\n");
  });
  const makeService = () => {
    const supervisor = new PiSessionSupervisor({
      piEntry: fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent/rpc-entry")),
      env: { PI_CODING_AGENT_DIR: profile, PI_CODING_AGENT_SESSION_DIR: history, PI_TELEMETRY: "0" },
      rpcArgs: ["--offline", "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-context-files"],
    });
    return { supervisor, service: new PiNativeV4Service(supervisor, catalog) };
  };
  const first = makeService();
  try {
    await new Promise<void>(resolve => provider.listen(0, "127.0.0.1", resolve));
    const address = provider.address();
    assert.ok(address && typeof address !== "string");
    await mkdir(profile);
    await writeFile(join(profile, "models.json"), JSON.stringify({ providers: {
      "temporary-provider": { baseUrl: `http://127.0.0.1:${address.port}/v1`, api: "openai-completions",
        apiKey: "local-test-only", models: [{ id: "temporary-model", reasoning: false }] },
    } }));
    await writeFile(join(profile, "settings.json"), JSON.stringify({
      defaultProvider: "temporary-provider", defaultModel: "temporary-model",
    }));
    const createCommandId = randomUUID();
    const create = await first.service.sendConversationCommandV4({ workspacePath: root, envelope: {
      commandId: createCommandId, clientId: "temporary-test", sessionId: null, type: "createSession",
      issuedAt: Date.now(), payload: { workspaceId: root, storageMode: "temporary" },
    } });
    assert.equal(create.status, "accepted", create.message);
    assert.equal(create.result?.type, "createSession");
    if (create.result?.type !== "createSession") throw new Error("Missing Pi temporary session ID");
    const sessionId = create.result.sessionId;
    assert.equal(first.supervisor.getSession(sessionId)?.temporary, true);
    assert.equal("sessionFile" in await first.supervisor.getState(sessionId), false);
    assert.deepEqual(await readdir(history).catch(() => []), []);
    const settled = (async () => {
      for await (const [id, record] of on(first.supervisor, "record", { signal: AbortSignal.timeout(20_000) })) {
        if (id === sessionId && record.type === "agent_settled") return;
      }
    })();
    const sent = await first.service.sendConversationCommandV4({ workspacePath: root, envelope: {
      commandId: randomUUID(), clientId: "temporary-test", sessionId, type: "sendText",
      issuedAt: Date.now(), payload: { text: "temporary turn", mode: "build", planEnabled: false,
        modelSelection: { providerId: "temporary-provider", modelId: "temporary-model" } },
    } });
    assert.equal(sent.status, "accepted", sent.message);
    await settled;
    await (first.service as unknown as { reconciliations: Map<string, Promise<void>> })
      .reconciliations.get(sessionId);
    assert.equal(providerRequests, 1);
    assert.ok((await first.service.conversationRowsRangeV4({ workspacePath: root, sessionId, limit: 100 }))
      .rows.some(row => row.kind === "assistantText" && row.text.includes("TEMP_OK")));
    assert.deepEqual(await readdir(history).catch(() => []), []);
    const conversationFrames: unknown[] = [];
    const indexFrames: unknown[] = [];
    const conversationListener = first.service.onDynamicConversationFrame({ workspacePath: root })(
      frame => conversationFrames.push(frame));
    const indexListener = first.service.onDynamicSessionsIndexFrame({ workspacePath: root })(
      frame => indexFrames.push(frame));
    await first.service.subscribeConversationV4({ workspacePath: root, sessionId });
    await first.service.subscribeSessionsIndexV4({ workspacePath: root });
    await new Promise(resolve => setImmediate(resolve));
    assert.ok(conversationFrames.some(frame => JSON.stringify(frame).includes('"temporary":true')));
    assert.ok(indexFrames.some(frame => JSON.stringify(frame).includes('"temporary":true')));
    const queueMedia = (first.service as unknown as { queueMedia: PiQueueMediaStore }).queueMedia;
    const copied = await queueMedia.materialize(sessionId, { id: randomUUID(), text: "queued preview",
      images: [{ type: "image", mimeType: "image/png", data: "AA==" }] });
    assert.equal(copied.length, 1);
    const ownedPiPid = first.supervisor.getSession(sessionId)?.pid;
    assert.ok(ownedPiPid, "only this test-owned Pi process may be terminated");
    const exited = once(first.supervisor, "exit", { signal: AbortSignal.timeout(10_000) });
    process.kill(ownedPiPid);
    await exited;
    await new Promise(resolve => setImmediate(resolve));
    assert.ok(conversationFrames.some(frame => JSON.stringify(frame).includes("pi.sessionUnavailable")),
      "an open pane must learn that its in-memory Pi history exited");
    assert.ok(indexFrames.some(frame => JSON.stringify(frame).includes('"op":"session.removed"')));
    assert.equal((first.service as unknown as { sessions: Map<string, unknown> }).sessions.has(sessionId), false);
    conversationListener.dispose();
    indexListener.dispose();
    await first.service.dispose();
    assert.deepEqual(await readdir(join(catalog, "queue-media")).catch(() => []), [],
      "temporary queue preview copies must leave no durable cache");

    const restarted = makeService();
    try {
      const index = await restarted.service.subscribeSessionsIndexV4({ workspacePath: root });
      assert.equal(index.ack.mode, "snapshot");
      assert.deepEqual(await readdir(history).catch(() => []), []);
      assert.equal((restarted.service as unknown as { bookmarks: Map<string, unknown> }).bookmarks.has(sessionId), false);
      const duplicate = await restarted.service.sendConversationCommandV4({ workspacePath: root, envelope: {
        commandId: createCommandId, clientId: "temporary-test", sessionId: null, type: "createSession",
        issuedAt: Date.now(), payload: { workspaceId: root, storageMode: "temporary" },
      } });
      assert.equal(duplicate.status, "failed");
      assert.equal(duplicate.reasonCode, "pi.temporarySessionExpired");
    } finally {
      await restarted.service.dispose();
    }
  } finally {
    await first.service.dispose();
    provider.closeAllConnections();
    await new Promise<void>(resolve => provider.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
});
