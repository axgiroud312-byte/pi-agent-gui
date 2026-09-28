import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { PiMessageRows } from "../src/pi-agent/pi-message-rows.js";
import { PiSessionSupervisor } from "../src/pi-agent/pi-session-supervisor.js";

test("fixed Pi RPC persists both direct bash modes as native history messages", { timeout: 30_000 }, async () => {
  const workspace = await mkdtemp(join(tmpdir(), "pi-bash-message-"));
  const supervisor = new PiSessionSupervisor({
    piEntry: fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent/rpc-entry")),
    env: { PI_CODING_AGENT_DIR: join(workspace, "profile"), PI_TELEMETRY: "0" },
    rpcArgs: ["--offline", "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-context-files"],
  });
  try {
    const session = await supervisor.createSession(workspace);
    for (const [command, excludeFromContext] of [["echo PI_BASH_CONTEXT", false],
      ["echo PI_BASH_PRIVATE", true]] as const) {
      const result = await supervisor.command(session.sessionId, { type: "bash", command, excludeFromContext });
      assert.match(String((result as { output?: string }).output), new RegExp(command.split(" ")[1]));
    }
    const history = await supervisor.getHistoryMessages(session.sessionId);
    const bash = history.filter((message): message is Record<string, unknown> =>
      typeof message === "object" && message !== null && "role" in message && message.role === "bashExecution");
    assert.equal(bash.length, 2);
    assert.deepEqual(bash.map(message => [message.command, message.excludeFromContext,
      message.exitCode, message.cancelled]), [
      ["echo PI_BASH_CONTEXT", false, 0, false],
      ["echo PI_BASH_PRIVATE", true, 0, false],
    ]);
    const rows = new PiMessageRows().restore(history).filter(row => row.kind === "bashExecution");
    assert.equal(rows.length, 2);
    assert.deepEqual(rows.map(row => [row.command, row.excludeFromContext, row.exitCode]), [
      ["echo PI_BASH_CONTEXT", false, 0], ["echo PI_BASH_PRIVATE", true, 0],
    ]);
  } finally {
    await supervisor.dispose();
    await rm(workspace, { recursive: true, force: true });
  }
});
