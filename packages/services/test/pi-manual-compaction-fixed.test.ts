import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { createServer, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { PiSessionSupervisor } from "../src/pi-agent/pi-session-supervisor.js";

test("fixed Pi manual compaction Stop aborts a pending summary and preserves history", { timeout: 45_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-compact-stop-real-"));
  const profile = join(root, "profile");
  let modelRequests = 0;
  let heldSummary: ServerResponse | undefined;
  const server = createServer(async (request, response) => {
    for await (const _ of request) { /* drain the model request */ }
    modelRequests++;
    response.writeHead(200, { "content-type": "text/event-stream" });
    if (modelRequests > 2) { heldSummary = response; response.flushHeaders(); return; }
    for (const [delta, finishReason] of [[{ role: "assistant", content: "PI_REPLY" }, null], [{}, "stop"]] as const) {
      response.write(`data: ${JSON.stringify({ id: "compact-stop", object: "chat.completion.chunk", created: 1,
        model: "compact-stop", choices: [{ index: 0, delta, finish_reason: finishReason }] })}\n\n`);
    }
    response.end("data: [DONE]\n\n");
  });
  let supervisor: PiSessionSupervisor | undefined;
  try {
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    assert(address && typeof address !== "string");
    await mkdir(profile);
    await writeFile(join(profile, "models.json"), JSON.stringify({ providers: {
      "compact-stop": { baseUrl: `http://127.0.0.1:${address.port}/v1`, api: "openai-completions",
        apiKey: "local-test-only", models: [{ id: "compact-stop" }] },
    } }));
    await writeFile(join(profile, "settings.json"), JSON.stringify({ compaction: {
      enabled: true, keepRecentTokens: 1, reserveTokens: 1000 }, retry: { enabled: false } }));
    supervisor = new PiSessionSupervisor({
      piEntry: fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent/rpc-entry")),
      env: { PI_CODING_AGENT_DIR: profile, PI_TELEMETRY: "0" },
      rpcArgs: ["--offline", "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-context-files",
        "--provider", "compact-stop", "--model", "compact-stop"],
    });
    const session = await supervisor.createSession(root);
    const settled = async () => {
      if (supervisor!.getSession(session.sessionId)?.phase === "settled") return;
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => { supervisor!.off("change", onChange); reject(new Error("Pi did not settle")); }, 10_000);
        const onChange = (view: { sessionId: string; phase: string }) => {
          if (view.sessionId === session.sessionId && view.phase === "settled") {
            clearTimeout(timer); supervisor!.off("change", onChange); resolve();
          }
        };
        supervisor!.on("change", onChange);
      });
    };
    for (const prompt of ["first turn before compaction", "second turn remains"]) {
      await supervisor.sendText(session.sessionId, prompt);
      await settled();
    }
    const compact = supervisor.compact(session.sessionId);
    for (let i = 0; i < 100 && !heldSummary; i++) await new Promise(resolve => setTimeout(resolve, 50));
    assert(heldSummary, "fixed Pi must reach the controlled summary request");
    const executionId = supervisor.getSession(session.sessionId)?.foregroundExecutionId;
    assert.ok(executionId);
    assert.equal(await supervisor.stop(session.sessionId, executionId), "stopped");
    await compact;
    assert.equal(supervisor.getSession(session.sessionId)?.phase, "stopped");
    assert.equal((await supervisor.getState(session.sessionId)).isCompacting, false);
    const entries = await supervisor.command(session.sessionId, { type: "get_entries" }) as {
      entries: Array<{ type: string }> };
    assert.equal(entries.entries.some(entry => entry.type === "compaction"), false,
      "an aborted summary must never become a Pi history success");
  } finally {
    heldSummary?.end();
    await supervisor?.dispose();
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
});
