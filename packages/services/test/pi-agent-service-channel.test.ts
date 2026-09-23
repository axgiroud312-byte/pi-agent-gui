import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { ProxyChannel } from "@zcode/rpc";
import type { ZCodeAgentRuntimeLifecycleEvent } from "../src/zcode-agent/zcodeAgent.js";
import { createPiAgentService } from "../src/pi-agent/pi-agent-service.js";
import { PiSessionSupervisor } from "../src/pi-agent/pi-session-supervisor.js";

test("Host channel subscribes to real Pi lifecycle events without a legacy Agent", { timeout: 60_000 }, async () => {
  const workspacePath = await mkdtemp(join(tmpdir(), "pi-agent-channel-"));
  const piEntry = fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent/rpc-entry"));
  const supervisor = new PiSessionSupervisor({ piEntry,
    env: { PI_CODING_AGENT_DIR: join(workspacePath, "profile"), PI_TELEMETRY: "0" },
    rpcArgs: ["--offline", "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-context-files"],
  });
  const service = createPiAgentService(piEntry, supervisor);
  const channel = ProxyChannel.fromService<string>(service);
  const events: ZCodeAgentRuntimeLifecycleEvent[] = [];
  const restarted: { workspaceKey: string }[] = [];
  const lifecycle = channel.listen<ZCodeAgentRuntimeLifecycleEvent>("host", "onAgentRuntimeLifecycle")(event => events.push(event));
  const restart = channel.listen<{ workspaceKey: string }>("host", "onAgentRuntimeRestarted")(event => restarted.push(event));
  assert.throws(() => channel.listen("host", "onDynamicMcpTelemetry"),
    /Pi Agent service does not implement onDynamicMcpTelemetry/);
  await assert.rejects(channel.call("host", "sendPrompt", []),
    /Pi Agent service does not implement sendPrompt/);
  const target = { workspacePath };
  const create = async () => {
    const result = await service.sendConversationCommandV4({ ...target, envelope: {
      commandId: randomUUID(), clientId: "channel-test", sessionId: null, type: "createSession",
      issuedAt: Date.now(), payload: { workspaceId: workspacePath },
    } });
    assert.equal(result.status, "accepted", result.message);
    assert.equal(result.result?.type, "createSession");
    if (result.result?.type !== "createSession") throw new Error("No Pi session created");
    return result.result.sessionId;
  };
  const remove = async (sessionId: string) => {
    const result = await service.sendConversationCommandV4({ ...target, envelope: {
      commandId: randomUUID(), clientId: "channel-test", sessionId, type: "deleteSession",
      issuedAt: Date.now(), payload: {},
    } });
    assert.equal(result.status, "accepted", result.message);
  };
  try {
    const index = await service.subscribeSessionsIndexV4(target);
    assert.equal(index.ack.mode, "snapshot");
    assert.deepEqual(events.map(event => event.state), ["available"]);
    const first = await create();
    assert.deepEqual(events.map(event => event.state), ["available"]);
    assert.equal(events[0]?.workspaceKey, workspacePath);
    assert.equal(events[0]?.runtimeIdentity.generation, 1);
    const second = await create();
    assert.equal(events.length, 1, "second Pi process must not replace the workspace channel");
    await remove(first);
    assert.equal(events.length, 1, "remaining Pi process still owns the workspace");
    await remove(second);
    assert.deepEqual(events.map(event => event.state), ["available"],
      "deleting drafts must not tear down the workspace service");
    await create();
    assert.deepEqual(events.map(event => event.state), ["available"]);
    assert.deepEqual(restarted, [], "Pi child churn is not a Host runtime restart");
    await supervisor.dispose();
    service.disposeAll();
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(events.map(event => event.state), ["available", "unavailable"]);
  } finally {
    lifecycle.dispose();
    restart.dispose();
    await supervisor.dispose();
    service.disposeAll();
    await rm(workspacePath, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
