import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
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
    assert.equal(stop.status, "accepted", stop.message);
    assert.equal(supervisor.getSession(sessionId)?.phase, "stopped");
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
