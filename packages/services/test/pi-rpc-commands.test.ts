import assert from "node:assert/strict";
import { on } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { PiRpcClient } from "../src/pi-agent/pi-rpc-client.js";

test("real Pi 0.87.0 lists resource commands, not TUI /compact; compact is a separate RPC", { timeout: 30_000 }, async () => {
  const cli = fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent/rpc-entry"));
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.resolve("@earendil-works/pi-coding-agent")), "utf8"));
  assert.equal(pkg.version, "0.87.0");
  const sandbox = await mkdtemp(join(tmpdir(), "pi-native-commands-"));
  const profile = join(sandbox, "profile");
  const requests: { messages: { role: string; content: unknown }[] }[] = [];
  // Only the model wire boundary is controlled. Command discovery, prompt
  // expansion, compaction and all events below run inside the real Pi process.
  const server = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    requests.push(JSON.parse(raw));
    res.writeHead(200, { "content-type": "text/event-stream" });
    for (const [delta, finish_reason] of [[{ role: "assistant", content: "COMMAND_CONTRACT_REPLY" }, null], [{}, "stop"]]) {
      res.write(`data: ${JSON.stringify({ id: "contract", object: "chat.completion.chunk", created: 1,
        model: "commands-contract", choices: [{ index: 0, delta, finish_reason }] })}\n\n`);
    }
    res.end("data: [DONE]\n\n");
  });
  let client: PiRpcClient | undefined;
  try {
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    assert(address && typeof address !== "string");
    await mkdir(profile);
    await writeFile(join(profile, "models.json"), JSON.stringify({ providers: {
      "commands-contract": { baseUrl: `http://127.0.0.1:${address.port}/v1`, api: "openai-completions",
        apiKey: "local-contract-not-a-secret", models: [{ id: "commands-contract" }] },
    } }));
    const template = join(sandbox, "contract-template.md");
    await writeFile(template, "---\ndescription: Isolated RPC command contract\n---\nEXPANDED_CONTRACT $1\n");
    client = new PiRpcClient({ executable: process.execPath,
      args: [cli, "--offline", "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-context-files",
        "--prompt-template", template, "--provider", "commands-contract", "--model", "commands-contract"],
      cwd: sandbox, env: { PI_CODING_AGENT_DIR: profile, PI_TELEMETRY: "0" },
    });
    const records: Record<string, unknown>[] = [];
    client.on("record", record => records.push(record));
    await client.start();
    const catalog = await client.request({ type: "get_commands" }, 15_000);
    assert.equal(catalog.success, true, catalog.error);
    const commands = (catalog.data as { commands: { name: string; source: string }[] }).commands;
    assert.deepEqual(commands.map(({ name, source }) => ({ name, source })), [
      // Pi's bundled llama.cpp extension is registered even with --no-extensions.
      { name: "llama", source: "extension" },
      { name: "contract-template", source: "prompt" },
    ]);
    for (const tuiCommand of ["compact", "model", "settings", "help"]) {
      assert.equal(commands.some(command => command.name === tuiCommand), false);
    }

    const compact = await client.request({ type: "compact" });
    assert.equal(compact.command, "compact");
    assert.equal(compact.success, false, "An empty session must not report fake compaction success");
    assert.match(compact.error ?? "", /Nothing to compact \(session too small\)/);
    assert(records.some(record => record.type === "compaction_start" && record.reason === "manual"));
    assert.deepEqual(records.find(record => record.type === "compaction_end"), {
      type: "compaction_end", reason: "manual", aborted: false, willRetry: false,
      errorMessage: "Compaction failed: Nothing to compact (session too small)",
    });
    assert.equal(requests.length, 0, "Empty compact must not invoke the model");
    const compactionEvents = records.filter(record => String(record.type).startsWith("compaction_")).length;

    for (const message of ["/compact", "/contract-template argument"]) {
      const settled = (async () => {
        for await (const [record] of on(client!, "record", { signal: AbortSignal.timeout(15_000) })) {
          if (record.type === "agent_settled") return;
        }
      })();
      const [response] = await Promise.all([client.request({ type: "prompt", message }), settled]);
      assert.equal(response.success, true, response.error);
    }
    assert.equal(requests.length, 2);
    assert.deepEqual(requests[0]!.messages.findLast(message => message.role === "user")?.content,
      [{ type: "text", text: "/compact" }]);
    assert.deepEqual(requests[1]!.messages.findLast(message => message.role === "user")?.content,
      [{ type: "text", text: "EXPANDED_CONTRACT argument" }]);
    assert.equal(records.filter(record => String(record.type).startsWith("compaction_")).length, compactionEvents,
      "Sending TUI /compact through prompt is literal model input, not manual compaction");
  } finally {
    await client?.dispose();
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(sandbox, { recursive: true, force: true });
  }
});
