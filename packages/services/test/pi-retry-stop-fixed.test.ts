import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { PiSessionSupervisor } from "../src/pi-agent/pi-session-supervisor.js";

test("fixed Pi retry backoff Stop cancels the retry without another provider request", { timeout: 30_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-retry-stop-"));
  const profile = join(root, "profile");
  let attempts = 0;
  const server = createServer(async (request, response) => {
    for await (const _ of request) { /* drain the model request */ }
    attempts++;
    response.writeHead(503, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: { message: "wait and retry", type: "server_error" } }));
  });
  let supervisor: PiSessionSupervisor | undefined;
  try {
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    assert(address && typeof address !== "string");
    await mkdir(profile);
    await writeFile(join(profile, "models.json"), JSON.stringify({ providers: {
      "retry-stop": { baseUrl: `http://127.0.0.1:${address.port}/v1`, api: "openai-completions",
        apiKey: "local-test-only", models: [{ id: "retry-stop" }] },
    } }));
    await writeFile(join(profile, "settings.json"), JSON.stringify({ retry: {
      enabled: true, maxRetries: 2, baseDelayMs: 5_000, provider: { maxRetries: 0 },
    } }));
    supervisor = new PiSessionSupervisor({
      piEntry: fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent/rpc-entry")),
      env: { PI_CODING_AGENT_DIR: profile, PI_TELEMETRY: "0" },
      rpcArgs: ["--offline", "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-context-files",
        "--provider", "retry-stop", "--model", "retry-stop"],
    });
    const session = await supervisor.createSession(root);
    const retryStarted = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { supervisor!.off("record", listener); reject(new Error("Pi did not retry")); }, 15_000);
      const listener = (id: string, record: { type: string }) => {
        if (id !== session.sessionId || record.type !== "auto_retry_start") return;
        clearTimeout(timer);
        supervisor!.off("record", listener);
        resolve();
      };
      supervisor!.on("record", listener);
    });
    await supervisor.sendText(session.sessionId, "stop before retry reaches provider");
    await retryStarted;
    assert.equal(attempts, 1);
    assert.equal(supervisor.getSession(session.sessionId)?.phase, "retrying");
    const executionId = supervisor.getSession(session.sessionId)?.foregroundExecutionId;
    assert.ok(executionId);
    assert.equal(await supervisor.stop(session.sessionId, executionId), "stopped");
    assert.equal(supervisor.getSession(session.sessionId)?.phase, "stopped");
    await new Promise(resolve => setTimeout(resolve, 250));
    assert.equal(attempts, 1, "Pi must not make a late retry after Stop");
    assert.equal((await supervisor.getState(session.sessionId)).isStreaming, false);
    const entries = await supervisor.command(session.sessionId, { type: "get_entries" }) as {
      entries: Array<{ type: string; message?: { role?: string } }> };
    assert.ok(entries.entries.some(entry => entry.type === "message" && entry.message?.role === "user"),
      "the stopped input remains in Pi history");
  } finally {
    await supervisor?.dispose();
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
});
