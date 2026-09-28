import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { on } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { PiNativeV4Service } from "../src/pi-agent/pi-native-v4-service.js";
import { PiSessionSupervisor } from "../src/pi-agent/pi-session-supervisor.js";

test("fixed Pi context edit is distinct from raw history in the read-only service", { timeout: 30_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-context-inspect-"));
  const profile = join(root, "profile");
  const extension = join(root, "context-edit.mjs");
  const model = createServer(async (request, response) => {
    for await (const _ of request) { /* drain */ }
    response.writeHead(200, { "content-type": "text/event-stream" });
    for (const [delta, finishReason] of [[{ role: "assistant", content: "MODEL_REPLY" }, null], [{}, "stop"]] as const) {
      response.write(`data: ${JSON.stringify({ id: "context-inspect", object: "chat.completion.chunk",
        created: 1, model: "context-inspect", choices: [{ index: 0, delta, finish_reason: finishReason }] })}\n\n`);
    }
    response.end("data: [DONE]\n\n");
  });
  let service: PiNativeV4Service | undefined;
  try {
    await new Promise<void>(resolve => model.listen(0, "127.0.0.1", resolve));
    const address = model.address();
    assert(address && typeof address !== "string");
    await mkdir(profile);
    await writeFile(join(profile, "models.json"), JSON.stringify({ providers: { "context-inspect": {
      baseUrl: `http://127.0.0.1:${address.port}/v1`, api: "openai-completions", apiKey: "local-only",
      models: [{ id: "context-inspect" }],
    } } }));
    await writeFile(join(profile, "settings.json"), JSON.stringify({
      defaultProvider: "context-inspect", defaultModel: "context-inspect", retry: { enabled: false },
    }));
    await writeFile(extension, `export default function(pi) {
      let edited = false;
      pi.on("agent_before_settle", (event, ctx) => {
        if (edited) return;
        const first = ctx.sessionManager.getEntries().find(entry => entry.type === "message" && entry.message.role === "user");
        if (!first) return;
        edited = true;
        return { entries: [...event.entries, { type: "context_edit", targetId: first.id,
          replacement: { content: [{ type: "text", text: "PI_REPLACED_INPUT" }] } }] };
      });
    }`);
    const supervisor = new PiSessionSupervisor({
      piEntry: fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent/rpc-entry")),
      env: { PI_CODING_AGENT_DIR: profile, PI_TELEMETRY: "0" },
      rpcArgs: ["--offline", "--no-extensions", "-e", extension, "--no-skills", "--no-prompt-templates",
        "--no-context-files"],
    });
    service = new PiNativeV4Service(supervisor, join(root, "catalog"));
    const created = await service.sendConversationCommandV4({ workspacePath: root, envelope: {
      commandId: randomUUID(), clientId: "context-contract", sessionId: null, issuedAt: Date.now(),
      type: "createSession", payload: { workspaceId: root },
    } });
    assert(created.result?.type === "createSession");
    const sessionId = created.result.sessionId;
    const settled = (async () => {
      for await (const [id, record] of on(supervisor, "record", { signal: AbortSignal.timeout(20_000) })) {
        if (id === sessionId && record.type === "agent_settled") return;
      }
    })();
    const sent = await service.sendConversationCommandV4({ workspacePath: root, envelope: {
      commandId: randomUUID(), clientId: "context-contract", sessionId, issuedAt: Date.now(),
      type: "sendText", payload: { text: "PI_ORIGINAL_INPUT" },
    } });
    assert.equal(sent.status, "accepted", sent.message);
    await settled;
    const history = await service.readPiContextInspection({ workspacePath: root, sessionId,
      section: "history", offset: 0, limit: 20 });
    const effective = await service.readPiContextInspection({ workspacePath: root, sessionId,
      section: "effective", offset: 0, limit: 20 });
    const edits = await service.readPiContextInspection({ workspacePath: root, sessionId,
      section: "edits", offset: 0, limit: 20 });
    assert.ok(history.items.some(item => item.blocks.some(block => block.kind === "text" &&
      block.text === "PI_ORIGINAL_INPUT")));
    assert.ok(effective.items.some(item => item.blocks.some(block => block.kind === "text" &&
      block.text === "PI_REPLACED_INPUT")));
    assert.ok(edits.items.some(item => item.change === "replace" && item.targetId));
    assert.equal(JSON.stringify(effective).includes("PI_ORIGINAL_INPUT"), false);
    await assert.rejects(service.readPiContextInspection({ workspacePath: root, sessionId,
      section: "history", offset: 0, limit: 41 }), /pagination/i);
  } finally {
    await service?.dispose();
    model.closeAllConnections();
    await new Promise<void>(resolve => model.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
});
