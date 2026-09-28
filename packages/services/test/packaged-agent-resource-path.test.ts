import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

test("an Electron utility host resolves the packaged Agent bundle from the main-process resource path", async (t) => {
  const resources = await mkdtemp(join(tmpdir(), "pi-packaged-agent-resources-"));
  t.after(() => rm(resources, { recursive: true, force: true }));
  const bundle = join(resources, "glm", "zcode.cjs");
  await mkdir(join(resources, "glm"), { recursive: true });
  await writeFile(bundle, "// packaged Agent fixture\n");

  const previous = process.env.ZCODE_PACKAGED_RESOURCES_PATH;
  process.env.ZCODE_PACKAGED_RESOURCES_PATH = resources;
  t.after(() => {
    if (previous === undefined) delete process.env.ZCODE_PACKAGED_RESOURCES_PATH;
    else process.env.ZCODE_PACKAGED_RESOURCES_PATH = previous;
  });

  const runtime = await import(`../src/runtime-tools/providerRuntimeResolver.ts?packaged=${Date.now()}`);
  assert.equal(runtime.findZCodeAgentRuntimeNodeBundle(), bundle);
});
