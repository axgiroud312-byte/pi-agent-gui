import assert from "node:assert/strict";
import { test } from "node:test";
import type { ZCodeConfigOption } from "@zcode/shared";
import { buildPiModelSelectGroups, extractPiModelCatalog,
  resolvePiSessionModelSelection } from "../src/v4/composer/piModelCatalog.js";
import { createComposerSubmissionConfig } from "../src/v4/composer/composerSubmissionConfig.js";

const options: ZCodeConfigOption[] = [{
  id: "model", name: "Pi model", category: "pi-model", type: "select", currentValue: "other/start",
  options: [
    { value: "other/start", name: "Start", modelProviderId: "other", modelProviderName: "other",
      origin: "native", modelThoughtLevels: ["off", "medium"] },
    { value: "llama.cpp/gui.gguf", name: "gui.gguf", modelProviderId: "llama.cpp",
      modelProviderName: "llama.cpp", origin: "native", modelThoughtLevels: ["off"] },
  ],
}];

test("Pi router catalog supplies the native picker and submission without a ZCode provider", () => {
  const catalog = extractPiModelCatalog(options);
  assert.deepEqual(catalog.map(model => [model.providerId, model.modelId]),
    [["other", "start"], ["llama.cpp", "gui.gguf"]]);
  assert.deepEqual(buildPiModelSelectGroups(catalog).map(group => [group.label, group.items[0]?.name]),
    [["other", "Start"], ["llama.cpp", "gui.gguf"]]);
  assert.equal(buildPiModelSelectGroups(catalog)[1]?.items[0]?.searchText, "gui.gguf");
  const selection = { providerId: "llama.cpp", modelId: "gui.gguf", options: { reasoningLevel: "off" } };
  const submission = createComposerSubmissionConfig({ mode: "build", modelSelection: selection },
    { revision: 1, providers: [] }, catalog);
  assert.deepEqual(submission?.modelSelection, selection);
  assert.equal(createComposerSubmissionConfig({ mode: "build", modelSelection: selection },
    { revision: 1, providers: [] }, []), null, "unloaded model cannot be sent from a stale draft");
  assert.equal(createComposerSubmissionConfig({ mode: "build", modelSelection: {
    ...selection, options: { reasoningLevel: "high" },
  } }, { revision: 1, providers: [] }, catalog), null, "Pi catalog controls available thinking levels");
});

test("ordinary model options cannot impersonate a Pi catalog", () => {
  assert.deepEqual(extractPiModelCatalog([{ ...options[0]!, category: "model" }]), []);
});

test("an imported Pi session seeds its composer from the live Pi model only after the catalog arrives", () => {
  const config = { provider: "llama.cpp", model: "gui.gguf", thought: "off" };
  assert.deepEqual(resolvePiSessionModelSelection(config, [], false), { ready: false },
    "a pending catalog must not persist an empty model selection into the imported draft");
  assert.deepEqual(resolvePiSessionModelSelection(config, extractPiModelCatalog(options), true), {
    ready: true,
    modelSelection: { providerId: "llama.cpp", modelId: "gui.gguf", options: { reasoningLevel: "off" } },
  });
  assert.deepEqual(resolvePiSessionModelSelection(config, [], true), { ready: true },
    "an unavailable imported model must require a fresh explicit choice");
  assert.deepEqual(resolvePiSessionModelSelection({ ...config, thought: "high" },
    extractPiModelCatalog(options), true), { ready: true },
  "the renderer must not replace Pi's actual thinking level with a different one");
  assert.deepEqual(resolvePiSessionModelSelection({ provider: "", model: "", thought: "" }, [], false),
    { ready: true }, "Pi with no model remains an explicit empty selection");
});
