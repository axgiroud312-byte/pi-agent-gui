import assert from "node:assert/strict";
import { test } from "node:test";
import { copyFile, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ProviderConfigRuntime } from "../src/model-provider/providerConfigRuntime.js";

test("local provider baseline materializes only in the personal profile, not bundled resources", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pi-native-provider-"));
  const bundled = join(directory, "resources", "providers.json");
  const personal = join(directory, "profile", "personal.json");
  await mkdir(join(directory, "resources"));
  await copyFile(fileURLToPath(new URL("../../../config/provider/zcode-builtin.json", import.meta.url)), bundled);
  const before = await readFile(bundled);
  const runtime = new ProviderConfigRuntime({
    zcodeBuiltinFilePath: bundled,
    personalFilePath: personal,
    personalPollingIntervalMs: false,
    watch: false,
  });
  try {
    await runtime.start();
    await runtime.configService.read();
    const active = await runtime.resolveZCodeBuiltinActiveFilePath();
    assert.equal(active, join(directory, "profile", "provider-cache", "bundled-local.json"));
    assert.deepEqual(await readFile(bundled), before);
    assert.ok(JSON.parse(await readFile(active, "utf8")));
    assert.equal(await runtime.refreshZCodeBuiltin({ force: true }), "skipped");
  } finally {
    runtime.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});
