import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { test } from "node:test";
import { PiLlamaRouterClient } from "../src/pi-agent/pi-llama-router-client.js";
import { projectPiLlamaRouterModels } from "../src/pi-agent/pi-llama-router-service.js";

interface Fixture {
  server: Server;
  url: string;
  requests: Array<{ method: string; path: string; body: unknown; authorization?: string }>;
  models: Array<{ id: string; status: { value: string; failed?: boolean } }>;
  send(event: unknown): void;
  close(): Promise<void>;
}

async function fixture(): Promise<Fixture> {
  const requests: Fixture["requests"] = [];
  const models: Fixture["models"] = [{ id: "test.gguf", status: { value: "unloaded" } }];
  const listeners = new Set<import("node:http").ServerResponse>();
  const server = createServer(async (req, res) => {
    if (req.url === "/models/sse") {
      res.writeHead(200, { "content-type": "text/event-stream" });
      listeners.add(res);
      res.on("close", () => listeners.delete(res));
      return;
    }
    let raw = "";
    for await (const part of req) raw += part;
    const body = raw ? JSON.parse(raw) as unknown : undefined;
    requests.push({ method: req.method ?? "GET", path: req.url ?? "", body,
      authorization: req.headers.authorization });
    if ((req.url === "/models" || req.url === "/models?reload=1") && req.method === "GET") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ data: models }));
      return;
    }
    if (req.url === "/models/load" && req.method === "POST") {
      models[0]!.status = { value: "loading" };
      res.writeHead(200, { "content-type": "application/json" }); res.end("{}"); return;
    }
    if (req.url === "/models" && req.method === "POST") {
      models[0]!.status = { value: "downloading" };
      res.writeHead(200, { "content-type": "application/json" }); res.end("{}"); return;
    }
    if (req.url === "/models/unload" && req.method === "POST") {
      models[0]!.status = { value: "unloaded" };
      res.writeHead(200, { "content-type": "application/json" }); res.end("{}"); return;
    }
    res.writeHead(404); res.end();
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address !== "string");
  return { server, url: `http://127.0.0.1:${address.port}`, requests, models,
    send(event) { for (const listener of listeners) listener.write(`data: ${JSON.stringify(event)}\n\n`); },
    async close() { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); } };
}

test("router catalog rejects a plain llama-server and preserves all five router statuses", async () => {
  const site = await fixture();
  try {
    const client = new PiLlamaRouterClient(site.url, "test-key");
    site.models.splice(0, 1, ...["loaded", "loading", "unloaded", "downloading", "sleeping"]
      .map((value, index) => ({ id: `model-${index}`, status: { value } })));
    assert.deepEqual((await client.list()).map(model => model.status.value),
      ["loaded", "loading", "unloaded", "downloading", "sleeping"]);
    assert.equal(site.requests[0]?.authorization, "Bearer test-key");
    site.models[0] = { id: "no-status", status: {} as { value: string } };
    await assert.rejects(client.list(), /router mode/i);
  } finally { await site.close(); }
});

test("load observes SSE progress, polls authoritative state, and cancellation unloads the router model", async () => {
  const site = await fixture();
  try {
    const client = new PiLlamaRouterClient(site.url, undefined, { pollIntervalMs: 20 });
    const progress: Array<{ ratio?: number; message: string }> = [];
    const running = client.load("test.gguf", value => progress.push(value));
    await new Promise<void>(resolve => setTimeout(resolve, 60));
    site.send({ model: "test.gguf", event: "model_status", data: {
      status: "loading", progress: { current: "load_tensors", stages: ["download", "load_tensors"], value: 0.5 },
    } });
    await new Promise<void>(resolve => setTimeout(resolve, 30));
    assert(progress.some(item => item.ratio !== undefined && item.ratio > 0));
    await client.cancel("test.gguf");
    await assert.rejects(running, /cancel/i);
    assert.equal(site.models[0]?.status.value, "unloaded");
    assert.equal(site.requests.filter(item => item.path === "/models/load").length, 1);
    assert.equal(site.requests.filter(item => item.path === "/models/unload").length, 1);
  } finally { await site.close(); }
});

