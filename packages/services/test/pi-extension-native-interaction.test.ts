import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { PiSessionSupervisor } from "../src/pi-agent/pi-session-supervisor.js";
import { PiNativeV4Service } from "../src/pi-agent/pi-native-v4-service.js";

async function removeOwnedTestRoot(root: string): Promise<void> {
  const absolute = resolve(root);
  assert(absolute.startsWith(`${resolve(tmpdir())}${sep}`) &&
    basename(absolute).startsWith("pi-native-extension-"),
  "Only an owned extension test fixture inside the OS temporary directory may be removed");
  await rm(absolute, { recursive: true, force: true });
}

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
      await removeOwnedTestRoot(root);
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
  } finally { await supervisor.dispose(); await removeOwnedTestRoot(root); }
});

test("native Stop overtakes a sendText command waiting for Pi extension input",
  { timeout: 30_000 }, async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-native-extension-stop-service-"));
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
        commandId: randomUUID(), clientId: "stop-test", sessionId: null, issuedAt: Date.now(),
        type: "createSession", payload: { workspaceId: root },
      } });
      assert.equal(created.result?.type, "createSession");
      if (created.result?.type !== "createSession") throw new Error("session not created");
      const sessionId = created.result.sessionId;
      const send = service.sendConversationCommandV4({ workspacePath: root, envelope: {
        commandId: randomUUID(), clientId: "stop-test", sessionId, issuedAt: Date.now(),
        type: "sendText", payload: { text: "/pi-ui-sequence", requestedDelivery: "startNow" },
      } });
      void send.catch(() => {});
      let interactionId: string | undefined;
      for (let count = 0; count < 200; count++) {
        const sessions = (service as unknown as { sessions: Map<string, { snapshot: {
          pendingInteractions: Array<{ interactionId: string }> } }> }).sessions;
        interactionId = sessions.get(sessionId)?.snapshot.pendingInteractions[0]?.interactionId;
        if (interactionId) break;
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      assert.ok(interactionId, "Pi select dialog must be pending before Stop");
      const executionId = supervisor.getSession(sessionId)?.foregroundExecutionId;
      assert.ok(executionId);
      const stop = service.sendConversationCommandV4({ workspacePath: root, envelope: {
        commandId: randomUUID(), clientId: "stop-test", sessionId, issuedAt: Date.now(),
        type: "stop", payload: { expectedForegroundExecutionId: executionId },
      } });
      const stopped = await Promise.race([
        stop,
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error(
          "native Stop was serialized behind the pending extension input")), 3_000)),
      ]);
      assert.equal(stopped.status, "accepted", stopped.message);
      assert.equal((await send).status, "accepted");
      const sessions = (service as unknown as { sessions: Map<string, { snapshot: {
        pendingInteractions: Array<{ interactionId: string }>;
        inputRouting: { mode: string };
      }; state: { piPendingIntent?: unknown } }> }).sessions;
      assert.deepEqual(sessions.get(sessionId)?.snapshot.pendingInteractions, [],
        "native Stop must project dialog removal to the GUI");
      assert.equal(sessions.get(sessionId)?.snapshot.inputRouting.mode, "startNow",
        "stopped extension command must not block the next Pi input");
      const late = await service.sendConversationCommandV4({ workspacePath: root, envelope: {
        commandId: randomUUID(), clientId: "stop-test", sessionId, issuedAt: Date.now(),
        type: "resolveInteraction", payload: { interactionId, answer: { optionId: "alpha" } },
      } });
      assert.equal(late.status, "noop", "stopped dialog must not accept a late answer");
      assert.equal(supervisor.getSession(sessionId)?.phase, "stopped");
      const pid = supervisor.getSession(sessionId)?.pid;
      const seen: string[] = [];
      supervisor.on("record", (id, event) => {
        if (id !== sessionId || event.type !== "extension_ui_request" || typeof event.id !== "string" ||
          !["select", "confirm", "input", "editor"].includes(String(event.method))) return;
        seen.push(String(event.method));
        void supervisor.respondExtension(id, event.id,
          event.method === "confirm" ? { confirmed: false } : { value: "alpha" }).catch(() => {});
      });
      const next = await service.sendConversationCommandV4({ workspacePath: root, envelope: {
        commandId: randomUUID(), clientId: "stop-test", sessionId, issuedAt: Date.now(),
        type: "sendText", payload: { text: "/pi-ui-sequence", requestedDelivery: "startNow" },
      } });
      assert.equal(next.status, "accepted", next.message);
      assert.deepEqual(seen, ["select", "confirm", "input", "editor"]);
      assert.equal(supervisor.getSession(sessionId)?.pid, pid);
    } finally {
      await service.dispose();
      await removeOwnedTestRoot(root);
    }
  });

