import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

test("production probe guard catches legacy access in main and an env-sanitizing child", async (t) => {
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  const output = await mkdtemp(join(tmpdir(), "pi-profile-guard-"));
  t.after(() => rm(output, { recursive: true, force: true }));
  const home = join(output, "user");
  const legacy = join(home, ".zcode", "sentinel");
  const privateDir = join(home, ".pi-agent-ide", ".zcode");
  await mkdir(join(home, ".zcode"), { recursive: true });
  await mkdir(privateDir, { recursive: true });
  await writeFile(legacy, "unchanged");
  const log = join(output, "boundaries.jsonl");
  await writeFile(log, "");
  const env = { ...process.env, HOME: home, USERPROFILE: home,
    NATIVE_SMOKE_ROOT: root, NATIVE_SMOKE_OUTPUT: output,
    NATIVE_SMOKE_FORBIDDEN_HOME: homedir(), NATIVE_SMOKE_BOUNDARY_LOG: log,
    NATIVE_SMOKE_HARNESS: resolve(process.env.NATIVE_SMOKE_HARNESS ?? join(root, "scripts/native-smoke")),
  };
  delete env.NODE_OPTIONS;
  const guard = fileURLToPath(new URL("profile-file-guard.cjs", import.meta.url));
  const childCode = `require('node:fs').readFileSync(${JSON.stringify(legacy)}, 'utf8')`;
  const code = `
    const assert = require('node:assert/strict');
    const fs = require('node:fs');
    fs.writeFileSync(${JSON.stringify(join(privateDir, "allowed"))}, 'Pi');
    assert.throws(() => fs.existsSync(${JSON.stringify(legacy)}), /Original ZCode/);
    const child = require('node:child_process').spawnSync(process.execPath, ['-e', ${JSON.stringify(childCode)}], {
      env: { ...process.env, NODE_OPTIONS: '' }, encoding: 'utf8'
    });
    assert.notEqual(child.status, 0);
    assert.match(child.stderr, /Original ZCode/);
  `;
  const result = spawnSync(process.execPath, ["--require", guard, "-e", code], { env, encoding: "utf8", timeout: 15000 });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const boundaries = (await readFile(log, "utf8")).trim().split(/\r?\n/).map(JSON.parse);
  assert.equal(boundaries.filter((entry) => entry.type === "profile-guard-active").length, 2);
  assert.equal(boundaries.filter((entry) => entry.type === "legacy-profile-access").length, 2);
  assert.equal(await readFile(legacy, "utf8"), "unchanged");
  assert.equal(await readFile(join(privateDir, "allowed"), "utf8"), "Pi");
});
