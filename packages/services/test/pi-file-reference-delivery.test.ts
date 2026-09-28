import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { on } from "node:events";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { PiSessionSupervisor } from "../src/pi-agent/pi-session-supervisor.js";
import { PiNativeV4Service } from "../src/pi-agent/pi-native-v4-service.js";

test("native file mentions enter fixed Pi as frozen text and original image bytes", { timeout: 30_000 }, async () => {
  const workspacePath = await mkdtemp(join(tmpdir(), "pi-file-delivery-"));
  const requests: string[] = [];
  const model = createServer(async (request, response) => {
    let body = "";
    for await (const part of request) body += part.toString();
    requests.push(body);
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.end(`data: ${JSON.stringify({ id: "file-test", object: "chat.completion.chunk", created: 1,
      model: "pi-file-test", choices: [{ index: 0, delta: { role: "assistant", content: "FILE_ACCEPTED" },
        finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`);
  });
  await new Promise<void>(resolve => model.listen(0, "127.0.0.1", resolve));
  const address = model.address();
  assert(address && typeof address !== "string");
  const profile = join(workspacePath, "profile");
  await mkdir(profile);
  await writeFile(join(profile, "models.json"), JSON.stringify({ providers: { "file-test": {
    baseUrl: `http://127.0.0.1:${address.port}/v1`, api: "openai-completions", apiKey: "local-only",
    models: [{ id: "pi-file-test", reasoning: false, input: ["text", "image"] }],
  } } }));
  await writeFile(join(profile, "settings.json"), JSON.stringify({ defaultProvider: "file-test", defaultModel: "pi-file-test" }));
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC", "base64");
  const filePath = join(workspacePath, "中文 空格.md");
  const imagePath = join(workspacePath, "图 像.png");
  await writeFile(filePath, "发送前内容\n", "utf8");
  await writeFile(imagePath, png);
  const supervisor = new PiSessionSupervisor({
    piEntry: fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent/rpc-entry")),
    env: { PI_CODING_AGENT_DIR: profile, PI_TELEMETRY: "0" },
    rpcArgs: ["--offline", "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-context-files"],
  });
  const service = new PiNativeV4Service(supervisor, join(workspacePath, "catalog"));
  try {
    const created = await service.sendConversationCommandV4({ workspacePath, envelope: {
      commandId: randomUUID(), clientId: "file-reference-test", sessionId: null, issuedAt: Date.now(),
      type: "createSession", payload: { workspaceId: workspacePath },
    } });
    assert(created.result?.type === "createSession");
    const sessionId = created.result.sessionId;
    const missing = await service.sendConversationCommandV4({ workspacePath, envelope: {
      commandId: randomUUID(), clientId: "file-reference-test", sessionId, issuedAt: Date.now(),
      type: "sendText", payload: { text: "检查 [不存在.md](./不存在.md)" },
    } });
    assert.equal(missing.status, "failed");
    assert.equal(missing.reasonCode, "pi.fileReference.FILE_NOT_FOUND");
    assert.match(missing.message ?? "", /FILE_NOT_FOUND/);
    assert.equal((await supervisor.getHistoryMessages(sessionId)).length, 0,
      "missing references must fail before Pi admits a user message");
    const settled = (async () => {
      for await (const [id, record] of on(supervisor, "record", { signal: AbortSignal.timeout(15_000) })) {
        if (id === sessionId && record.type === "agent_settled") return;
      }
    })();
    const sent = await service.sendConversationCommandV4({ workspacePath, envelope: {
      commandId: randomUUID(), clientId: "file-reference-test", sessionId, issuedAt: Date.now(),
      type: "sendText", payload: { text: "检查 [中文 空格.md](<./中文 空格.md>) 和 [图 像.png](<./图 像.png>)" },
    } });
    assert.equal(sent.status, "accepted", sent.message);
    await settled;
    await writeFile(filePath, "发送后变更\n", "utf8");
    await writeFile(imagePath, Buffer.from("changed"));
    const history = await supervisor.getHistoryMessages(sessionId);
    const user = history.find(message => typeof message === "object" && message !== null &&
      (message as { role?: string }).role === "user") as { content?: unknown } | undefined;
    assert(user);
    const persisted = JSON.stringify(user.content);
    assert.match(persisted, /发送前内容/);
    assert.doesNotMatch(persisted, /发送后变更/);
    assert.match(persisted, new RegExp(createHash("sha256").update("发送前内容\n").digest("hex")));
    assert.match(persisted, new RegExp(png.toString("base64")));
    assert(requests.some(body => body.includes("发送前内容") && body.includes("data:image/png;base64,")));
    const rows = await service.conversationRowsRangeV4({ workspacePath, sessionId, limit: 100 });
    const row = rows.rows.find(item => item.kind === "userInput");
    assert(row && row.kind === "userInput" && row.attachments?.length === 1);
    assert.equal(row.epilogueStart, "检查 [中文 空格.md](<./中文 空格.md>) 和 [图 像.png](<./图 像.png>)".length);
    assert.equal(row.epilogueKind, "piFileSnapshots");
    const summary = await service.getPiSessionSummary({ workspacePath, sessionId });
    assert.equal(summary.title, "检查 [中文 空格.md](<./中文 空格.md>) 和 [图 像.png](<./图 像.png>)",
      "Pi snapshot metadata must not leak into the native session title");
    const image = await service.attachmentReadV4({ workspacePath, sessionId, ref: row.attachments[0]!.ref,
      offset: 0, limit: 1024 });
    assert.deepEqual(Buffer.from(image.dataBase64, "base64"), png);

    await writeFile(filePath, "首发文件内容\n", "utf8");
    await writeFile(imagePath, png);
    const firstSettled = (async () => {
      for await (const [id, record] of on(supervisor, "record", { signal: AbortSignal.timeout(15_000) })) {
        if (record.type === "agent_settled" && id !== sessionId) return;
      }
    })();
    const firstInput = await service.sendConversationCommandV4({ workspacePath, envelope: {
      commandId: randomUUID(), clientId: "file-reference-test", sessionId: null, issuedAt: Date.now(),
      type: "createSession", payload: { workspaceId: workspacePath,
        firstInput: { text: "首发 [中文 空格.md](<./中文 空格.md>) 和 [图 像.png](<./图 像.png>)" } },
    } });
    assert.equal(firstInput.status, "accepted", firstInput.message);
    assert(firstInput.result?.type === "createSession");
    await firstSettled;
    const firstHistory = await supervisor.getHistoryMessages(firstInput.result.sessionId);
    assert.match(JSON.stringify(firstHistory), /首发文件内容/);
    assert.match(JSON.stringify(firstHistory), new RegExp(png.toString("base64")));
  } finally {
    await service.dispose();
    model.closeAllConnections();
    await new Promise<void>(resolve => model.close(() => resolve()));
    await rm(workspacePath, { recursive: true, force: true });
  }
});
