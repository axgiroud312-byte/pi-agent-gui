import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { on } from "node:events";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { PiNativeV4Service } from "../src/pi-agent/pi-native-v4-service.js";
import { PiSessionSupervisor } from "../src/pi-agent/pi-session-supervisor.js";

test("native session service keeps Pi tree actions in the owned RPC process and reconciles branch rows",
  { timeout: 90_000 }, async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), "pi-control-service-"));
    const otherWorkspace = await mkdtemp(join(tmpdir(), "pi-control-other-"));
    const profile = join(workspacePath, "profile");
    const server = createServer(async (request, response) => {
      for await (const _ of request) { /* drain */ }
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.end(`data: ${JSON.stringify({ id: "control-service", object: "chat.completion.chunk", created: 1,
        model: "control-test", choices: [{ index: 0, delta: { role: "assistant", content: "ANSWER" }, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`);
    });
    let service: PiNativeV4Service | undefined;
    try {
      await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
      const address = server.address();
      assert(address && typeof address !== "string");
      await mkdir(profile);
      await writeFile(join(profile, "models.json"), JSON.stringify({ providers: {
        "control-provider": { baseUrl: `http://127.0.0.1:${address.port}/v1`, api: "openai-completions",
          apiKey: "local-test-only", models: [{ id: "control-test" }] },
      } }));
      await writeFile(join(profile, "settings.json"), JSON.stringify({
        defaultProvider: "control-provider", defaultModel: "control-test",
      }));
      const extension = fileURLToPath(new URL("../src/pi-agent/pi-control-bridge-extension.ts", import.meta.url));
      const supervisor = new PiSessionSupervisor({
        piEntry: fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent/rpc-entry")),
        env: { PI_CODING_AGENT_DIR: profile, PI_TELEMETRY: "0" },
        rpcArgs: ["--offline", "--no-extensions", "--no-skills", "--no-prompt-templates",
          "--no-context-files", "--extension", extension],
      });
      service = new PiNativeV4Service(supervisor, join(workspacePath, "catalog"));
      const created = await service.sendConversationCommandV4({ workspacePath, envelope: {
        commandId: randomUUID(), clientId: "tree-test", sessionId: null, issuedAt: Date.now(),
        type: "createSession", payload: { workspaceId: workspacePath },
      } });
      assert.equal(created.result?.type, "createSession");
      if (created.result?.type !== "createSession") throw new Error("No Pi session");
      const sessionId = created.result.sessionId;
      const settled = (async () => {
        for await (const [, record] of on(supervisor, "record", { signal: AbortSignal.timeout(20_000) })) {
          if (record.type === "agent_settled") return;
        }
      })();
      const sent = await service.sendConversationCommandV4({ workspacePath, envelope: {
        commandId: randomUUID(), clientId: "tree-test", sessionId, issuedAt: Date.now(),
        type: "sendText", payload: { text: "service branch input" },
      } });
      assert.equal(sent.status, "accepted", sent.message);
      await settled;
      await (service as unknown as { reconciliations: Map<string, Promise<void>> }).reconciliations.get(sessionId);
      const before = await service.readPiControlTree({ workspacePath, sessionId });
      const user = before.entries.find(entry => entry.type === "message" && entry.message.role === "user");
      assert(user && user.type === "message");
      await assert.rejects(service.readPiControlTree({ workspacePath: otherWorkspace, sessionId }), /owned|workspace/i);
      const labelled = await service.runPiControlTree({ workspacePath, sessionId, action: {
        operation: "label", targetId: user.id, label: "first", sessionId, generation: before.info.generation,
      } });
      assert(labelled.entries.some(entry => entry.type === "label" && entry.label === "first"));
      const navigated = await service.runPiControlTree({ workspacePath, sessionId, action: {
        operation: "navigate", targetId: user.id, summarize: false, sessionId,
        generation: labelled.info.generation,
      } });
      assert.equal(navigated.result?.editorText, "service branch input");
      assert(navigated.entries.some(entry => entry.id === navigated.leafId && entry.type === "custom" &&
        entry.customType === "pi-agent-ide.tree-navigation.v1" && entry.parentId === user.parentId));
      const rows = await service.conversationRowsRangeV4({ workspacePath, sessionId, limit: 100 });
      assert.equal(rows.rows.some(row => row.kind === "userInput" && row.text === "service branch input"), false);
      const reloaded = await service.runPiControlTree({ workspacePath, sessionId, action: {
        operation: "reload", sessionId, generation: navigated.info.generation,
      } });
      assert.notEqual(reloaded.info.generation, navigated.info.generation);
      await service.dispose();
      service = new PiNativeV4Service(new PiSessionSupervisor({
        piEntry: fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent/rpc-entry")),
        env: { PI_CODING_AGENT_DIR: profile, PI_TELEMETRY: "0" },
        rpcArgs: ["--offline", "--no-extensions", "--no-skills", "--no-prompt-templates",
          "--no-context-files", "--extension", extension],
      }), join(workspacePath, "catalog"));
      const restored = await service.readPiControlTree({ workspacePath, sessionId });
      assert(restored.entries.some(entry => entry.type === "label" && entry.label === "first"),
        "Pi JSONL must retain the label after a new Host and Pi process");
      const restoredRows = await service.conversationRowsRangeV4({ workspacePath, sessionId, limit: 100 });
      assert.equal(restoredRows.rows.some(row => row.kind === "userInput" && row.text === "service branch input"), false,
        "Pi must restore the navigated branch rather than the earlier user turn");
    } finally {
      await service?.dispose();
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
      await rm(workspacePath, { recursive: true, force: true });
      await rm(otherWorkspace, { recursive: true, force: true });
    }
  });
