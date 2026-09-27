import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { PiSessionSupervisor } from "../src/pi-agent/pi-session-supervisor.js";
import { PiNativeV4Service } from "../src/pi-agent/pi-native-v4-service.js";

test("pinned Pi extension answers select, confirm, blank input and multiline editor in the owned session",
  { timeout: 30_000 }, async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-native-extension-ui-"));
    const supervisor = new PiSessionSupervisor({
      piEntry: fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent/rpc-entry")),
      env: { PI_CODING_AGENT_DIR: join(root, "profile"), PI_TELEMETRY: "0" },
      rpcArgs: ["--offline", "--no-extensions", "-e",
        fileURLToPath(new URL("./fixtures/pi-ui-sequence.ts", import.meta.url)),
        "--no-skills", "--no-prompt-templates", "--no-context-files"],
    });
    const service = new PiNativeV4Service(supervisor, join(root, "catalog"));
    try {
      const created = await service.sendConversationCommandV4({ workspacePath: root, envelope: {
        commandId: randomUUID(), clientId: "ui-test", sessionId: null, issuedAt: Date.now(),
        type: "createSession", payload: { workspaceId: root },
      } });
      assert.equal(created.result?.type, "createSession");
      if (created.result?.type !== "createSession") throw new Error("session not created");
      const sessionId = created.result.sessionId;
      const pid = supervisor.getSession(sessionId)?.pid;
      const notices: string[] = [];
      supervisor.on("record", (id, event) => {
        if (id === sessionId && event.method === "notify" && typeof event.message === "string") notices.push(event.message);
      });
      const command = supervisor.sendText(sessionId, "/pi-ui-sequence");
      void command.catch(() => {}); // A failed assertion may close a still-blocked Pi prompt.
      const expected = ["select", "confirm", "input", "editor"] as const;
      for (const [index, method] of expected.entries()) {
        let interaction: { interactionId: string; payload: { input?: { method?: string } } } | undefined;
        for (let attempt = 0; attempt < 200; attempt++) {
          const sessions = (service as unknown as { sessions: Map<string, { snapshot: {
            pendingInteractions: Array<typeof interaction & { interactionId: string }> } }> }).sessions;
          interaction = sessions.get(sessionId)?.snapshot.pendingInteractions[0];
          if (interaction?.payload.input?.method === method) break;
          await new Promise(resolve => setTimeout(resolve, 20));
        }
        assert.equal(interaction?.payload.input?.method, method);
        if (method === "select") {
          const invalid = await service.sendConversationCommandV4({ workspacePath: root, envelope: {
            commandId: randomUUID(), clientId: "ui-test", sessionId, issuedAt: Date.now(),
            type: "resolveInteraction", payload: { interactionId: interaction.interactionId,
              answer: { optionId: "not-an-offered-choice" } },
          } });
          assert.equal(invalid.status, "failed", "an invented choice must never be delivered to Pi");
        }
        const answer = index === 0 ? { optionId: "beta" } : index === 1 ? { action: "decline" as const } :
          index === 2 ? { freeText: "" } : { freeText: "changed\nsecond line" };
        const response = await service.sendConversationCommandV4({ workspacePath: root, envelope: {
          commandId: randomUUID(), clientId: "ui-test", sessionId, issuedAt: Date.now(),
          type: "resolveInteraction", payload: { interactionId: interaction.interactionId, answer },
        } });
        assert.equal(response.status, "accepted", response.message);
        assert.equal(supervisor.getSession(sessionId)?.pid, pid);
      }
      await command;
      const result = notices.find(value => value.startsWith("PI_UI_RESULT:"));
      assert.ok(result, "the same Pi extension must continue after GUI answers");
      assert.deepEqual(JSON.parse(result.slice("PI_UI_RESULT:".length)), {
        selected: "beta", confirmed: false, input: "", edited: "changed\nsecond line",
      });
    } finally {
      await service.dispose();
      await rm(root, { recursive: true, force: true });
    }
  });

