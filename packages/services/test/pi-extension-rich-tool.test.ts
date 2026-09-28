import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { on } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { PiMessageRows } from "../src/pi-agent/pi-message-rows.js";
import { PiNativeV4Service } from "../src/pi-agent/pi-native-v4-service.js";
import { PiSessionSupervisor } from "../src/pi-agent/pi-session-supervisor.js";

const sampleImage = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRhsAAAAASUVORK5CYII=";

test("fixed Pi custom tool result remains image readable in live and restored native rows", { timeout: 30_000 }, async () => {
  const workspacePath = await mkdtemp(join(tmpdir(), "pi-rich-tool-"));
  const foreignWorkspace = await mkdtemp(join(tmpdir(), "pi-rich-tool-other-"));
  let calls = 0;
  let toolRegistered = false;
  const model = createServer(async (request, response) => {
    if (request.method === "GET" && request.url?.startsWith("/v1/models")) {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ data: [{ id: "pi-rich-tool", object: "model" }] }));
      return;
    }
    let raw = "";
    for await (const chunk of request) raw += chunk.toString();
    const body = JSON.parse(raw) as { messages?: Array<{ role?: string, tool_call_id?: string }>,
      tools?: Array<{ function?: { name?: string } }> };
    calls++;
    response.writeHead(200, { "content-type": "text/event-stream" });
    const send = (delta: object, finishReason: string | null) => response.write(`data: ${JSON.stringify({
      id: "pi-rich-tool", object: "chat.completion.chunk", created: 1, model: "pi-rich-tool",
      choices: [{ index: 0, delta, finish_reason: finishReason }],
    })}\n\n`);
    if (!body.messages?.some(message => message.role === "tool" && message.tool_call_id === "rich-call")) {
      toolRegistered = body.tools?.some(tool => tool.function?.name === "gui_rich_probe") ?? false;
      send({ role: "assistant", tool_calls: [{ index: 0, id: "rich-call", type: "function",
        function: { name: "gui_rich_probe", arguments: "{}" } }] }, null);
      send({}, "tool_calls");
    } else {
      send({ role: "assistant", content: "RICH_TOOL_COMPLETE" }, null);
      send({}, "stop");
    }
    response.end("data: [DONE]\n\n");
  });
  await new Promise<void>(resolve => model.listen(0, "127.0.0.1", resolve));
  const address = model.address();
  assert(address && typeof address !== "string");
  const profile = join(workspacePath, "profile");
  await mkdir(profile);
  await writeFile(join(profile, "models.json"), JSON.stringify({ providers: { "rich-tool": {
    baseUrl: `http://127.0.0.1:${address.port}/v1`, api: "openai-completions", apiKey: "local-only",
    models: [{ id: "pi-rich-tool", reasoning: false, input: ["text", "image"] }],
  } } }));
  await writeFile(join(profile, "settings.json"), JSON.stringify({
    defaultProvider: "rich-tool", defaultModel: "pi-rich-tool",
  }));
  const supervisor = new PiSessionSupervisor({
    piEntry: fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent/rpc-entry")),
    env: { PI_CODING_AGENT_DIR: profile, PI_TELEMETRY: "0" },
    rpcArgs: ["--offline", "--no-extensions", "-e",
      fileURLToPath(new URL("../../../examples/pi-gui-compat/extension.ts", import.meta.url)),
      "--no-skills", "--no-prompt-templates", "--no-context-files"],
  });
  const service = new PiNativeV4Service(supervisor, join(workspacePath, "catalog"));
  try {
    const created = await service.sendConversationCommandV4({ workspacePath, envelope: {
      commandId: randomUUID(), clientId: "rich-tool-contract", sessionId: null, issuedAt: Date.now(),
      type: "createSession", payload: { workspaceId: workspacePath },
    } });
    assert(created.result?.type === "createSession");
    const sessionId = created.result.sessionId;
    const settled = (async () => {
      for await (const [id, record] of on(supervisor, "record", { signal: AbortSignal.timeout(20_000) })) {
        if (id === sessionId && record.type === "agent_settled") return;
      }
    })();
    const sent = await service.sendConversationCommandV4({ workspacePath, envelope: {
      commandId: randomUUID(), clientId: "rich-tool-contract", sessionId, issuedAt: Date.now(),
      type: "sendText", payload: { text: "Invoke gui_rich_probe" },
    } });
    assert.equal(sent.status, "accepted", sent.message);
    await settled;
    assert.equal(calls, 2, "Pi must invoke the extension tool and then request a final answer");
    assert.equal(toolRegistered, true, "the pinned Pi process must register the sample extension tool");
    const history = await supervisor.getHistoryMessages(sessionId);
    const result = history.find(message => typeof message === "object" && message !== null &&
      (message as { role?: string }).role === "toolResult") as {
      content?: Array<{ type?: string, data?: string }>, details?: unknown } | undefined;
    assert(result, "Pi JSONL must retain the actual extension tool result");
    assert.deepEqual(result.content?.map(part => part.type), ["text", "image", "text"]);
    assert.equal(result.content?.[1]?.data, sampleImage);
    assert.deepEqual(result.details, { source: "pi-gui-compat", marker: "original tool details" });
    const sessionFile = supervisor.getSession(sessionId)?.sessionFile;
    assert(sessionFile);
    const jsonl = await readFile(sessionFile, "utf8");
    assert.match(jsonl, /"role":"toolResult"/u);
    assert(jsonl.includes(sampleImage));
    assert.match(jsonl, /original tool details/u);
    const live = await service.conversationRowsRangeV4({ workspacePath, sessionId, limit: 100 });
    const row = live.rows.find(item => item.kind === "toolCall" && item.toolName === "gui_rich_probe");
    assert(row && row.kind === "toolCall");
    assert.deepEqual(row.piResult?.parts.map(part => part.type), ["text", "image", "text"]);
    assert.deepEqual(row.piResult?.details, result.details);
    assert.equal(JSON.stringify(row).includes(sampleImage), false,
      "transported native rows must carry opaque refs rather than image bytes");
    const ref = row.piResult?.attachments?.[0]?.ref;
    assert(ref);
    const image = await service.attachmentReadV4({ workspacePath, sessionId, ref, offset: 0, limit: 1024 });
    assert.deepEqual(Buffer.from(image.dataBase64, "base64"), Buffer.from(sampleImage, "base64"));
    await assert.rejects(service.attachmentReadV4({ workspacePath, sessionId, ref, offset: 0,
      limit: 1024, target: { rowId: row.rowId + 1, entityId: "foreign-row" }, attachmentIndex: 0 }),
    /not in this session row/u);
    await assert.rejects(service.attachmentReadV4({ workspacePath: foreignWorkspace, sessionId,
      ref, offset: 0, limit: 1024 }), /workspace|session|owned/u);
    const restored = new PiMessageRows(workspacePath);
    const cold = restored.restore(history);
    assert.equal(cold.some(item => item.kind === "extensionMessage" &&
      item.customType === "pi.unknown-message"), false,
    "fixed Pi's internal system message must not become a visible unknown row");
    const coldRow = cold.find(item => item.kind === "toolCall");
    assert(coldRow && coldRow.kind === "toolCall");
    assert.deepEqual(coldRow.piResult, row.piResult, "cold Pi history must retain ordered result content");
    assert.equal(restored.image(ref)?.data, sampleImage,
      "the scoped image ref must remain backed by Pi JSONL after restoration");
  } finally {
    await service.dispose();
    model.closeAllConnections();
    await new Promise<void>(resolve => model.close(() => resolve()));
    await rm(workspacePath, { recursive: true, force: true, maxRetries: 20, retryDelay: 200 });
    await rm(foreignWorkspace, { recursive: true, force: true, maxRetries: 20, retryDelay: 200 });
  }
});
