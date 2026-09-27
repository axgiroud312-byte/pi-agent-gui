import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { PiControlBridge } from "../src/pi-agent/pi-control-bridge.js";
import { piControlView } from "../src/pi-agent/pi-control-protocol.js";
import { PiRpcClient } from "../src/pi-agent/pi-rpc-client.js";

const NAME = "pi-controlled-resource-fixture";

test("fixed Pi installs and updates an npm package from a controlled registry, then reports no change", {
  timeout: 120_000,
}, async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-npm-update-"));
  const profile = join(root, "profile");
  const workspace = join(root, "workspace");
  const npmCli = join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
  assert(existsSync(npmCli), "Node's bundled npm CLI is required for the Windows package fixture");
  const versions = new Map<string, { bytes: Buffer; shasum: string; integrity: string }>();
  let latest = "1.0.0";
  const requests: string[] = [];
  const modelCalls: unknown[] = [];
  const registry = createServer(async (request, response) => {
    const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    requests.push(`${request.method} ${pathname}`);
    if (pathname === "/v1/chat/completions") {
      let body = "";
      for await (const chunk of request) body += chunk;
      modelCalls.push(JSON.parse(body));
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.end(`data: ${JSON.stringify({ id: "npm-fixture", object: "chat.completion.chunk", created: 1,
        model: "npm-model", choices: [{ index: 0, delta: { role: "assistant", content: "NPM_UPDATE_OK" },
          finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`);
      return;
    }
    if (pathname === `/${NAME}`) {
      const published = [...versions.keys()].filter(version => version <= latest);
      const metadata = { name: NAME, "dist-tags": { latest }, versions: Object.fromEntries(
        published.map(version => [version, { name: NAME, version,
          dist: { tarball: `http://127.0.0.1:${(registry.address() as { port: number }).port}/${NAME}/-/${NAME}-${version}.tgz`,
            shasum: versions.get(version)!.shasum, integrity: versions.get(version)!.integrity } }])) };
      response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      response.end(JSON.stringify(metadata));
      return;
    }
    const tarball = pathname.match(new RegExp(`^/${NAME}/-/${NAME}-(\\d+\\.\\d+\\.\\d+)\\.tgz$`));
    if (tarball && versions.has(tarball[1]!)) {
      response.writeHead(200, { "content-type": "application/octet-stream", "cache-control": "no-store" });
      response.end(versions.get(tarball[1]!)!.bytes);
      return;
    }
    response.writeHead(404);
    response.end("not found");
  });
  let client: PiRpcClient | undefined;
  let bridge: PiControlBridge | undefined;
  try {
    await mkdir(profile);
    await mkdir(workspace);
    for (const version of ["1.0.0", "1.1.0"]) {
      const source = join(root, `source-${version}`);
      await mkdir(join(source, "prompts"), { recursive: true });
      await writeFile(join(source, "package.json"), JSON.stringify({ name: NAME, version,
        pi: { prompts: ["prompts"] } }));
      await writeFile(join(source, "prompts", "npm-template.md"),
        `---\ndescription: npm fixture ${version}\n---\nPackage ${version} $1\n`);
      const [packed] = JSON.parse(execFileSync(process.execPath,
        [npmCli, "pack", "--json", "--pack-destination", root], { cwd: source,
          env: { ...process.env, npm_config_audit: "false", npm_config_fund: "false" },
          encoding: "utf8", windowsHide: true }));
      const bytes = await readFile(join(root, packed.filename));
      versions.set(version, { bytes, shasum: createHash("sha1").update(bytes).digest("hex"),
        integrity: `sha512-${createHash("sha512").update(bytes).digest("base64")}` });
    }
    await new Promise<void>(resolve => registry.listen(0, "127.0.0.1", resolve));
    const address = registry.address();
    assert(address && typeof address !== "string");
    await writeFile(join(profile, "settings.json"), JSON.stringify({ defaultProjectTrust: "always",
      defaultProvider: "npm-provider", defaultModel: "npm-model" }));
    await writeFile(join(profile, "models.json"), JSON.stringify({ providers: {
      "npm-provider": { baseUrl: `http://127.0.0.1:${address.port}/v1`, api: "openai-completions",
        apiKey: "local-test-only", models: [{ id: "npm-model" }] },
    } }));
    client = new PiRpcClient({ executable: process.execPath,
      args: [fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent/rpc-entry")),
        "--extension", fileURLToPath(new URL("../src/pi-agent/pi-control-bridge-extension.ts", import.meta.url))],
      cwd: workspace, env: { PI_CODING_AGENT_DIR: profile, PI_TELEMETRY: "0",
        npm_config_registry: `http://127.0.0.1:${address.port}/`, npm_config_audit: "false",
        npm_config_fund: "false", npm_config_update_notifier: "false",
        npm_config_cache: join(root, "npm-cache"), npm_config_prefer_online: "true" } });
    await client.start();
    bridge = new PiControlBridge(client);
    const before = piControlView(await bridge.refresh());
    const installed = piControlView(await bridge.act({ operation: "package_install", source: `npm:${NAME}`,
      scope: "project", sessionId: before.info.sessionId, generation: before.info.generation }));
    assert(installed.resources.commands.some(command => command.name === "npm-template" &&
      command.description === "npm fixture 1.0.0"));
    const installedPath = installed.resources.packages.find(pkg => pkg.source === `npm:${NAME}`)?.installedPath;
    assert(installedPath);
    assert.equal(JSON.parse(await readFile(join(installedPath, "package.json"), "utf8")).version, "1.0.0");
    latest = "1.1.0";
    const updated = piControlView(await bridge.act({ operation: "package_update", source: `npm:${NAME}`,
      scope: "project", sessionId: installed.info.sessionId, generation: installed.info.generation }));
    assert.notEqual(updated.info.generation, installed.info.generation);
    assert.equal(JSON.parse(await readFile(join(installedPath, "package.json"), "utf8")).version, "1.1.0");
    assert(updated.resources.commands.some(command => command.name === "npm-template" &&
      command.description === "npm fixture 1.1.0"));
    const settled = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => { client?.off("record", listener); reject(new Error("Pi did not settle")); }, 20_000);
      const listener = (record: Record<string, unknown>) => {
        if (record.type === "agent_settled") { clearTimeout(timeout); client?.off("record", listener); resolve(); }
      };
      client?.on("record", listener);
    });
    const accepted = await client.request({ type: "prompt", message: "/npm-template Alpha" });
    assert.equal(accepted.success, true, accepted.error);
    await settled;
    assert(JSON.stringify(modelCalls.at(-1)).includes("Package 1.1.0 Alpha"),
      "fixed Pi must expand the updated npm prompt into the real model request");
    const current = piControlView(await bridge.refresh());
    const requestsBeforeNoop = requests.length;
    const tarballsBeforeNoop = requests.filter(item => item.endsWith(".tgz")).length;
    await assert.rejects(bridge.act({ operation: "package_update", source: `npm:${NAME}`,
      scope: "project", sessionId: current.info.sessionId, generation: current.info.generation }),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "PACKAGE_UNCHANGED");
    const unchanged = piControlView(await bridge.refresh());
    assert.equal(unchanged.info.generation, updated.info.generation,
      "an update with no new package must not claim that Pi reloaded resources");
    assert(requests.length > requestsBeforeNoop, "Pi must check the controlled registry before reporting no change");
    assert.equal(requests.filter(item => item.endsWith(".tgz")).length, tarballsBeforeNoop,
      "Pi must not download a tarball for an unchanged npm package");
    const removed = piControlView(await bridge.act({ operation: "package_remove", source: `npm:${NAME}`,
      scope: "project", sessionId: unchanged.info.sessionId, generation: unchanged.info.generation }));
    assert.equal(removed.resources.commands.some(command => command.name === "npm-template"), false);
    assert.equal(removed.resources.packages.some(pkg => pkg.source === `npm:${NAME}`), false);
  } finally {
    bridge?.dispose();
    await client?.dispose();
    registry.closeAllConnections();
    await new Promise<void>(resolve => registry.close(() => resolve()));
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
