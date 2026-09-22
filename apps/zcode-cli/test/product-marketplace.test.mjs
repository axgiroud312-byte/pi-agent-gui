import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { ZipFile } from "yazl";
import { NodeHttpClientAdapter } from "../packages/adapters/src/http/index.ts";
import {
  describeMarketplacePlugin,
  validateMarketplacePlugin,
  validateMarketplaceSource,
} from "../packages/adapters/src/plugins/marketplace.ts";
import { resolveZipPluginSource } from "../packages/adapters/src/plugins/zip-source.ts";
import { updateZCodePluginMarketplace } from "../packages/bootstrap/src/plugins.ts";
import { feedbackOpenedMessageId } from "../../../packages/ui/src/feedback/feedbackOpenedMessage.ts";
import zh from "../../../packages/ui/src/i18n/locales/zh-CN.ts";
import en from "../../../packages/ui/src/i18n/locales/en-US.ts";

const OFFICIAL = "zcode-plugins-official";
const VENDOR_ZIP = "https://cdn-zcode.z.ai/zcode/official-plugin/fixture.zip";
const CUSTOM_ZIP = "https://plugins.example.test/fixture.zip";
const SHA = "0".repeat(64);
const PLUGIN_FILES = {
  ".zcode-plugin/plugin.json": JSON.stringify({ name: "fixture", version: "1.0.0" }),
  "skills/review/SKILL.md": "---\nname: review\ndescription: Review local changes\n---\nReview this project.\n",
};

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(value));
}

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "pi-marketplace-policy-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

async function seedCatalog(root, id, source) {
  const manifest = { name: id, plugins: [{ name: "fixture", version: "1.0.0", source }] };
  await writeJson(join(root, "marketplaces", id, "marketplace.json"), manifest);
  return manifest;
}

async function localPlugin(root) {
  const path = join(root, "bundled-fixture");
  for (const [file, content] of Object.entries(PLUGIN_FILES)) {
    await mkdir(dirname(join(path, file)), { recursive: true });
    await writeFile(join(path, file), content);
  }
  return path;
}

function transport(t, respond = () => { throw new Error("Unexpected HTTP request"); }) {
  const requests = [];
  t.mock.method(NodeHttpClientAdapter.prototype, "request", async (request) => {
    requests.push(request.url);
    return respond(request);
  });
  return requests;
}

function response(url, body, status = 200, headers = {}) {
  return { url, status, statusText: "fixture", headers, body: Buffer.from(body) };
}

function assertUnavailable(result) {
  assert.ok(result.diagnostics.some((item) => item.message.includes("vendorCatalog is not available")), JSON.stringify(result));
}

test("describe and validate never request an excluded official ZIP", async (t) => {
  const root = await fixture(t);
  const requests = transport(t);
  await seedCatalog(root, OFFICIAL, { source: "url", type: "zip", url: VENDOR_ZIP, sha256: SHA });
  const input = { marketplace: OFFICIAL, name: "fixture", storageRoot: root };
  assertUnavailable(await describeMarketplacePlugin(input));
  assertUnavailable({ diagnostics: await validateMarketplacePlugin(input) });
  assert.deepEqual(requests, []);
});

test("official remote sources cannot bypass exclusion with another hostname", async (t) => {
  const root = await fixture(t);
  const requests = transport(t);
  await seedCatalog(root, OFFICIAL, { source: "url", type: "zip", url: CUSTOM_ZIP, sha256: SHA });
  assertUnavailable(await describeMarketplacePlugin({ marketplace: OFFICIAL, name: "fixture", storageRoot: root }));
  assert.deepEqual(requests, []);
});

test("describe cannot fetch a missing official manifest from a changed host", async (t) => {
  const root = await fixture(t);
  const requests = transport(t);
  await writeJson(join(root, "known_marketplaces.json"), { marketplaces: [{ id: OFFICIAL, name: OFFICIAL, source: { source: "url", url: "https://plugins.example.test/official.json" }, pluginCount: 1, addedAt: "2026-01-01T00:00:00.000Z" }] });
  assertUnavailable(await describeMarketplacePlugin({ marketplace: OFFICIAL, name: "fixture", storageRoot: root }));
  assert.deepEqual(requests, []);
});

test("third-party describe/validation cannot download vendor CDN ZIPs", async (t) => {
  const root = await fixture(t);
  const requests = transport(t);
  const manifest = await seedCatalog(root, "custom", { source: "url", type: "zip", url: VENDOR_ZIP, sha256: SHA });
  assertUnavailable(await describeMarketplacePlugin({ marketplace: "custom", name: "fixture", storageRoot: root }));
  assertUnavailable({ diagnostics: await validateMarketplaceSource({ source: { source: "settings", marketplace: { ...manifest, raw: manifest } }, storageRoot: root }) });
  assert.deepEqual(requests, []);
});

test("ZIP redirects are rejected before contacting the vendor host", async (t) => {
  const requests = transport(t, (request) => response(request.url, "", 302, { location: VENDOR_ZIP }));
  await assert.rejects(resolveZipPluginSource({ url: CUSTOM_ZIP, sha256: SHA }), /vendorCatalog is not available/);
  assert.deepEqual(requests, [CUSTOM_ZIP]);
});

