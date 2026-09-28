import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { PiRpcClient } from "../src/pi-agent/pi-rpc-client.js";
import { PiControlBridge } from "../src/pi-agent/pi-control-bridge.js";

test("pinned Pi public bridge uses its llama.cpp auth and refreshes its provider catalog", { timeout: 60_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-llama-bridge-"));
  let loaded = false;
  const requests: string[] = [];
  const router = createServer((request, response) => {
    requests.push(request.url ?? "");
    response.setHeader("Content-Type", "application/json");
    if (request.url === "/models") {
      response.end(JSON.stringify({ data: [{ id: "test.gguf", status: { value: loaded ? "loaded" : "unloaded" },
        size: 1024, parameters: { n_ctx: 2048 } }] }));
    } else if (request.url?.startsWith("/props")) {
      response.end(JSON.stringify({ models_autoload: false, chat_template: "chatml" }));
    } else { response.statusCode = 404; response.end("{}"); }
  });
  let client: PiRpcClient | undefined;
  let bridge: PiControlBridge | undefined;
  try {
    await new Promise<void>(resolve => router.listen(0, "127.0.0.1", resolve));
    const address = router.address(); assert(address && typeof address !== "string");
    const url = `http://127.0.0.1:${address.port}`;
    const cli = fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent/rpc-entry"));
    const extension = fileURLToPath(new URL("../src/pi-agent/pi-control-bridge-extension.ts", import.meta.url));
    client = new PiRpcClient({ executable: process.execPath,
      args: [cli, "--offline", "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-context-files",
        "--extension", extension], cwd: root,
      env: { PI_CODING_AGENT_DIR: join(root, "profile"), PI_TELEMETRY: "0",
        LLAMA_BASE_URL: url, LLAMA_API_KEY: "bridge-test-key" } });
    await client.start();
    bridge = new PiControlBridge(client);
    const auth = await bridge.getLlamaAuth();
    assert.equal(auth.serverUrl, url);
    assert.equal(auth.apiKey, "bridge-test-key");
    const before = await client.request({ type: "get_available_models" });
    assert.equal(before.success, true, before.error);
    assert.equal((before.data as { models: Array<{ id: string }> }).models.some(model => model.id === "test.gguf"), false);
    loaded = true;
    await bridge.refreshLlamaModels();
    const after = await client.request({ type: "get_available_models" });
    assert.equal(after.success, true, after.error);
    assert.equal((after.data as { models: Array<{ provider: string; id: string }> }).models
      .some(model => model.provider === "llama.cpp" && model.id === "test.gguf"), true);
    assert(requests.some(path => path === "/models"));
  } finally {
    bridge?.dispose(); await client?.dispose();
    router.closeAllConnections(); await new Promise<void>(resolve => router.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
});
