import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { on } from "node:events";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { createPiAgentService } from "../src/pi-agent/pi-agent-service.js";
import { setDataBaseDir } from "../src/paths.js";
import { PiSessionSupervisor } from "../src/pi-agent/pi-session-supervisor.js";
import { readPiPromptImages } from "../src/pi-agent/pi-prompt-images.js";

test("native Pi image paste uses the real v4 chunk upload and rejects tampering", { timeout: 30_000 }, async () => {
  const workspacePath = await mkdtemp(join(tmpdir(), "pi-native-image-upload-"));
  const otherWorkspace = await mkdtemp(join(tmpdir(), "pi-native-image-other-"));
  const piEntry = fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent/rpc-entry"));
  const requests: unknown[] = [];
  let releaseSlowResponse: (() => void) | undefined;
  let wasHeld = false;
  let slowResponseArrived: (() => void) | undefined;
  const slowRequest = new Promise<void>(resolve => { slowResponseArrived = resolve; });
  const model = createServer(async (request, response) => {
    let data = "";
    for await (const part of request) data += part.toString();
    requests.push(JSON.parse(data));
    if (!wasHeld && data.includes("HOLD_FOR_QUEUE")) {
      wasHeld = true;
      slowResponseArrived?.();
      await new Promise<void>(resolve => { releaseSlowResponse = resolve; });
    }
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.end(`data: ${JSON.stringify({ id: "image-test", object: "chat.completion.chunk", created: 1,
      model: "pi-native-test", choices: [{ index: 0, delta: { role: "assistant", content: "IMAGE_ACCEPTED" }, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`);
  });
  await new Promise<void>(resolve => model.listen(0, "127.0.0.1", resolve));
  const address = model.address();
  assert.ok(address && typeof address !== "string");
  const profile = join(workspacePath, "profile");
  await mkdir(profile);
  await writeFile(join(profile, "models.json"), JSON.stringify({ providers: { "image-test": {
    baseUrl: `http://127.0.0.1:${address.port}/v1`, api: "openai-completions", apiKey: "local-only",
    models: [{ id: "pi-native-test", reasoning: false, input: ["text", "image"] }],
  } } }));
  await writeFile(join(profile, "settings.json"), JSON.stringify({ defaultProvider: "image-test", defaultModel: "pi-native-test" }));
  const supervisor = new PiSessionSupervisor({ piEntry, env: {
    PI_CODING_AGENT_DIR: join(workspacePath, "profile"), PI_TELEMETRY: "0",
  }, rpcArgs: ["--offline", "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-context-files"] });
  setDataBaseDir(workspacePath);
  const service = createPiAgentService(piEntry, supervisor);
  try {
    const create = await service.sendConversationCommandV4({ workspacePath, envelope: {
      commandId: randomUUID(), clientId: "image-upload-test", sessionId: null,
      issuedAt: Date.now(), type: "createSession", payload: { workspaceId: workspacePath },
    } });
    assert.equal(create.result?.type, "createSession");
    if (create.result?.type !== "createSession") return;
    const sessionId = create.result.sessionId;
    const bytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC", "base64");
    const common = { workspacePath, sessionId, uploadId: `upload-${randomUUID()}` };
    const begin = await service.attachmentBeginV4({ ...common, fileName: "粘贴.png", mime: "image/png",
      totalBytes: bytes.length, totalChunks: 1,
      checksum: `sha256:${createHash("sha256").update(bytes).digest("hex")}` });
    assert.equal(begin.state, "staging");
    await assert.rejects(service.attachmentChunkV4({ ...common, workspacePath: otherWorkspace,
      chunkIndex: 0, dataBase64: bytes.toString("base64") }), /workspace|owned|session/iu);
    const chunk = await service.attachmentChunkV4({ ...common, chunkIndex: 0, dataBase64: bytes.toString("base64") });
    assert.equal(chunk.nextChunkIndex, 1);
    const result = await service.attachmentCommitV4(common);
    assert.deepEqual(await readPiPromptImages([{ ref: result.ref, fileName: "粘贴.png", mime: "image/png", bytes: bytes.length }]),
      [{ type: "image", data: bytes.toString("base64"), mimeType: "image/png" }]);
    const settled = (async () => {
      for await (const [, record] of on(supervisor, "record", { signal: AbortSignal.timeout(15_000) })) {
        if (record.type === "agent_settled") return;
      }
    })();
    const send = await service.sendConversationCommandV4({ workspacePath, envelope: {
      commandId: randomUUID(), clientId: "image-upload-test", sessionId, issuedAt: Date.now(),
      type: "sendText", payload: { text: "Describe image", attachments: [
        { ref: result.ref, fileName: "粘贴.png", mime: "image/png", bytes: bytes.length },
      ] },
    } });
    assert.equal(send.status, "accepted", send.message);
    await settled;
    assert.ok((await supervisor.getHistoryMessages(sessionId)).some(message =>
      typeof message === "object" && message !== null && (message as { role?: string }).role === "user"));
    const sent = JSON.stringify(requests);
    assert.ok(sent.includes("data:image/png;base64,"), "real Pi must send an image block to the model");
    assert.ok(!sent.includes("Image omitted"), "a valid PNG must not silently disappear at the model boundary");
    const rows = await service.conversationRowsRangeV4({ workspacePath, sessionId, limit: 100 });
    const imageRow = rows.rows.find(row => row.kind === "userInput" && row.text === "Describe image");
    assert.ok(imageRow?.kind === "userInput" && imageRow.attachments?.length === 1,
      "sent image must remain visible in the native history row");
    const ref = imageRow.attachments[0]!.ref;
    assert.ok(!ref.includes(bytes.toString("base64")), "history projection must not expose image bytes");
    const preview = await service.attachmentReadV4({ workspacePath, sessionId, ref, offset: 0, limit: 1024 });
    assert.deepEqual(Buffer.from(preview.dataBase64, "base64"), bytes);
    await assert.rejects(service.attachmentReadV4({ workspacePath: otherWorkspace, sessionId, ref, offset: 0, limit: 1024 }),
      /workspace|owned|session/iu);
    const bad = { ...common, uploadId: `upload-${randomUUID()}` };
    await service.attachmentBeginV4({ ...bad, fileName: "bad.png", mime: "image/png", totalBytes: bytes.length,
      totalChunks: 1, checksum: `sha256:${"0".repeat(64)}` });
    await service.attachmentChunkV4({ ...bad, chunkIndex: 0, dataBase64: bytes.toString("base64") });
    await assert.rejects(service.attachmentCommitV4(bad), /checksum/iu);
    await service.attachmentAbortV4(bad);
    const slowSettled = (async () => {
      for await (const [, record] of on(supervisor, "record", { signal: AbortSignal.timeout(15_000) })) {
        if (record.type === "agent_settled") return;
      }
    })();
    const slowSend = await service.sendConversationCommandV4({ workspacePath, envelope: {
      commandId: randomUUID(), clientId: "image-upload-test", sessionId, issuedAt: Date.now(),
      type: "sendText", payload: { text: "HOLD_FOR_QUEUE" },
    } });
    assert.equal(slowSend.status, "accepted");
    await slowRequest;
    const queueImage = await service.sendConversationCommandV4({ workspacePath, envelope: {
      commandId: randomUUID(), clientId: "image-upload-test", sessionId, issuedAt: Date.now(),
      type: "sendText", payload: { text: "Queued image", requestedDelivery: "queue", attachments: [
        { ref: result.ref, fileName: "粘贴.png", mime: "image/png", bytes: bytes.length },
      ] },
    } });
    assert.equal(queueImage.status, "accepted", queueImage.message);
    assert.equal((await supervisor.getState(sessionId)).pendingMessageCount, 1);
    const catalog = await supervisor.getQueueCatalog(sessionId);
    assert.equal(catalog.followUp[0]?.images.length, 1);
    const queuedImage = await supervisor.readQueueItem(sessionId, catalog.revision, catalog.followUp[0]!.id);
    assert.equal(queuedImage.images[0]?.data, bytes.toString("base64"));
    const queuedText = await service.sendConversationCommandV4({ workspacePath, envelope: {
      commandId: randomUUID(), clientId: "image-upload-test", sessionId, issuedAt: Date.now(),
      type: "sendText", payload: { text: "FOLLOW_AFTER_QUEUE", requestedDelivery: "queue" },
    } });
    assert.equal(queuedText.status, "accepted", queuedText.message);
    assert.equal((await supervisor.getState(sessionId)).pendingMessageCount, 2,
      "busy text must be admitted to Pi's queue despite the foreground durable intent");
    releaseSlowResponse?.();
    await slowSettled;
    assert.ok((await supervisor.getHistoryMessages(sessionId)).some(message =>
      typeof message === "object" && message !== null &&
      (message as { role?: string; content?: unknown }).role === "user" &&
      JSON.stringify((message as { content?: unknown }).content).includes("FOLLOW_AFTER_QUEUE")));
    const nextSettled = (async () => {
      for await (const [, record] of on(supervisor, "record", { signal: AbortSignal.timeout(15_000) })) {
        if (record.type === "agent_settled") return;
      }
    })();
    const afterQueue = await service.sendConversationCommandV4({ workspacePath, envelope: {
      commandId: randomUUID(), clientId: "image-upload-test", sessionId, issuedAt: Date.now(),
      type: "sendText", payload: { text: "AFTER_FOLLOW" },
    } });
    assert.equal(afterQueue.status, "accepted", afterQueue.message);
    await nextSettled;
    await new Promise(resolve => setTimeout(resolve, 100));
    await service.disposeAllAndWait();
    await assert.rejects(access(result.ref), /ENOENT/);
    const restored = createPiAgentService(piEntry, new PiSessionSupervisor({ piEntry, env: {
      PI_CODING_AGENT_DIR: profile, PI_TELEMETRY: "0",
    }, rpcArgs: ["--offline", "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-context-files"] }));
    try {
      await restored.subscribeConversationV4({ workspacePath, sessionId });
      const history = await restored.conversationRowsRangeV4({ workspacePath, sessionId, limit: 100 });
      const historical = history.rows.find(row => row.kind === "userInput" && row.text === "Describe image");
      assert.ok(historical?.kind === "userInput" && historical.attachments?.length === 1);
      const replay = await restored.attachmentReadV4({ workspacePath, sessionId,
        ref: historical.attachments[0]!.ref, offset: 0, limit: 1024 });
      assert.deepEqual(Buffer.from(replay.dataBase64, "base64"), bytes,
        "preview after restart must come from Pi JSONL, not the temporary upload file");
      assert.equal(requests.length, 5, "resuming a session must not replay image, foreground or queued prompts");
    } finally { await restored.disposeAllAndWait(); }
  } finally {
    releaseSlowResponse?.();
    await service.disposeAllAndWait();
    setDataBaseDir(null);
    model.closeAllConnections();
    await new Promise<void>(resolve => model.close(() => resolve()));
    await rm(otherWorkspace, { recursive: true, force: true });
    await rm(workspacePath, { recursive: true, force: true });
  }
});