test("manifest validation also blocks a redirect to the vendor CDN", async (t) => {
  const root = await fixture(t);
  const initial = "https://plugins.example.test/marketplace.json";
  const requests = transport(t, (request) => response(request.url, "", 302, { location: "https://cdn-zcode.z.ai/marketplace.json" }));
  assertUnavailable({ diagnostics: await validateMarketplaceSource({ source: { source: "url", url: initial }, storageRoot: root }) });
  assert.deepEqual(requests, [initial]);
});

test("bundled, directory and installed official plugins remain readable offline", async (t) => {
  const root = await fixture(t);
  const requests = transport(t);
  const path = await localPlugin(root);
  for (const source of ["filesystem", "sea", { source: "directory", path }]) {
    const manifest = { name: OFFICIAL, plugins: [{ name: "fixture", version: "1.0.0", source, cachePath: path }] };
    await writeJson(join(root, "marketplaces", OFFICIAL, "marketplace.json"), manifest);
    const result = await describeMarketplacePlugin({ marketplace: OFFICIAL, name: "fixture", storageRoot: root });
    assert.equal(result.diagnostics.length, 0, JSON.stringify(result));
    assert.ok(JSON.stringify(result.components).includes("Review local changes"));
  }
  await seedCatalog(root, OFFICIAL, { source: "url", type: "zip", url: VENDOR_ZIP, sha256: SHA });
  await writeJson(join(root, "installed_plugins.json"), { version: 1, plugins: [{ id: `fixture@${OFFICIAL}`, marketplace: OFFICIAL, name: "fixture", version: "1.0.0", scope: "user", installedAt: "2026-01-01T00:00:00.000Z", installPath: path }] });
  const installed = await describeMarketplacePlugin({ marketplace: OFFICIAL, name: "fixture", storageRoot: root });
  assert.equal(installed.diagnostics.length, 0);
  assert.ok(JSON.stringify(installed.components).includes("Review local changes"));
  assert.deepEqual(requests, []);
});

test("ordinary third-party ZIP still downloads, verifies and exposes real plugin content", async (t) => {
  const root = await fixture(t);
  const archive = new ZipFile();
  const chunks = [];
  const bytes = new Promise((resolve, reject) => {
    archive.outputStream.on("data", (chunk) => chunks.push(chunk));
    archive.outputStream.on("end", () => resolve(Buffer.concat(chunks)));
    archive.outputStream.on("error", reject);
  });
  for (const [file, content] of Object.entries(PLUGIN_FILES)) archive.addBuffer(Buffer.from(content), file);
  archive.end();
  const zip = await bytes;
  const requests = transport(t, (request) => response(request.url, zip));
  await seedCatalog(root, "custom", { source: "url", type: "zip", url: CUSTOM_ZIP, sha256: createHash("sha256").update(zip).digest("hex") });
  const result = await describeMarketplacePlugin({ marketplace: "custom", name: "fixture", storageRoot: root });
  assert.equal(result.diagnostics.length, 0, JSON.stringify(result));
  assert.ok(JSON.stringify(result.components).includes("Review local changes"));
  assert.deepEqual(requests, [CUSTOM_ZIP]);
});

test("bootstrap refresh-all skips an official record and refreshes custom records after it", async (t) => {
  const root = await fixture(t);
  const customUrl = "https://plugins.example.test/marketplace.json";
  const officialRecord = { id: OFFICIAL, name: OFFICIAL, source: { source: "url", url: "https://cdn-zcode.z.ai/marketplace.json" }, pluginCount: 0, addedAt: "2026-01-01T00:00:00.000Z", lastRefreshFailure: { code: "plugin_marketplace_invalid", failedAt: "2026-01-01T00:00:00.000Z", message: "old vendor failure" } };
  await writeJson(join(root, "known_marketplaces.json"), { marketplaces: [officialRecord, { id: "custom", name: "custom", source: { source: "url", url: customUrl }, pluginCount: 0, addedAt: "2026-01-01T00:00:00.000Z" }] });
  const requests = transport(t, (request) => response(request.url, JSON.stringify({ name: "custom", plugins: [{ name: "fixture", source: "./fixture" }] })));
  const options = { workingDirectory: root, pluginStorageRoot: root, userConfigPath: join(root, "config.json"), skipUserConfig: true };
  const result = await updateZCodePluginMarketplace(options);
  assert.deepEqual(result.marketplaces.map((item) => item.id), ["custom"]);
  assert.equal(result.marketplaces[0].pluginCount, 1);
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(requests, [customUrl]);
  const saved = JSON.parse(await readFile(join(root, "known_marketplaces.json"), "utf8"));
  assert.deepEqual(saved.marketplaces.find((item) => item.id === OFFICIAL), officialRecord);
  assert.ok(saved.marketplaces.find((item) => item.id === "custom").lastUpdated);
  await assert.rejects(updateZCodePluginMarketplace({ ...options, marketplace: OFFICIAL }), /vendorCatalog is not available/);
  assert.deepEqual(requests, [customUrl]);
});

test("error and task feedback toasts describe the actual manual GitHub flow in both locales", () => {
  for (const nativeId of ["chat.error.feedbackOpened", "taskList.feedbackOpened"]) {
    const id = feedbackOpenedMessageId(nativeId);
    assert.notEqual(id, nativeId);
    assert.match(zh[id], /GitHub.*手动.*未自动附带.*复制粘贴/);
    assert.match(en[id], /GitHub.*manual.*not attached.*copy and paste/);
  }
});
