import assert from "node:assert/strict";
import { test } from "node:test";
import type { ModelSelectGroup } from "../src/ModelConfigSelect.js";
import { filterModelSelectGroups } from "../src/lib/modelSelectSearch.js";

const groups: ModelSelectGroup[] = [
  {
    key: "pi-provider:openai",
    label: "OpenAI",
    items: [
      { key: "gpt", value: "encoded-gpt", name: "GPT Five", searchText: "gpt-5.5" },
      { key: "mini", value: "encoded-mini", name: "Mini", searchText: "gpt-mini" },
    ],
  },
  {
    key: "pi-provider:local",
    label: "本地模型",
    items: [{ key: "llama", value: "encoded-llama", name: "Llama", searchText: "local.gguf" }],
  },
];

test("Pi model search keeps provider order and matches display names, model IDs, and provider", () => {
  assert.equal(filterModelSelectGroups(groups, "  "), groups);
  assert.deepEqual(
    filterModelSelectGroups(groups, "Gpt-5.5").map((group) => [
      group.label,
      group.items.map((item) => item.name),
    ]),
    [["OpenAI", ["GPT Five"]]],
  );
  assert.deepEqual(
    filterModelSelectGroups(groups, "openai mini").map((group) => [
      group.label,
      group.items.map((item) => item.name),
    ]),
    [["OpenAI", ["Mini"]]],
  );
  assert.deepEqual(
    filterModelSelectGroups(groups, "本地").map((group) => group.label),
    ["本地模型"],
  );
  assert.deepEqual(filterModelSelectGroups(groups, "missing"), []);
  assert.equal(groups[0]?.items.length, 2, "search must not mutate the live Pi catalog");
});