for (const method of ["select", "confirm", "input", "editor"] as const) {
  test(`Stop rejects a ${method} answer arriving while Pi cancellation is being sent`,
    { timeout: 30_000 }, async () => {
      const root = await mkdtemp(join(tmpdir(), `pi-native-extension-stop-race-${method}-`));
      const supervisor = new PiSessionSupervisor({
        piEntry: fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent/rpc-entry")),
        env: { PI_CODING_AGENT_DIR: join(root, "profile"), PI_TELEMETRY: "0" },
        rpcArgs: ["--offline", "--no-extensions", "-e",
          fileURLToPath(new URL("./fixtures/pi-ui-sequence.ts", import.meta.url)),
          "--no-skills", "--no-prompt-templates", "--no-context-files"],
      });
      let releaseCancel = () => {};
      try {
        const session = await supervisor.createSession(root);
        const ordered = ["select", "confirm", "input", "editor"] as const;
        let reached!: (id: string) => void;
        const pending = new Promise<string>(resolve => { reached = resolve; });
        supervisor.on("record", (id, event) => {
          if (id !== session.sessionId || event.type !== "extension_ui_request" ||
            typeof event.id !== "string") return;
          if (event.method === method) reached(event.id);
          else if (ordered.indexOf(event.method as typeof method) < ordered.indexOf(method)) {
            const response = event.method === "confirm" ? { confirmed: false } : { value: "alpha" };
            void supervisor.respondExtension(id, event.id, response).catch(() => {});
          }
        });
        const command = supervisor.sendText(session.sessionId, "/pi-ui-sequence");
        void command.catch(() => {});
        const requestId = await pending;
        const runtime = (supervisor as unknown as { sessions: Map<string, { client: {
          notify: (response: Record<string, unknown>) => Promise<void>;
        } }> }).sessions.get(session.sessionId);
        assert.ok(runtime);
        const originalNotify = runtime.client.notify.bind(runtime.client);
        let entered!: () => void;
        const cancelling = new Promise<void>(resolve => { entered = resolve; });
        const gate = new Promise<void>(resolve => { releaseCancel = resolve; });
        runtime.client.notify = async response => {
          if (response.type === "extension_ui_response" && response.cancelled === true &&
            response.id === requestId) {
            entered();
            await gate;
          }
          return originalNotify(response);
        };
        const executionId = supervisor.getSession(session.sessionId)?.foregroundExecutionId;
        assert.ok(executionId);
        const stopping = supervisor.stop(session.sessionId, executionId);
        void stopping.catch(() => {});
        await cancelling;
        const late = method === "confirm" ? { confirmed: true } : { value: "beta" };
        await assert.rejects(supervisor.respondExtension(session.sessionId, requestId, late),
          /no longer pending|stopping/);
        releaseCancel();
        assert.equal(await stopping, "stopped");
        assert.equal(supervisor.getSession(session.sessionId)?.pid, session.pid);
      } finally {
        releaseCancel();
        await supervisor.dispose();
        await removeOwnedTestRoot(root);
      }
    });
}

