import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { readPiModelConfig, savePiModelConfig } from "../src/pi-agent/pi-model-config.js";

test("Pi model editing preserves advanced fields and secrets; the real runtime consumes the same file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pi-model-config-"));
  try {
    const path = join(dir, "models.json");
    const original = { providers: {
      custom: { baseUrl: "http://127.0.0.1:1/v1", api: "openai-completions", apiKey: "do-not-project",
        headers: { "x-key": "also-secret" }, compat: { supportsDeveloperRole: false },
        models: [{ id: "first", name: "First", reasoning: true, contextWindow: 64000 }] },
      other: { baseUrl: "http://127.0.0.1:2/v1", api: "openai-responses", models: [{ id: "kept" }] },
    } };
    await writeFile(path, JSON.stringify(original));
    const view = await readPiModelConfig(dir);
    assert(!JSON.stringify(view).includes("do-not-project"));
    assert(!JSON.stringify(view).includes("also-secret"));
    const saved = await savePiModelConfig(dir, { expectedRevision: view.revision, providerId: "custom",
      config: { baseUrl: "http://127.0.0.1:3/v1", api: "openai-completions", modelIds: ["first", "second"] } });
    const bytes = await readFile(path, "utf8");
    const document = JSON.parse(bytes);
    assert.equal(document.providers.custom.apiKey, original.providers.custom.apiKey);
    assert.deepEqual(document.providers.custom.headers, original.providers.custom.headers);
    assert.deepEqual(document.providers.custom.compat, original.providers.custom.compat);
    assert.deepEqual(document.providers.custom.models[0], original.providers.custom.models[0]);
    assert.deepEqual(document.providers.other, original.providers.other);
    const runtime = await ModelRuntime.create({ modelsPath: path, authPath: join(dir, "auth.json"), allowModelNetwork: false });
    assert.equal(runtime.getError(), undefined);
    assert(runtime.getAvailableSnapshot().some(model => model.provider === "custom" && model.id === "second"));
    await assert.rejects(savePiModelConfig(dir, { expectedRevision: view.revision, providerId: "custom", config: null }), /外部改变/u);
    assert.equal(await readFile(path, "utf8"), bytes);
    await writeFile(join(dir, "auth.json"), '{"custom":{"type":"api_key","key":"preserve"}}');
    await savePiModelConfig(dir, { expectedRevision: saved.revision, providerId: "custom", config: null });
    assert.deepEqual(JSON.parse(await readFile(path, "utf8")).providers, { other: original.providers.other });
    assert((await readFile(join(dir, "auth.json"), "utf8")).includes("preserve"));
    assert(!(await readdir(dir)).some(name => name.endsWith(".lock") || name.startsWith(".models-")));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("bad files and Pi-rejected model edits never overwrite the only configuration", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pi-model-reject-"));
  try {
    const path = join(dir, "models.json");
    let view = await readPiModelConfig(dir);
    await assert.rejects(savePiModelConfig(dir, { expectedRevision: view.revision, providerId: "new",
      config: { baseUrl: "", api: "openai-completions", modelIds: ["test"] } }), /Pi 未接受/u);
    assert.equal((await readPiModelConfig(dir)).revision, view.revision);
    await writeFile(path, '{"secret":"do-not-leak", broken');
    view = await readPiModelConfig(dir);
    assert(view.error);
    assert(!JSON.stringify(view).includes("do-not-leak"));
    await assert.rejects(savePiModelConfig(dir, { expectedRevision: view.revision, providerId: "new", config: null }), /无效/u);
    assert.equal(await readFile(path, "utf8"), '{"secret":"do-not-leak", broken');
  } finally { await rm(dir, { recursive: true, force: true }); }
});
