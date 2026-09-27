import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { PiNativeV4Service } from "../src/pi-agent/pi-native-v4-service.js";
import { PiSessionSupervisor } from "../src/pi-agent/pi-session-supervisor.js";

const imageData = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC";

test("pinned Pi input transform keeps image bytes and MIME in model request and JSONL; handled input starts no model run",
  { timeout: 60_000 }, async () => {
    const workspace = await mkdtemp(join(tmpdir(), "pi-input-transform-"));
    const profile = join(workspace, "profile");
    await mkdir(profile);
    const modelRequests: Array<{ text: string; mime: string[]; digests: string[] }> = [];
    const model = createServer(async (request, response) => {
      if (request.method !== "POST") { response.writeHead(404); response.end(); return; }
      let raw = "";
      for await (const chunk of request) raw += chunk.toString();
      const body = JSON.parse(raw) as { messages?: Array<{ role?: string; content?: Array<{
        type?: string; text?: string; image_url?: { url?: string } }> }> };
      const parts = body.messages?.filter(message => message.role === "user").at(-1)?.content ?? [];
      const urls = parts.filter(part => part.type === "image_url").map(part => part.image_url?.url ?? "");
      modelRequests.push({ text: parts.filter(part => part.type === "text").map(part => part.text).join(""),
        mime: urls.map(url => /^data:([^;]+);base64,/u.exec(url)?.[1] ?? ""),
        digests: urls.map(url => createHash("sha256").update(Buffer.from(url.split(",")[1] ?? "", "base64")).digest("hex")) });
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.end(`data: ${JSON.stringify({ id: "transform", object: "chat.completion.chunk", created: 1,
        model: "transform", choices: [{ index: 0, delta: { role: "assistant", content: "TRANSFORM_COMPLETE" },
          finish_reason: null }] })}\n\n` +
        `data: ${JSON.stringify({ id: "transform", object: "chat.completion.chunk", created: 1,
          model: "transform", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\n` +
        "data: [DONE]\n\n");
    });
    await new Promise<void>(resolve => model.listen(0, "127.0.0.1", resolve));
    const address = model.address();
    assert(address && typeof address !== "string");
    await writeFile(join(profile, "models.json"), JSON.stringify({ providers: { transform: {
      baseUrl: `http://127.0.0.1:${address.port}/v1`, api: "openai-completions", apiKey: "local-only",
      models: [{ id: "transform", reasoning: false, input: ["text", "image"] }],
    } } }));
    await writeFile(join(profile, "settings.json"), JSON.stringify({
      defaultProvider: "transform", defaultModel: "transform", defaultProjectTrust: "always",
    }));
    await mkdir(join(profile, "prompts"));
    await writeFile(join(profile, "prompts", "input-template.md"),
      "---\ndescription: effective text hash fixture\n---\nTemplate expansion $1\n");
    const supervisor = new PiSessionSupervisor({
      piEntry: fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent/rpc-entry")),
      env: { PI_CODING_AGENT_DIR: profile, PI_TELEMETRY: "0" },
      rpcArgs: ["--offline", "--no-extensions", "-e",
        fileURLToPath(new URL("../../../examples/pi-gui-compat/extension.ts", import.meta.url)),
        "--no-skills", "--no-context-files"],
    });
    const service = new PiNativeV4Service(supervisor, join(workspace, "catalog"));
    const records: Record<string, unknown>[] = [];
    supervisor.on("record", (_sessionId, record) => records.push(record));
    try {
      const target = { workspacePath: workspace };
      const created = await service.sendConversationCommandV4({ ...target, envelope: {
        commandId: randomUUID(), clientId: "pi-input-contract", sessionId: null, issuedAt: Date.now(),
        type: "createSession", payload: { workspaceId: workspace },
      } });
      assert(created.result?.type === "createSession");
      const sessionId = created.result.sessionId;
      assert.equal(await supervisor.sendText(sessionId, "PI_GUI_INPUT_HANDLED"), "handledInput");
      assert.equal(supervisor.getSession(sessionId)?.phase, "settled");
      assert.equal(supervisor.getSession(sessionId)?.reconciliationRequired ?? false, false);
      assert(records.some(record => record.method === "notify" &&
        record.message === "PI_GUI_INPUT_HANDLED_BY_EXTENSION"));
      assert.equal(modelRequests.length, 0, "handled input must never call the model");
      assert.equal(await supervisor.sendText(sessionId, "PI_GUI_INPUT_TRANSFORM original", [{
        type: "image", mimeType: "image/png", data: imageData,
      }]), "run");
      for (let attempt = 0; attempt < 100 && modelRequests.length === 0; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      assert.equal(modelRequests.length, 1);
      assert.match(modelRequests[0]!.text, /PI_IMAGE transformed by Pi GUI compatibility extension/u);
      assert.deepEqual(modelRequests[0]!.mime, ["image/png"]);
      const digest = createHash("sha256").update(Buffer.from(imageData, "base64")).digest("hex");
      assert.deepEqual(modelRequests[0]!.digests, [digest]);
      const history = await supervisor.getHistoryMessages(sessionId);
      const user = history.find(message => typeof message === "object" && message !== null &&
        (message as { role?: string }).role === "user") as { content?: Array<{
          type?: string; text?: string; data?: string; mimeType?: string }> } | undefined;
      assert(user);
      assert.deepEqual(user.content?.map(part => part.type), ["text", "image"]);
      assert.equal(user.content?.[0]?.text, "PI_IMAGE transformed by Pi GUI compatibility extension: original");
      assert.equal(user.content?.[1]?.mimeType, "image/png");
      assert.equal(createHash("sha256").update(Buffer.from(user.content?.[1]?.data ?? "", "base64")).digest("hex"), digest);
      const sessionFile = supervisor.getSession(sessionId)?.sessionFile;
      assert(sessionFile);
      assert((await readFile(sessionFile, "utf8")).includes(imageData));
      for (let attempt = 0; attempt < 100 && supervisor.getSession(sessionId)?.phase !== "settled"; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      const send = (text: string) => service.sendConversationCommandV4({ ...target, envelope: {
        commandId: randomUUID(), clientId: "pi-input-contract", sessionId, issuedAt: Date.now(),
        type: "sendText", payload: { text },
      } });
      const transformed = await send("PI_GUI_INPUT_TRANSFORM from native command");
      assert.equal(transformed.status, "accepted", transformed.message);
      for (let attempt = 0; attempt < 100 && modelRequests.length < 2; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      assert.equal(modelRequests.length, 2);
      for (let attempt = 0; attempt < 100 &&
        (await service.getPiSessionSummary({ ...target, sessionId })).phase !== "completedSuccess"; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      const next = await send("ordinary next message");
      assert.equal(next.status, "accepted", next.reasonCode);
      assert.equal(supervisor.getSession(sessionId)?.reconciliationRequired ?? false, false,
        "Pi's effective transformed text hash must clear the native pending intent");
      for (let attempt = 0; attempt < 100 &&
        (await service.getPiSessionSummary({ ...target, sessionId })).phase !== "completedSuccess"; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      const template = await send("/input-template PI_TEXT_ALPHA");
      assert.equal(template.status, "accepted", template.reasonCode);
      for (let attempt = 0; attempt < 100 && modelRequests.length < 4; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      assert.equal(modelRequests.at(-1)?.text, "Template expansion PI_TEXT_ALPHA");
      for (let attempt = 0; attempt < 100 &&
        (await service.getPiSessionSummary({ ...target, sessionId })).phase !== "completedSuccess"; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      const afterTemplate = await send("after template expansion");
      assert.equal(afterTemplate.status, "accepted", afterTemplate.reasonCode);
      assert.equal(supervisor.getSession(sessionId)?.reconciliationRequired ?? false, false,
        "Pi's expanded template text hash must clear the native pending intent");
    } finally {
      await service.dispose();
      model.closeAllConnections();
      await new Promise<void>(resolve => model.close(() => resolve()));
      await rm(workspace, { recursive: true, force: true });
    }
  });
