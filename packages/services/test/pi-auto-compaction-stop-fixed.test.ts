import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { createServer, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { PiSessionSupervisor } from "../src/pi-agent/pi-session-supervisor.js";

test("fixed Pi overflow compaction Stop cancels the summary without a late retry", { timeout: 45_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-auto-compact-stop-"));
  const profile = join(root, "profile");
  let modelRequests = 0;
  let heldSummary: ServerResponse | undefined;
  const server = createServer(async (request, response) => {
    for await (const _ of request) { /* drain the model request */ }
    modelRequests++;
    if (modelRequests === 3) {
      response.writeHead(400, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: { message: "Your input exceeds the context window of this model",
        type: "invalid_request_error" } }));
      return;
    }
    response.writeHead(200, { "content-type": "text/event-stream" });
    if (modelRequests > 3) { heldSummary = response; response.flushHeaders(); return; }
    for (const [delta, finishReason] of [[{ role: "assistant", content: "PI_REPLY" }, null], [{}, "stop"]] as const) {
      response.write(`data: ${JSON.stringify({ id: "auto-compact-stop", object: "chat.completion.chunk", created: 1,
        model: "auto-compact-stop", choices: [{ index: 0, delta, finish_reason: finishReason }] })}\n\n`);
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
      "auto-compact-stop": { baseUrl: `http://127.0.0.1:${address.port}/v1`, api: "openai-completions",
        apiKey: "local-test-only", models: [{ id: "auto-compact-stop" }] },
    } }));
    await writeFile(join(profile, "settings.json"), JSON.stringify({ compaction: {
      enabled: true, keepRecentTokens: 1, reserveTokens: 1000 }, retry: { enabled: false } }));
    supervisor = new PiSessionSupervisor({
      piEntry: fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent/rpc-entry")),
      env: { PI_CODING_AGENT_DIR: profile, PI_TELEMETRY: "0" },
      rpcArgs: ["--offline", "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-context-files",
        "--provider", "auto-compact-stop", "--model", "auto-compact-stop"],
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
    for (const prompt of ["first turn before overflow", "second turn before overflow"]) {
      await supervisor.sendText(session.sessionId, prompt);
      await settled();
    }
    await supervisor.sendText(session.sessionId, "third turn triggers overflow");
    for (let i = 0; i < 200 && !heldSummary; i++) await new Promise(resolve => setTimeout(resolve, 50));
    assert(heldSummary, "fixed Pi must start the automatic overflow summary");
    assert.equal(supervisor.getSession(session.sessionId)?.phase, "compacting");
    const executionId = supervisor.getSession(session.sessionId)?.foregroundExecutionId;
    assert.ok(executionId, "the recovering Pi run must retain its Stop identity");
    assert.equal(await supervisor.stop(session.sessionId, executionId), "stopped");
    assert.equal(supervisor.getSession(session.sessionId)?.phase, "stopped");
    assert.equal((await supervisor.getState(session.sessionId)).isCompacting, false);
    await new Promise(resolve => setTimeout(resolve, 250));
    assert.equal(modelRequests, 4, "Pi must not make a late model retry after Stop");
    const entries = await supervisor.command(session.sessionId, { type: "get_entries" }) as {
      entries: Array<{ type: string; message?: { role?: string } }> };
    assert.equal(entries.entries.some(entry => entry.type === "compaction"), false,
      "an aborted automatic summary must not be persisted as a successful compaction");
    assert.equal(entries.entries.filter(entry => entry.type === "message" && entry.message?.role === "user").length, 3,
      "the user input must remain in Pi history");
  } finally {
    heldSummary?.end();
    await supervisor?.dispose();
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
});
