import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { PiSessionSupervisor } from "../src/pi-agent/pi-session-supervisor.js";

test("fixed Pi owns shell output, context exclusion, Stop and other-session isolation", { timeout: 45_000 }, async () => {
  const workspacePath = await mkdtemp(join(tmpdir(), "pi-shell-control-"));
  const supervisor = new PiSessionSupervisor({
    piEntry: fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent/rpc-entry")),
    env: { PI_CODING_AGENT_DIR: join(workspacePath, "profile"), PI_TELEMETRY: "0" },
    rpcArgs: ["--offline", "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-context-files"],
  });
  try {
    const first = await supervisor.createSession(workspacePath);
    const other = await supervisor.createSession(workspacePath);
    const included = await supervisor.runBash(first.sessionId, "echo PI_CONTEXT_INCLUDED", false);
    assert.equal(included.exitCode, 0);
    assert.match(included.output, /PI_CONTEXT_INCLUDED/);
    assert.equal(included.cancelled, false);
    const excluded = await supervisor.runBash(first.sessionId, "echo PI_CONTEXT_EXCLUDED", true);
    assert.equal(excluded.exitCode, 0);
    assert.match(excluded.output, /PI_CONTEXT_EXCLUDED/);
    const history = await supervisor.getMessages(first.sessionId) as Array<Record<string, unknown>>;
    const shell = history.filter(message => message.role === "bashExecution");
    assert.deepEqual(shell.map(message => [message.command, message.excludeFromContext, message.exitCode]), [
      ["echo PI_CONTEXT_INCLUDED", false, 0],
      ["echo PI_CONTEXT_EXCLUDED", true, 0],
    ]);
    assert.deepEqual(await supervisor.getMessages(other.sessionId), []);

    const pending = supervisor.runBash(first.sessionId,
      'node -e "setTimeout(() => process.stdout.write(\'LATE_SHELL_OUTPUT\'), 30000)"', false);
    const executionId = supervisor.getSession(first.sessionId)?.foregroundExecutionId;
    assert.ok(executionId, "direct Pi bash must give native Stop an execution identity");
    const started = Date.now();
    assert.equal(await supervisor.stop(first.sessionId, executionId), "stopped");
    assert.ok(Date.now() - started < 10_000, "Stop should not wait for the long shell command");
    assert.equal((await pending).cancelled, true);
    assert.equal(supervisor.getSession(first.sessionId)?.phase, "stopped");
    assert.equal((await supervisor.getState(other.sessionId)).sessionId, other.sessionId);
  } finally {
    await supervisor.dispose();
    await rm(workspacePath, { recursive: true, force: true });
  }
});
