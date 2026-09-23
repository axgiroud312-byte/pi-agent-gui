import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { PiRpcClient } from "../src/pi-agent/pi-rpc-client.js";

test("pinned Pi RPC runs two isolated native sessions", { timeout: 30_000 }, async () => {
  const sandbox = await mkdtemp(join(tmpdir(), "pi-native-rpc-"));
  const cli = fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent/rpc-entry"));
  const sessionIds = [randomUUID(), randomUUID()];
  const clients = sessionIds.map(sessionId => new PiRpcClient({
    executable: process.execPath,
    args: [cli, "--session-id", sessionId, "--offline", "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-context-files"],
    cwd: sandbox,
    env: { PI_CODING_AGENT_DIR: join(sandbox, "profile"), PI_TELEMETRY: "0" },
  }));

  try {
    await Promise.all(clients.map(client => client.start()));
    assert.notEqual(clients[0]?.pid, clients[1]?.pid);
    const states = await Promise.all(clients.map(client => client.request({ type: "get_state" }, 15_000)));
    for (const [index, response] of states.entries()) {
      assert.equal(response.success, true, response.error);
      const state = response.data as Record<string, unknown>;
      assert.equal(state.sessionId, sessionIds[index]);
      assert.equal(state.isStreaming, false);
      assert.equal(typeof state.sessionFile, "string");
    }
    assert.notEqual((states[0]!.data as Record<string, unknown>).sessionFile, (states[1]!.data as Record<string, unknown>).sessionFile);

    const shell = await clients[0]!.request({ type: "bash", command: "echo PI_RPC_BASH_OK" }, 15_000);
    assert.equal(shell.success, true, shell.error);
    assert.match(JSON.stringify(shell.data), /PI_RPC_BASH_OK/);
    const other = await clients[1]!.request({ type: "get_state" });
    assert.equal((other.data as Record<string, unknown>).sessionId, sessionIds[1]);
    assert.equal((other.data as Record<string, unknown>).isStreaming, false);
  } finally {
    await Promise.all(clients.map(client => client.dispose()));
    await rm(sandbox, { recursive: true, force: true });
  }
});