test("Stop cancels a pending pinned Pi extension input and retires its request", { timeout: 30_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-native-extension-stop-"));
  const supervisor = new PiSessionSupervisor({
    piEntry: fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent/rpc-entry")),
    env: { PI_CODING_AGENT_DIR: join(root, "profile"), PI_TELEMETRY: "0" },
    rpcArgs: ["--offline", "--no-extensions", "-e",
      fileURLToPath(new URL("./fixtures/pi-ui-sequence.ts", import.meta.url)),
      "--no-skills", "--no-prompt-templates", "--no-context-files"],
  });
  try {
    const session = await supervisor.createSession(root);
    let requestId: string | undefined;
    supervisor.on("record", (_id, event) => {
      if (event.method === "select" && typeof event.id === "string") requestId = event.id;
    });
    const command = supervisor.sendText(session.sessionId, "/pi-ui-sequence");
    void command.catch(() => {});
    for (let count = 0; count < 100 && !requestId; count++) await new Promise(resolve => setTimeout(resolve, 20));
    assert.ok(requestId);
    const executionId = supervisor.getSession(session.sessionId)?.foregroundExecutionId;
    assert.ok(executionId, "pending extension input must remain stoppable");
    assert.equal(await supervisor.stop(session.sessionId, executionId), "stopped");
    await assert.rejects(supervisor.respondExtension(session.sessionId, requestId, { value: "alpha" }),
      /no longer pending/);
    assert.equal(supervisor.getSession(session.sessionId)?.pid, session.pid);
  } finally { await supervisor.dispose(); await rm(root, { recursive: true, force: true }); }
});

test("cancelled Pi UI prompt cannot receive a stale answer after public bridge reload", { timeout: 30_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-native-extension-reload-"));
  const supervisor = new PiSessionSupervisor({
    piEntry: fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent/rpc-entry")),
    env: { PI_CODING_AGENT_DIR: join(root, "profile"), PI_TELEMETRY: "0" },
    rpcArgs: ["--offline", "--no-extensions", "-e",
      fileURLToPath(new URL("../src/pi-agent/pi-control-bridge-extension.ts", import.meta.url)), "-e",
      fileURLToPath(new URL("./fixtures/pi-ui-sequence.ts", import.meta.url)),
      "--no-skills", "--no-prompt-templates", "--no-context-files"],
  });
  try {
    const session = await supervisor.createSession(root);
    let cancelledId: string | undefined;
    let finished = false;
    supervisor.on("record", (sessionId, event) => {
      if (sessionId !== session.sessionId) return;
      if (event.method === "select" && typeof event.id === "string") {
        cancelledId = event.id;
        void supervisor.respondExtension(sessionId, event.id, { cancelled: true });
      } else if (event.method === "confirm" && typeof event.id === "string") {
        void supervisor.respondExtension(sessionId, event.id, { confirmed: false });
      } else if ((event.method === "input" || event.method === "editor") && typeof event.id === "string") {
        void supervisor.respondExtension(sessionId, event.id, { value: "" });
      } else if (event.method === "notify" && typeof event.message === "string" &&
        event.message.startsWith("PI_UI_RESULT:")) finished = true;
    });
    await supervisor.command(session.sessionId, { type: "prompt", message: "/pi-ui-sequence" });
    for (let count = 0; count < 150 && !finished; count++) await new Promise(resolve => setTimeout(resolve, 20));
    assert.ok(finished);
    assert.ok(cancelledId);
    const before = await supervisor.readControlBridge(session.sessionId);
    const after = await supervisor.runControlBridge(session.sessionId, { operation: "reload",
      generation: before.info.generation, sessionId: session.sessionId });
    assert.notEqual(after.info.generation, before.info.generation);
    assert.equal(supervisor.getSession(session.sessionId)?.pid, session.pid);
    await assert.rejects(supervisor.respondExtension(session.sessionId, cancelledId, { value: "beta" }),
      /no longer pending/);
  } finally { await supervisor.dispose(); await rm(root, { recursive: true, force: true }); }
});
