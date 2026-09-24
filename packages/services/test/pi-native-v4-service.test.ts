import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { on } from "node:events";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  conversationTopicWireFrameSchema,
  sessionsIndexTopicWireFrameSchema,
} from "@zcode/shared/zcode-protocol-v4";
import { PiSessionSupervisor } from "../src/pi-agent/pi-session-supervisor.js";
import { PiNativeV4Service } from "../src/pi-agent/pi-native-v4-service.js";

test("native GUI draft defaults and firstInput select the pinned Pi model without dropping execution constraints",
  { timeout: 30_000 }, async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-native-gui-admission-"));
    const profile = join(root, "profile");
    let requests = 0;
    const server = createServer(async (req, res) => {
      for await (const _ of req) { /* drain provider request */ }
      requests++;
      res.writeHead(200, { "content-type": "text/event-stream" });
      for (const [delta, finish_reason] of [[{ role: "assistant", content: "GUI_PAYLOAD_ACCEPTED" }, null], [{}, "stop"]]) {
        res.write(`data: ${JSON.stringify({ id: "native-gui", object: "chat.completion.chunk", created: 1,
          model: "pi-native-test", choices: [{ index: 0, delta, finish_reason }] })}\n\n`);
      }
      res.end("data: [DONE]\n\n");
    });
    let service: PiNativeV4Service | undefined;
    try {
      await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
      const address = server.address();
      assert.ok(address && typeof address !== "string");
      await mkdir(profile);
      await writeFile(join(profile, "models.json"), JSON.stringify({ providers: {
        "new-provider": { baseUrl: `http://127.0.0.1:${address.port}/v1`, api: "openai-completions",
          apiKey: "local-test-only", models: [{ id: "pi-native-test", reasoning: false }] },
      } }));
      await writeFile(join(profile, "settings.json"), JSON.stringify({
        defaultProvider: "new-provider", defaultModel: "pi-native-test",
      }));
      const supervisor = new PiSessionSupervisor({
        piEntry: fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent/rpc-entry")),
        env: { PI_CODING_AGENT_DIR: profile, PI_TELEMETRY: "0" },
        rpcArgs: ["--offline", "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-context-files"],
      });
      service = new PiNativeV4Service(supervisor, join(root, "catalog"));
      const selection = { providerId: "new-provider", modelId: "pi-native-test",
        options: { reasoningLevel: "enabled" } };
      const settled = (async () => {
        for await (const [, record] of on(supervisor, "record", { signal: AbortSignal.timeout(20_000) })) {
          if (record.type === "agent_settled") return;
        }
      })();
      const commandId = randomUUID();
      const ack = await service.sendConversationCommandV4({ workspacePath: root, envelope: {
        commandId, clientId: "native-gui", sessionId: null, issuedAt: Date.now(), type: "createSession",
        payload: { workspaceId: root,
          // useDraftConfigControl builds these exact draft mirrors and defaults.
          config: { mode: "build", planEnabled: false, followupMode: "queue", modelSelection: selection,
            provider: "new-provider", model: "pi-native-test", thought: "enabled" },
          firstInput: { text: "actual native GUI first send", mode: "build", planEnabled: false,
            modelSelection: selection },
        },
      } });
      assert.equal(ack.status, "accepted", ack.message);
      assert.equal(ack.result?.type, "createSession");
      await settled;
      assert.equal(requests, 1, "the GUI first input must reach the real pinned Pi model");
      const sessionId = ack.result?.type === "createSession" ? ack.result.sessionId : "";
      await (service as unknown as { reconciliations: Map<string, Promise<void>> }).reconciliations.get(sessionId);
      const rows = await service.conversationRowsRangeV4({ workspacePath: root, sessionId, limit: 100 });
      assert.equal(rows.rows.find(row => row.kind === "userInput")?.sourceCommandId, commandId);
      assert.ok(rows.rows.some(row => row.kind === "assistantText" && row.text.includes("GUI_PAYLOAD_ACCEPTED")));
    } finally {
      await service?.dispose();
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
      await rm(root, { recursive: true, force: true });
    }
  });

test("native v4 subscription and create/stop commands are backed by a real pinned Pi process", { timeout: 30_000 }, async () => {
  const workspacePath = await mkdtemp(join(tmpdir(), "pi-native-v4-"));
  const piEntry = fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent/rpc-entry"));
  const supervisor = new PiSessionSupervisor({
    piEntry,
    env: { PI_CODING_AGENT_DIR: join(workspacePath, "profile"), PI_TELEMETRY: "0" },
    rpcArgs: ["--offline", "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-context-files"],
  });
  const service = new PiNativeV4Service(supervisor);
  const target = { workspacePath };
  const indexFrames: unknown[] = [];
  const conversationFrames: unknown[] = [];
  const indexListener = service.onDynamicSessionsIndexFrame(target)(frame => indexFrames.push(frame));
  const conversationListener = service.onDynamicConversationFrame(target)(frame => conversationFrames.push(frame));
  try {
    const index = await service.subscribeSessionsIndexV4(target);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(indexFrames.length, 1);
    sessionsIndexTopicWireFrameSchema.parse(indexFrames[0]);

    const commandId = randomUUID();
    const create = await service.sendConversationCommandV4({ ...target, envelope: {
      commandId, clientId: "native-test", sessionId: null, type: "createSession",
      issuedAt: Date.now(), payload: { workspaceId: "native-workspace" },
    } });
    assert.equal(create.status, "accepted", create.message);
    assert.equal(create.result?.type, "createSession");
    if (create.result?.type !== "createSession") throw new Error("Pi create did not return session ID");
    const sessionId = create.result.sessionId;
    assert.equal((await supervisor.getState(sessionId)).sessionId, sessionId);
    assert.ok(indexFrames.length >= 2);
    for (const frame of indexFrames) sessionsIndexTopicWireFrameSchema.parse(frame);

    const conversation = await service.subscribeConversationV4({ ...target, sessionId });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(conversation.ack.mode, "snapshot");
    assert.equal(conversationFrames.length, 1);
    const initial = conversationTopicWireFrameSchema.parse(conversationFrames[0]);
    assert.equal(initial.kind, "complete");
    if (initial.kind === "complete" && initial.frame.payload.kind === "snapshot") {
      assert.equal(initial.frame.payload.snapshot.sessionId, sessionId);
      assert.equal(initial.frame.payload.snapshot.control.phase, "draft");
    }

    const stop = await service.sendConversationCommandV4({ ...target, envelope: {
      commandId: randomUUID(), clientId: "native-test", sessionId, type: "stop",
      issuedAt: Date.now(), payload: {},
    } });
    assert.equal(stop.status, "noop", stop.message);
    assert.equal(stop.reasonCode, "pi.stop.idle");
    assert.equal(supervisor.getSession(sessionId)?.phase, "idle");
    for (const frame of conversationFrames) conversationTopicWireFrameSchema.parse(frame);
    await service.unsubscribeConversationV4({ ...target, subscriptionId: conversation.ack.subscriptionId });
    await service.unsubscribeSessionsIndexV4({ ...target, subscriptionId: index.ack.subscriptionId });
  } finally {
    indexListener.dispose();
    conversationListener.dispose();
    await service.dispose();
    await rm(workspacePath, { recursive: true, force: true });
  }
});