test("a lost load response is reconciled by GET and never replayed", async () => {
  let posts = 0;
  const server = createServer((req, res) => {
    if (req.url === "/models/load") { posts++; req.socket.destroy(); return; }
    if (req.url === "/models") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ data: [{ id: "test.gguf", status: { value: "loading" } }] })); return;
    }
    if (req.url === "/models/sse") { res.writeHead(200, { "content-type": "text/event-stream" }); return; }
    res.writeHead(404); res.end();
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); assert(address && typeof address !== "string");
  try {
    const client = new PiLlamaRouterClient(`http://127.0.0.1:${address.port}`, undefined, { pollIntervalMs: 20 });
    await assert.rejects(client.load("test.gguf", () => {}), /uncertain|connection/i);
    assert.equal(posts, 1);
    assert.equal((await client.list())[0]?.status.value, "loading");
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

test("download waits for completion event and refreshes the catalog", async () => {
  const site = await fixture();
  try {
    const client = new PiLlamaRouterClient(site.url, undefined, { pollIntervalMs: 20 });
    const progress: Array<{ ratio?: number; message: string }> = [];
    const download = client.download("test.gguf", value => progress.push(value));
    await new Promise<void>(resolve => setTimeout(resolve, 60));
    assert.equal(site.models[0]?.status.value, "downloading");
    site.send({ model: "test.gguf", event: "download_progress", data: {
      progress: { file: { done: 25, total: 100 } },
    } });
    await new Promise<void>(resolve => setTimeout(resolve, 30));
    assert(progress.some(item => item.ratio === 0.25));
    site.models[0]!.status = { value: "unloaded" };
    site.send({ model: "test.gguf", event: "download_finished", data: {} });
    assert.equal((await download)?.status.value, "unloaded");
    assert(site.requests.some(item => item.path === "/models?reload=1"));
  } finally { await site.close(); }
});

test("polling reports download bytes when SSE has no progress, and Pi selectability follows autoload presets", async () => {
  const site = await fixture();
  try {
    const client = new PiLlamaRouterClient(site.url, undefined, { pollIntervalMs: 20 });
    const progress: Array<{ ratio?: number }> = [];
    const downloading = client.download("test.gguf", value => progress.push(value));
    await new Promise<void>(resolve => setTimeout(resolve, 50));
    site.models[0]!.status = { value: "downloading", progress: { file: { done: 50, total: 100 } } };
    await new Promise<void>(resolve => setTimeout(resolve, 50));
    site.models[0]!.status = { value: "unloaded" };
    await downloading;
    assert(progress.some(item => item.ratio === 0.5));
    const models = [
      { id: "loaded", status: { value: "loaded" } },
      { id: "sleeping", status: { value: "sleeping" } },
      { id: "preset", source: "preset", status: { value: "unloaded" } },
      { id: "file", source: "file", status: { value: "unloaded" } },
      { id: "failed", source: "preset", status: { value: "unloaded", failed: true } },
    ];
    assert.deepEqual(projectPiLlamaRouterModels(models, true).map(model => model.selectableInPi),
      [true, true, true, false, false]);
    assert.deepEqual(projectPiLlamaRouterModels(models, false).map(model => model.selectableInPi),
      [true, true, false, false, false]);
  } finally { await site.close(); }
});

test("definitive router HTTP rejection is reported directly rather than as an uncertain write", async () => {
  const server = createServer(async (req, res) => {
    for await (const _ of req) { /* drain */ }
    if (req.url === "/models") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ data: [{ id: "test.gguf", status: { value: "unloaded" } }] })); return;
    }
    if (req.url === "/models/load") {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: "model file is missing" } })); return;
    }
    if (req.url === "/models/sse") { res.writeHead(200, { "content-type": "text/event-stream" }); return; }
    res.writeHead(404); res.end();
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); assert(address && typeof address !== "string");
  try {
    const client = new PiLlamaRouterClient(`http://127.0.0.1:${address.port}`);
    await assert.rejects(client.load("test.gguf", () => {}), error => {
      assert(error instanceof Error);
      assert.match(error.message, /model file is missing/);
      assert.doesNotMatch(error.message, /uncertain/);
      return true;
    });
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

test("router URL with userinfo is rejected before credentials can reach the renderer view", () => {
  assert.throws(() => new PiLlamaRouterClient("http://user:secret@127.0.0.1:8080/v1"), /userinfo|credentials/i);
  assert.throws(() => new PiLlamaRouterClient("http://@127.0.0.1:8080"), /userinfo|credentials/i);
});

test("a stuck load times out, leaves the router state observable, and remains explicitly cancellable", async () => {
  const site = await fixture();
  try {
    const client = new PiLlamaRouterClient(site.url, undefined,
      { pollIntervalMs: 10, loadTimeoutMs: 80 });
    await assert.rejects(client.load("test.gguf", () => {}), /timed out|timeout/i);
    assert.equal(site.models[0]?.status.value, "loading");
    assert.equal(site.requests.filter(item => item.path === "/models/load").length, 1);
    await client.cancel("test.gguf");
    assert.equal(site.models[0]?.status.value, "unloaded");
    assert.equal(site.requests.filter(item => item.path === "/models/unload").length, 1);
  } finally { await site.close(); }
});

test("cancel waits for an in-flight load POST before sending the router unload", async () => {
  let status = "unloaded";
  let postEntered!: () => void;
  const entered = new Promise<void>(resolve => { postEntered = resolve; });
  const order: string[] = [];
  const server = createServer(async (req, res) => {
    let raw = ""; for await (const part of req) raw += part;
    if (req.url === "/models") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ data: [{ id: "test.gguf", status: { value: status } }] })); return;
    }
    if (req.url === "/models/load") {
      order.push("load-post-entered"); postEntered();
      await new Promise<void>(resolve => setTimeout(resolve, 80));
      status = "loading"; order.push("load-post-committed");
      res.writeHead(200, { "content-type": "application/json" }); res.end("{}"); return;
    }
    if (req.url === "/models/unload") {
      order.push("unload-post"); status = "unloaded";
      res.writeHead(200, { "content-type": "application/json" }); res.end("{}"); return;
    }
    if (req.url === "/models/sse") { res.writeHead(200, { "content-type": "text/event-stream" }); return; }
    res.writeHead(404); res.end();
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); assert(address && typeof address !== "string");
  try {
    const client = new PiLlamaRouterClient(`http://127.0.0.1:${address.port}`, undefined,
      { pollIntervalMs: 10, loadTimeoutMs: 300 });
    const running = client.load("test.gguf", () => {});
    await entered;
    await client.cancel("test.gguf");
    await assert.rejects(running, /cancel/i);
    assert.deepEqual(order, ["load-post-entered", "load-post-committed", "unload-post"]);
    assert.equal(status, "unloaded");
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

test("failed router unload stops the local load wait without claiming remote cancellation", async () => {
  let status = "unloaded";
  let rejectUnload = true;
  let sawLoadingPoll!: () => void;
  const loadingPolled = new Promise<void>(resolve => { sawLoadingPoll = resolve; });
  const server = createServer(async (req, res) => {
    for await (const _ of req) { /* drain */ }
    if (req.url === "/models/sse") {
      res.writeHead(503); res.end(); return;
    }
    if (req.url === "/models" && req.method === "GET") {
      if (status === "loading") sawLoadingPoll();
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ data: [{ id: "test.gguf", status: { value: status } }] })); return;
    }
    if (req.url === "/models/load") {
      status = "loading";
      res.writeHead(200, { "content-type": "application/json" }); res.end("{}"); return;
    }
    if (req.url === "/models/unload") {
      if (rejectUnload) {
        res.writeHead(503, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { message: "router unload unavailable" } })); return;
      }
      status = "unloaded";
      res.writeHead(200, { "content-type": "application/json" }); res.end("{}"); return;
    }
    res.writeHead(404); res.end();
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); assert(address && typeof address !== "string");
  try {
    const client = new PiLlamaRouterClient(`http://127.0.0.1:${address.port}`, undefined,
      { pollIntervalMs: 20, loadTimeoutMs: 1_000 });
    const running = client.load("test.gguf", () => {}).then(
      () => "resolved", error => error instanceof Error ? error.message : String(error));
    await loadingPolled;
    await assert.rejects(client.cancel("test.gguf"), /router unload unavailable|remote|unknown/i);
    const immediate = await Promise.race([running,
      new Promise<string>(resolve => setTimeout(() => resolve("still waiting"), 350))]);
    const outcome = await running;
    assert.notEqual(immediate, "still waiting", "cancel failure must end the local wait promptly");
    assert.match(outcome, /remote|unknown|refresh|cancel/i);
    assert.doesNotMatch(outcome, /timed out|timeout/i);
    assert.equal((await client.list())[0]?.status.value, "loading",
      "the router remains authoritative after an unverified unload");
    rejectUnload = false;
    await client.cancel("test.gguf");
    assert.equal((await client.list())[0]?.status.value, "unloaded",
      "the user can refresh and explicitly retry router cancellation");
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
