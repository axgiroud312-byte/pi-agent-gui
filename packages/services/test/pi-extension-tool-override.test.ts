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

test("fixed Pi gives a same-name extension read tool the actual model call and native result row",
  { timeout: 40_000 }, async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-read-override-"));
    const profile = join(root, "profile");
    await mkdir(profile);
    const sentinel = join(root, "sentinel.txt");
    await writeFile(sentinel, "BUILTIN_READ_ONLY_MARKER");
    const requests: Array<{ tools?: Array<{ function?: { name?: string; description?: string } }>;
      messages?: Array<{ role?: string; tool_call_id?: string; content?: unknown }> }> = [];
    const model = createServer(async (request, response) => {
      if (request.method === "GET") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ data: [{ id: "override", object: "model" }] }));
        return;
      }
      let raw = "";
      for await (const chunk of request) raw += chunk.toString();
      const body = JSON.parse(raw) as typeof requests[number];
      requests.push(body);
      response.writeHead(200, { "content-type": "text/event-stream" });
      const send = (delta: object, finishReason: string | null) => response.write(`data: ${JSON.stringify({
        id: "override", object: "chat.completion.chunk", created: 1, model: "override",
        choices: [{ index: 0, delta, finish_reason: finishReason }],
      })}\n\n`);
      if (!body.messages?.some(message => message.role === "tool" && message.tool_call_id === "read-call")) {
        send({ role: "assistant", tool_calls: [{ index: 0, id: "read-call", type: "function",
          function: { name: "read", arguments: JSON.stringify({ path: sentinel }) } }] }, null);
        send({}, "tool_calls");
      } else {
        send({ role: "assistant", content: "OVERRIDE_READ_COMPLETE" }, null);
        send({}, "stop");
      }
      response.end("data: [DONE]\n\n");
    });
    await new Promise<void>(resolve => model.listen(0, "127.0.0.1", resolve));
    const address = model.address();
    assert(address && typeof address !== "string");
    await writeFile(join(profile, "models.json"), JSON.stringify({ providers: { override: {
      baseUrl: `http://127.0.0.1:${address.port}/v1`, api: "openai-completions", apiKey: "local-only",
      models: [{ id: "override" }],
    } } }));
    await writeFile(join(profile, "settings.json"), JSON.stringify({
      defaultProvider: "override", defaultModel: "override", defaultProjectTrust: "always",
    }));
    const supervisor = new PiSessionSupervisor({
      piEntry: fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent/rpc-entry")),
      env: { PI_CODING_AGENT_DIR: profile, PI_TELEMETRY: "0" },
      rpcArgs: ["--offline", "--no-extensions", "-e",
        fileURLToPath(new URL("../src/pi-agent/pi-control-bridge-extension.ts", import.meta.url)), "-e",
        fileURLToPath(new URL("../../../examples/pi-gui-compat/tool-override.ts", import.meta.url)),
        "--no-skills", "--no-prompt-templates", "--no-context-files"],
    });
    const service = new PiNativeV4Service(supervisor, join(root, "catalog"));
    try {
      const target = { workspacePath: root };
      const created = await service.sendConversationCommandV4({ ...target, envelope: {
        commandId: randomUUID(), clientId: "override-contract", sessionId: null, issuedAt: Date.now(),
        type: "createSession", payload: { workspaceId: root },
      } });
      assert(created.result?.type === "createSession");
      const sessionId = created.result.sessionId;
      const tree = await service.readPiControlTree({ ...target, sessionId });
      assert.equal(tree.tools.filter(tool => tool.name === "read").length, 1,
        "native tool selector must show the active Pi definition once");
      assert.equal(tree.tools.find(tool => tool.name === "read")?.description,
        "Controlled same-name read override for GUI verification");
      assert(tree.activeTools.includes("read"));
      const sent = await service.sendConversationCommandV4({ ...target, envelope: {
        commandId: randomUUID(), clientId: "override-contract", sessionId, issuedAt: Date.now(),
        type: "sendText", payload: { text: "Call read on the sentinel path" },
      } });
      assert.equal(sent.status, "accepted", sent.reasonCode);
      for (let attempt = 0; attempt < 100 && requests.length < 2; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      assert.equal(requests.length, 2, "Pi must execute one tool call then continue its own model loop");
      assert.equal(requests[0]?.tools?.find(tool => tool.function?.name === "read")?.function?.description,
        "Controlled same-name read override for GUI verification");
      const second = JSON.stringify(requests[1]?.messages);
      assert.match(second, /EXTENSION_READ_OVERRIDE_MARKER/u);
      assert.doesNotMatch(second, /BUILTIN_READ_ONLY_MARKER/u,
        "Pi must not execute its built-in file reader after the extension overrides read");
      const history = await supervisor.getHistoryMessages(sessionId);
      const result = history.find(message => typeof message === "object" && message !== null &&
        (message as { role?: string }).role === "toolResult") as { content?: Array<{ text?: string }> } | undefined;
      assert(result?.content?.some(part => part.text?.includes("EXTENSION_READ_OVERRIDE_MARKER")));
      const rows = await service.conversationRowsRangeV4({ ...target, sessionId, limit: 100 });
      const tool = rows.rows.find(row => row.kind === "toolCall" && row.toolName === "read");
      assert(tool && tool.kind === "toolCall");
      assert.match(JSON.stringify(tool), /EXTENSION_READ_OVERRIDE_MARKER/u);
      assert.doesNotMatch(JSON.stringify(tool), /BUILTIN_READ_ONLY_MARKER/u);
      assert.equal(tool.piResult?.parts[0]?.type, "text",
        "native read cards hide their output; Pi's actual toolResult must also reach the visible result panel");
      assert.equal(tool.piResult?.parts[0]?.type === "text" ? tool.piResult.parts[0].text : undefined,
        `EXTENSION_READ_OVERRIDE_MARKER ${sentinel}`);
      assert((await readFile(supervisor.getSession(sessionId)!.sessionFile, "utf8"))
        .includes("EXTENSION_READ_OVERRIDE_MARKER"));
    } finally {
      await service.dispose();
      model.closeAllConnections();
      await new Promise<void>(resolve => model.close(() => resolve()));
      await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  });