test("Stop drains later Pi dialogs before reporting stopped and the next command can ask again",
  { timeout: 30_000 }, async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-native-extension-stop-cascade-"));
    const supervisor = new PiSessionSupervisor({
      piEntry: fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent/rpc-entry")),
      env: { PI_CODING_AGENT_DIR: join(root, "profile"), PI_TELEMETRY: "0" },
      rpcArgs: ["--offline", "--no-extensions", "-e",
        fileURLToPath(new URL("./fixtures/pi-ui-sequence.ts", import.meta.url)),
        "--no-skills", "--no-prompt-templates", "--no-context-files"],
    });
    try {
      const session = await supervisor.createSession(root);
      const seen: string[] = [];
      let first!: (id: string) => void;
      const firstDialog = new Promise<string>(resolve => { first = resolve; });
      let answerNext = false;
      supervisor.on("record", (id, event) => {
        if (id !== session.sessionId || event.type !== "extension_ui_request" ||
          typeof event.id !== "string" || !["select", "confirm", "input", "editor"].includes(String(event.method))) return;
        seen.push(String(event.method));
        if (!answerNext) first(event.id);
        else void supervisor.respondExtension(id, event.id,
          event.method === "confirm" ? { confirmed: false } : { value: "alpha" }).catch(() => {});
      });
      const command = supervisor.sendText(session.sessionId, "/pi-ui-sequence");
      void command.catch(() => {});
      await firstDialog;
      const executionId = supervisor.getSession(session.sessionId)?.foregroundExecutionId;
      assert.ok(executionId);
      assert.equal(await supervisor.stop(session.sessionId, executionId), "stopped");
      await command;
      assert.deepEqual(seen, ["select"], "later dialogs of the stopped extension must not reach the UI");
      assert.equal(supervisor.getSession(session.sessionId)?.phase, "stopped");
      assert.equal(supervisor.getSession(session.sessionId)?.pid, session.pid);
      answerNext = true;
      assert.equal(await supervisor.sendText(session.sessionId, "/pi-ui-sequence"), "handledCommand");
      assert.deepEqual(seen.slice(1), ["select", "confirm", "input", "editor"]);
    } finally {
      await supervisor.dispose();
      await removeOwnedTestRoot(root);
    }
  });

test("Stop holds newly arrived extension requests until Pi queue pause is confirmed",
  { timeout: 30_000 }, async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-native-extension-stop-queue-order-"));
    const supervisor = new PiSessionSupervisor({
      piEntry: fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent/rpc-entry")),
      env: { PI_CODING_AGENT_DIR: join(root, "profile"), PI_TELEMETRY: "0" },
      rpcArgs: ["--offline", "--no-extensions", "-e",
        fileURLToPath(new URL("./fixtures/pi-ui-parallel-stop.ts", import.meta.url)),
        "--no-skills", "--no-prompt-templates", "--no-context-files"],
    });
    let releasePause = () => {};
    try {
      const session = await supervisor.createSession(root);
      const runtime = (supervisor as unknown as { sessions: Map<string, { client: {
        notify: (response: Record<string, unknown>) => Promise<void>;
        on: (event: string, handler: (record: Record<string, unknown>) => void) => void;
      } }> }).sessions.get(session.sessionId);
      assert.ok(runtime);
      const originalNotify = runtime.client.notify.bind(runtime.client);
      const originalCatalog = supervisor.getQueueCatalog.bind(supervisor);
      let pauseReached!: () => void;
      const waitingForPause = new Promise<void>(resolve => { pauseReached = resolve; });
      const pauseGate = new Promise<void>(resolve => { releasePause = resolve; });
      supervisor.getQueueCatalog = async id => {
        pauseReached();
        await pauseGate;
        return originalCatalog(id);
      };
      const cancelled: string[] = [];
      runtime.client.notify = async response => {
        if (response.type === "extension_ui_response" && response.cancelled === true) {
          cancelled.push(String(response.id));
        }
        return originalNotify(response);
      };
      let first!: (id: string) => void;
      let second!: (id: string) => void;
      const firstDialog = new Promise<string>(resolve => { first = resolve; });
      const secondDialog = new Promise<string>(resolve => { second = resolve; });
      runtime.client.on("record", record => {
        if (record.method === "select" && typeof record.id === "string") first(record.id);
        if (record.method === "input" && typeof record.id === "string") second(record.id);
      });
      const command = supervisor.sendText(session.sessionId, "/pi-ui-parallel-stop");
      void command.catch(() => {});
      const firstId = await firstDialog;
      const executionId = supervisor.getSession(session.sessionId)?.foregroundExecutionId;
      assert.ok(executionId);
      const stopping = supervisor.stop(session.sessionId, executionId);
      void stopping.catch(() => {});
      await waitingForPause;
      const secondId = await secondDialog;
      assert(!cancelled.includes(firstId) && !cancelled.includes(secondId),
        "extension answers must remain blocked until Pi owns a paused queue");
      releasePause();
      assert.equal(await stopping, "stopped");
      await command;
      assert(cancelled.includes(firstId) && cancelled.includes(secondId));
    } finally {
      releasePause();
      await supervisor.dispose();
      await removeOwnedTestRoot(root);
    }
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
  } finally { await supervisor.dispose(); await removeOwnedTestRoot(root); }
});
