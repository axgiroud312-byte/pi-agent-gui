import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { PiSessionSupervisor } from "../src/pi-agent/pi-session-supervisor.js";

test("supervisor owns independent pinned Pi processes and stops one without affecting the other", { timeout: 30_000 }, async () => {
  const workspacePath = await mkdtemp(join(tmpdir(), "pi-native-supervisor-"));
  const piEntry = fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent/rpc-entry"));
  const supervisor = new PiSessionSupervisor({
    piEntry,
    env: { PI_CODING_AGENT_DIR: join(workspacePath, "profile"), PI_TELEMETRY: "0" },
    rpcArgs: ["--offline", "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-context-files"],
  });
  try {
    const [first, second] = await Promise.all([
      supervisor.createSession(workspacePath),
      supervisor.createSession(workspacePath),
    ]);
    assert.notEqual(first.sessionId, second.sessionId);
    assert.notEqual(first.sessionFile, second.sessionFile);
    assert.notEqual(first.pid, second.pid);
    assert.equal((await supervisor.getState(first.sessionId)).sessionId, first.sessionId);
    assert.deepEqual(await supervisor.getMessages(second.sessionId), []);
    await supervisor.stop(first.sessionId);
    assert.equal(supervisor.getSession(first.sessionId)?.phase, "stopped");
    assert.equal((await supervisor.getState(second.sessionId)).sessionId, second.sessionId);
    await supervisor.closeSession(first.sessionId);
    assert.equal(supervisor.getSession(first.sessionId), undefined);
    assert.equal(supervisor.getSession(second.sessionId)?.pid, second.pid);
  } finally {
    await supervisor.dispose();
    await rm(workspacePath, { recursive: true, force: true });
  }
});
