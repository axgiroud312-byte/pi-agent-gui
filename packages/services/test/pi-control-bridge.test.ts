import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { PiRpcClient } from "../src/pi-agent/pi-rpc-client.js";
import { PiControlBridge } from "../src/pi-agent/pi-control-bridge.js";

test("pinned Pi public bridge changes native tree, label and generation on reload", { timeout: 90_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-native-bridge-"));
  const profile = join(root, "profile");
  const calls: unknown[] = [];
  const server = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    calls.push(JSON.parse(raw));
    res.writeHead(200, { "content-type": "text/event-stream" });
    for (const [delta, finish_reason] of [[{ role: "assistant", content: "BRIDGE_MODEL_REPLY" }, null], [{}, "stop"]]) {
      res.write(`data: ${JSON.stringify({ id: "bridge", object: "chat.completion.chunk", created: 1,
        model: "bridge-model", choices: [{ index: 0, delta, finish_reason }] })}\n\n`);
    }
    res.end("data: [DONE]\n\n");
  });
  let client: PiRpcClient | undefined;
  let bridge: PiControlBridge | undefined;
  try {
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    assert(address && typeof address !== "string");
    await mkdir(profile);
    await writeFile(join(profile, "models.json"), JSON.stringify({ providers: {
      "bridge-provider": { baseUrl: `http://127.0.0.1:${address.port}/v1`, api: "openai-completions",
        apiKey: "local-test-only", models: [{ id: "bridge-model", input: ["text", "image"] }] },
    } }));
    await writeFile(join(profile, "settings.json"), JSON.stringify({ defaultProvider: "bridge-provider", defaultModel: "bridge-model" }));
    const cli = fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent/rpc-entry"));
    const extension = process.env.PI_CONTROL_EXTENSION_PATH ??
      fileURLToPath(new URL("../src/pi-agent/pi-control-bridge-extension.ts", import.meta.url));
    client = new PiRpcClient({ executable: process.execPath,
      args: [cli, "--offline", "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-context-files",
        "--extension", extension], cwd: root,
      env: { PI_CODING_AGENT_DIR: profile, PI_TELEMETRY: "0" },
    });
    await client.start();
    bridge = new PiControlBridge(client);
    const initial = await bridge.refresh();
    assert.equal(initial.info.piVersion, "0.87.0");
    assert.equal(initial.info.mode, "rpc");
    assert.equal(initial.info.protocol, 1);
    assert(initial.info.operations.includes("navigate"));
    assert(initial.info.operations.includes("label"));
    assert(initial.info.operations.includes("reload"));
    const sessionId = initial.info.sessionId;

    const prompt = async (message: string, images: Array<{ type: "image"; data: string; mimeType: string }> = []) => {
      const settled = new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => { client?.off("record", listener); reject(new Error("Pi did not settle")); }, 20_000);
        const listener = (record: Record<string, unknown>) => {
          if (record.type === "agent_settled") { clearTimeout(timer); client?.off("record", listener); resolve(); }
        };
        client?.on("record", listener);
      });
      const accepted = await client!.request({ type: "prompt", message, ...(images.length ? { images } : {}) });
      assert.equal(accepted.success, true, accepted.error);
      await settled;
    };
    await prompt("first native branch input");
    await prompt("second native branch input");
    assert.equal(calls.length, 2);
    const before = await bridge.refresh();
    const firstUser = before.entries.find(entry => entry.type === "message" && entry.message.role === "user");
    assert(firstUser && firstUser.type === "message");
    const originalLeaf = before.leafId;
    assert(originalLeaf);

    const labelled = await bridge.act({ operation: "label", targetId: firstUser.id, label: "checkpoint",
      sessionId, generation: before.info.generation });
    assert(labelled.entries.some(entry => entry.type === "label" && entry.targetId === firstUser.id && entry.label === "checkpoint"));
    const navigated = await bridge.act({ operation: "navigate", targetId: firstUser.id, summarize: false,
      sessionId, generation: labelled.info.generation });
    assert.equal(navigated.result?.editorText, "first native branch input");
    assert(navigated.entries.some(entry => entry.id === navigated.leafId && entry.type === "custom" &&
      entry.customType === "pi-agent-ide.tree-navigation.v1" && entry.parentId === firstUser.parentId));
    assert(navigated.entries.some(entry => entry.id === originalLeaf), "Pi must preserve the old branch");
    await prompt("edited branch input");
    const branched = await bridge.refresh();
    assert(branched.entries.some(entry => entry.type === "message" && entry.message.role === "user" &&
      entry.parentId === navigated.leafId && entry.message.content.some(part => part.type === "text" && part.text === "edited branch input")));

    const reloaded = await bridge.act({ operation: "reload", sessionId, generation: branched.info.generation });
    assert.equal(reloaded.result?.reloaded, true);
    assert.notEqual(reloaded.info.generation, branched.info.generation);
    assert.equal(reloaded.info.sessionId, sessionId);
    await assert.rejects(bridge.act({ operation: "label", targetId: firstUser.id, label: "stale",
      sessionId, generation: branched.info.generation }), /stale|过期/i);
    assert.equal((await client.request({ type: "get_state" })).success, true);

    await prompt("attached image", [{ type: "image",
      data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC",
      mimeType: "image/png" }]);
    const withImage = await bridge.refresh();
    const imageUser = withImage.entries.find(entry => entry.type === "message" && entry.message.role === "user" &&
      "content" in entry.message && Array.isArray(entry.message.content) &&
      entry.message.content.some(part => part.type === "image"));
    assert(imageUser);
    await assert.rejects(bridge.act({ operation: "navigate", targetId: imageUser.id, summarize: false,
      sessionId, generation: withImage.info.generation }), /image attachments losslessly/i);
    assert.equal((await bridge.refresh()).leafId, withImage.leafId, "image branch must stay untouched");
    assert.equal(calls.length, 4, "control commands must not invoke the model");
  } finally {
    bridge?.dispose();
    await client?.dispose();
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
});

test("missing public bridge fails before any control is sent as a model prompt", { timeout: 30_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-native-bridge-missing-"));
  const cli = fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent/rpc-entry"));
  const client = new PiRpcClient({ executable: process.execPath,
    args: [cli, "--offline", "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-context-files"],
    cwd: root, env: { PI_CODING_AGENT_DIR: join(root, "profile"), PI_TELEMETRY: "0" },
  });
  const bridge = new PiControlBridge(client);
  try {
    await client.start();
    await assert.rejects(bridge.refresh(), /bridge|扩展桥/i);
    const entries = await client.request({ type: "get_entries" });
    assert.equal(entries.success, true, entries.error);
    assert.equal((entries.data as { entries: Array<{ type: string }> }).entries.some(entry => entry.type === "message"), false);
  } finally {
    bridge.dispose();
    await client.dispose();
    await rm(root, { recursive: true, force: true });
  }
});
