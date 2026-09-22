// Prepared-build regression: uses package.main, real emitted shared chunks and no data-root override.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export async function inspectProductionProfileEntry(appRoot) {
  const pkg = JSON.parse(await readFile(join(appRoot, "package.json"), "utf8"));
  assert.equal(pkg.main, "out/bootstrap.mjs", "Prepared product must use the unsplit package.main");
  const code = await readFile(join(appRoot, pkg.main), "utf8");
  assert.doesNotMatch(code, /(?:from|import\s*)["'](?:\.\.?\/|@zcode\/)/, "Bootstrap has a static application dependency");
  assert.match(code, /ZCODE_DATA_BASE_DIR/);
  assert.match(code, /ZCODE_DESKTOP_PROFILE_HOME/);
  assert.match(code, /import\([^"']/);
  assert.doesNotMatch(code, /sourceMappingURL/, "Use a production build, not a dev/coverage artifact");
  assert.doesNotMatch(await readFile(join(appRoot, "out/main/index.js"), "utf8"), /sourceMappingURL/);
  const chunks = (await readdir(join(appRoot, "out/main"))).filter((name) => /^chunk-.*\.js$/.test(name));
  assert.ok(chunks.length, "Test requires actual multi-entry split production output");
  return { entry: pkg.main, chunks: chunks.length };
}

export async function runProductionProfileEntry(appRoot) {
  const inspected = await inspectProductionProfileEntry(appRoot);
  for (const path of ["out/host/index.js", "out/preload/index.cjs", "out/renderer/index.html"]) {
    await readFile(join(appRoot, path));
  }
  const require = createRequire(import.meta.url);
  const { _electron } = require("playwright-core");
  const executionHome = homedir();
  const repo = resolve(appRoot, "../..");
  const output = join(repo, "test-results/profile-default-entry");
  await mkdir(output, { recursive: true });
  await rm(join(output, "report.json"), { force: true });
  // The existing OS guard permits writes only beneath its output root.
  const sandbox = await mkdtemp(join(output, "sandbox-"));
  const home = join(sandbox, "user");
  const old = join(home, ".zcode/v2/setting.json");
  await mkdir(dirname(old), { recursive: true });
  const sentinel = JSON.stringify({ dataBaseDir: join(sandbox, "legacy-redirect"), sentinel: "do-not-read" });
  await writeFile(old, sentinel);
  const log = join(output, "boundaries.jsonl");
  await writeFile(log, "");
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (/^ZCODE_|^NATIVE_SMOKE_|^ELECTRON_RUN_AS_NODE$/i.test(key)) delete env[key];
  }
  Object.assign(env, {
    HOME: home, USERPROFILE: home,
    APPDATA: join(home, "AppData/Roaming"), LOCALAPPDATA: join(home, "AppData/Local"),
    TEMP: sandbox, TMP: sandbox,
    NATIVE_SMOKE_ROOT: repo, NATIVE_SMOKE_SANDBOX: sandbox, NATIVE_SMOKE_OUTPUT: output,
    NATIVE_SMOKE_FORBIDDEN_HOME: executionHome, NATIVE_SMOKE_BOUNDARY_LOG: log,
    NATIVE_SMOKE_WORKSPACE: join(sandbox, "workspace"),
    NATIVE_SMOKE_HARNESS: fileURLToPath(new URL("../../../scripts/native-smoke", import.meta.url)),
    PROFILE_ENTRY_APP_ROOT: appRoot,
  });
  delete env.NODE_OPTIONS;
  assert.equal(env.ZCODE_DATA_BASE_DIR, undefined);
  assert.equal(env.ZCODE_DESKTOP_PROFILE_HOME, undefined);
  await mkdir(env.NATIVE_SMOKE_WORKSPACE, { recursive: true });
  for (const path of [env.APPDATA, env.LOCALAPPDATA, ...["electron", "electron-session", "logs", "crashDumps"].map((name) => join(home, name))]) {
    await mkdir(path, { recursive: true });
  }
  const bootstrap = fileURLToPath(new URL("profile-entry-bootstrap.cjs", import.meta.url));
  const { closeOwned } = await import("../../../scripts/native-smoke/cleanup.mjs");
  let app;
  let result;
  try {
    app = await _electron.launch({ executablePath: require("electron"), args: [bootstrap], cwd: appRoot, env, timeout: 60000 });
    const deadline = Date.now() + 60000;
    while (!(await app.evaluate(() => globalThis.__profileEntryLoaded === true))) {
      if (Date.now() > deadline) throw new Error("Actual package.main did not finish loading");
      await new Promise((resolveWait) => setTimeout(resolveWait, 100));
    }
    const window = await app.firstWindow({ timeout: 60000 });
    await window.waitForLoadState("domcontentloaded", { timeout: 60000 });
    const facts = await app.evaluate(() => globalThis.__profileEntryFacts());
    const expected = join(home, ".pi-agent-ide");
    assert.equal(facts.home, home);
    assert.equal(facts.userProfile, home);
    assert.equal(facts.profile.settingsHome, expected);
    assert.equal(facts.profile.explicitDataBaseDir, null);
    assert.equal(facts.envDataBaseDir, expected);
    assert.ok(facts.sdkRoots.length, "No actual shared-chunk SDK getter found");
    for (const root of facts.sdkRoots) assert.equal(root.value, expected, JSON.stringify(root));
    assert.equal(await readFile(old, "utf8"), sentinel);
    result = { ...inspected, ...facts, passed: true, dataRootOverrides: false };
  } finally {
    if (app) {
      const cleanup = await closeOwned(app, { env });
      await writeFile(join(output, "cleanup.json"), JSON.stringify(cleanup, null, 2));
      assert.deepEqual(cleanup.survivors, []);
    }
    await rm(sandbox, { recursive: true, force: true });
  }
  const boundaries = (await readFile(log, "utf8")).trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
  assert.deepEqual(boundaries.filter((item) => ["legacy-profile-access", "filesystem-blocked"].includes(item.type)), []);
  const hosts = boundaries.filter((item) => item.type === "utility-child").map((item) => item.detail.pid);
  assert.ok(hosts.length, "No real host/scheduler process started");
  for (const pid of hosts) assert.ok(boundaries.some((item) => item.type === "profile-guard-active" && item.pid === pid), `Utility ${pid} missed profile guard`);
  await writeFile(join(output, "report.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const index = process.argv.indexOf("--app-root");
  if (index < 0 || !process.argv[index + 1]) throw new Error("Usage: node production-profile-entry.mjs --app-root <prepared packages/desktop> [--inspect-only]");
  const appRoot = resolve(process.argv[index + 1]);
  if (process.argv.includes("--inspect-only")) console.log(await inspectProductionProfileEntry(appRoot));
  else await runProductionProfileEntry(appRoot);
}
