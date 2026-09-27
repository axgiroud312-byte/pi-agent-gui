import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { on } from "node:events";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { PiNativeV4Service } from "../src/pi-agent/pi-native-v4-service.js";
import { PiSessionSupervisor } from "../src/pi-agent/pi-session-supervisor.js";

test("native GUI service loads router model, refreshes Pi provider, invokes Pi inference, and unloads",
  { timeout: 90_000 }, async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), "pi-llama-service-"));
    let status = "unloaded";
    let inferenceCalls = 0;
    const router = createServer(async (request, response) => {
      let raw = ""; for await (const part of request) raw += part;
      if (request.url === "/models" || request.url === "/models?reload=1") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ data: [{ id: "test.gguf", source: "file", status: { value: status },
          meta: { n_ctx: 4096 } }] })); return;
      }
      if (request.url?.startsWith("/props")) {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ chat_template: "chatml", models_autoload: false })); return;
      }
      if (request.url === "/models/load" && request.method === "POST") {
        assert.equal(request.headers.authorization, "Bearer service-test-key");
        assert.equal((JSON.parse(raw) as { model: string }).model, "test.gguf");
        status = "loaded"; response.writeHead(200, { "content-type": "application/json" }); response.end("{}"); return;
      }
      if (request.url === "/models/unload" && request.method === "POST") {
        status = "unloaded"; response.writeHead(200, { "content-type": "application/json" }); response.end("{}"); return;
      }
      if (request.url === "/v1/chat/completions" && request.method === "POST") {
        assert.equal(request.headers.authorization, "Bearer service-test-key");
        inferenceCalls++;
        response.writeHead(200, { "content-type": "text/event-stream" });
        response.end(`data: ${JSON.stringify({ id: "llama-service", object: "chat.completion.chunk", created: 1,
          model: "test.gguf", choices: [{ index: 0, delta: { role: "assistant", content: "PI_ROUTER_REPLY" },
            finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`); return;
      }
      response.writeHead(404); response.end();
    });
    let service: PiNativeV4Service | undefined;
    try {
      await new Promise<void>(resolve => router.listen(0, "127.0.0.1", resolve));
      const address = router.address(); assert(address && typeof address !== "string");
      const extension = fileURLToPath(new URL("../src/pi-agent/pi-control-bridge-extension.ts", import.meta.url));
      const supervisor = new PiSessionSupervisor({
        piEntry: fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent/rpc-entry")),
        env: { PI_CODING_AGENT_DIR: join(workspacePath, "profile"), PI_TELEMETRY: "0",
          LLAMA_BASE_URL: `http://127.0.0.1:${address.port}`, LLAMA_API_KEY: "service-test-key" },
        rpcArgs: ["--offline", "--no-extensions", "--no-skills", "--no-prompt-templates",
          "--no-context-files", "--extension", extension],
      });
      service = new PiNativeV4Service(supervisor, join(workspacePath, "catalog"));
      const created = await service.sendConversationCommandV4({ workspacePath, envelope: {
        commandId: randomUUID(), clientId: "router-test", sessionId: null, issuedAt: Date.now(),
        type: "createSession", payload: { workspaceId: workspacePath },
      } });
      assert.equal(created.result?.type, "createSession");
      if (created.result?.type !== "createSession") throw new Error("No Pi session");
      const sessionId = created.result.sessionId;
      await assert.rejects(service.runPiLlamaRouter({ workspacePath, sessionId,
        action: { kind: "surprise", modelId: "test.gguf" } as never }), /unsupported.*router action/i);
      assert.equal(status, "unloaded", "invalid RPC action must not enter router management");
      const before = await service.readPiLlamaRouter({ workspacePath, sessionId });
      assert.equal(before.models[0]?.status.value, "unloaded");
      assert.equal(before.models[0]?.selectableInPi, false);
      assert.equal(JSON.stringify(before).includes("service-test-key"), false,
        "Pi provider secret must remain in Host and never reach the renderer view");
      const loaded = await service.runPiLlamaRouter({ workspacePath, sessionId,
        action: { kind: "load", modelId: "test.gguf" } });
      assert.equal(loaded.models[0]?.status.value, "loaded");
      assert.equal(loaded.models[0]?.selectableInPi, true);
      const catalog = await supervisor.command(sessionId, { type: "get_available_models" }) as { models: Array<{ provider: string; id: string }> };
      assert(catalog.models.some(model => model.provider === "llama.cpp" && model.id === "test.gguf"));
      await supervisor.setModel(sessionId, "llama.cpp", "test.gguf");
      const settled = (async () => {
        for await (const [, record] of on(supervisor, "record", { signal: AbortSignal.timeout(20_000) })) {
          if (record.type === "agent_settled") return;
        }
      })();
      assert.equal(await supervisor.sendText(sessionId, "test router inference"), "run");
      await settled;
      assert.equal(inferenceCalls, 1, "only Pi should invoke the router inference endpoint");
      const unloaded = await service.runPiLlamaRouter({ workspacePath, sessionId,
        action: { kind: "unload", modelId: "test.gguf" } });
      assert.equal(unloaded.models[0]?.status.value, "unloaded");
      assert.equal(unloaded.models[0]?.selectableInPi, false);
    } finally {
      await service?.dispose(); router.closeAllConnections();
      await new Promise<void>(resolve => router.close(() => resolve()));
      await rm(workspacePath, { recursive: true, force: true });
    }
  });
