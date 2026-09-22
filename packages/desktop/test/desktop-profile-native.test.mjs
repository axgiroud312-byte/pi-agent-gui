// Run through apps/zcode-cli/test/run-product-policy.mjs to load real native source modules.
import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { buildDesktopProfileRuntimeEnv } from "../src/main/desktopProductProfile.ts";

const RESULT_PREFIX = "PROFILE_PROBE=";
const mode = process.argv[2];
if (mode === "--profile-probe") {
  const role = process.argv[3];
  const oldHome = process.argv[4];
  const forbidden = join(oldHome, ".zcode");
  const legacyAccess = [];
  const guard = (operation, original) => (file, ...args) => {
    if (String(file).startsWith(forbidden)) {
      legacyAccess.push(`${operation}:${file}`);
      throw new Error("Original ZCode profile access blocked by test");
    }
    return original(file, ...args);
  };
  if (role !== "standalone") {
    fs.readFileSync = guard("readFileSync", fs.readFileSync);
    fs.existsSync = guard("existsSync", fs.existsSync);
    fsp.readFile = guard("readFile", fsp.readFile);
    fsp.writeFile = guard("writeFile", fsp.writeFile);
    syncBuiltinESMExports();
  }
  let hardwareAcceleration;
  let disableHardwareAccelerationCalls = 0;
  if (role === "main") {
    await import("../src/main/desktopEarlyDataBaseDirBootstrap.ts");
    const { applyEarlyChromiumHardwareAccelerationBootstrap } = await import(
      "../src/main/desktopChromiumHardwareAccelerationBootstrap.ts"
    );
    hardwareAcceleration = applyEarlyChromiumHardwareAccelerationBootstrap({
      disableHardwareAcceleration: () => { disableHardwareAccelerationCalls++; },
    });
  }
  const paths = await import("../../services/src/paths.ts");
  const { getDefaultConfigPath, createConfig } = await import(
    "../../../apps/zcode-cli/packages/adapters/src/config/index.ts"
  );
  const result = {
    home: homedir(),
    base: paths.getDataBaseDir(),
    appConfig: paths.getAppConfigDir(),
    tasks: paths.getTasksIndexDatabasePath(),
    cliConfig: getDefaultConfigPath(),
    hardwareAcceleration,
    disableHardwareAccelerationCalls,
    legacyAccess,
  };
  if (role !== "standalone") {
    const { createSettingService } = await import("../../services/src/setting/settingService.ts");
    const service = createSettingService();
    result.locale = (await service.get()).locale;
    await service.update({ locale: "en-US" });
    result.afterSettingsBase = paths.getDataBaseDir();
    const config = createConfig({ workingDirectory: process.cwd() });
    result.agentStorage = config.config.storage.dir;
    result.agentDatabase = config.config.storage.sessionDbPath;
    result.agentConfig = config.sources.user.path;
    result.settingsHome = process.env.ZCODE_DESKTOP_HOME_DIR;
    result.childEnv = buildDesktopProfileRuntimeEnv(result.base, result.settingsHome);
    if (role === "reset") await service.updateDataBaseDir(undefined);
  }
  console.log(RESULT_PREFIX + JSON.stringify(result));
} else {
  async function fixture(t) {
    const root = await fsp.mkdtemp(join(tmpdir(), "pi-native-profile-"));
    t.after(() => fsp.rm(root, { recursive: true, force: true }));
    const home = join(root, "user");
    const workspace = join(root, "workspace");
    await fsp.mkdir(workspace, { recursive: true });
    const oldSetting = join(home, ".zcode", "v2", "setting.json");
    const oldCli = join(home, ".zcode", "cli", "config.json");
    await put(oldSetting, { dataBaseDir: join(root, "old-redirect"), locale: "zh-CN", desktopChromiumHardwareAccelerationEnabled: false, sentinel: "legacy-settings" });
    await put(oldCli, { storage: { dir: join(root, "old-agent") }, sentinel: "legacy-agent" });
    return { root, home, workspace, oldSetting, oldCli, before: await fsp.readFile(oldSetting), beforeCli: await fsp.readFile(oldCli) };
  }
  async function put(file, value) {
    await fsp.mkdir(dirname(file), { recursive: true });
    await fsp.writeFile(file, JSON.stringify(value));
  }
  function probe(f, role, overrides = {}) {
    const env = { ...process.env, HOME: f.home, USERPROFILE: f.home };
    for (const key of Object.keys(env)) {
      if (/^ZCODE_(DATA_BASE_DIR|DESKTOP_HOME_DIR|HOME|STORAGE_DIR|LOG_DIR|SESSION_DB|SESSION_DB_PATH)$/i.test(key)) delete env[key];
    }
    Object.assign(env, overrides);
    const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), "--profile-probe", role, f.home], {
      cwd: f.workspace, env, encoding: "utf8", timeout: 30000,
    });
    assert.equal(child.status, 0, `${child.stdout}\n${child.stderr}`);
    const line = child.stdout.split(/\r?\n/).find((value) => value.startsWith(RESULT_PREFIX));
    assert.ok(line, child.stdout);
    return JSON.parse(line.slice(RESULT_PREFIX.length));
  }
  async function unchanged(f) {
    assert.deepEqual(await fsp.readFile(f.oldSetting), f.before);
    assert.deepEqual(await fsp.readFile(f.oldCli), f.beforeCli);
  }
  function isolated(result, base, anchor) {
    assert.equal(result.base, base);
    assert.equal(result.afterSettingsBase, base);
    assert.equal(result.home, base);
    assert.equal(result.appConfig, join(base, ".zcode", "v2"));
    assert.equal(result.tasks, join(base, ".zcode", "v2", "tasks-index.sqlite"));
    assert.equal(result.cliConfig, join(base, ".zcode", "cli", "config.json"));
    assert.equal(result.agentConfig, result.cliConfig);
    assert.equal(result.agentStorage, join(base, ".zcode"));
    assert.equal(result.agentDatabase, join(base, ".zcode", "cli", "db", "db.sqlite"));
    assert.equal(result.settingsHome, anchor);
    assert.deepEqual(result.legacyAccess, []);
  }

  test("normal desktop bootstrap and native settings/Agent ignore the original profile", async (t) => {
    const f = await fixture(t);
    const base = join(f.home, ".pi-agent-ide");
    const main = probe(f, "main");
    isolated(main, base, base);
    assert.equal(main.hardwareAcceleration, true);
    assert.equal(main.disableHardwareAccelerationCalls, 0);
    const settings = JSON.parse(await fsp.readFile(join(base, ".zcode", "v2", "setting.json"), "utf8"));
    assert.equal(settings.locale, "en-US");
    await unchanged(f);
  });

  test("Pi custom root propagates to host, scheduler and native Agent with a stable settings anchor", async (t) => {
    const f = await fixture(t);
    const anchor = join(f.home, ".pi-agent-ide");
    const base = join(f.root, "custom");
    await put(join(anchor, ".zcode", "v2", "setting.json"), { dataBaseDir: base, locale: "zh-CN", desktopChromiumHardwareAccelerationEnabled: false });
    await put(join(base, ".zcode", "v2", "state-sentinel.json"), { owner: "pi" });
    const main = probe(f, "main");
    isolated(main, base, anchor);
    assert.equal(main.locale, "zh-CN");
    assert.equal(main.hardwareAcceleration, false);
    assert.equal(main.disableHardwareAccelerationCalls, 1);
    for (const role of ["host", "scheduler", "agent"]) isolated(probe(f, role, main.childEnv), base, anchor);
    assert.equal(fs.existsSync(join(base, ".zcode", "v2", "setting.json")), false);
    const reset = probe(f, "reset", main.childEnv);
    assert.equal(reset.base, base);
    assert.equal(JSON.parse(await fsp.readFile(join(anchor, ".zcode", "v2", "setting.json"), "utf8")).dataBaseDir, undefined);
    assert.deepEqual(JSON.parse(await fsp.readFile(join(anchor, ".zcode", "v2", "state-sentinel.json"), "utf8")), { owner: "pi" });
    isolated(probe(f, "main"), anchor, anchor);
    await unchanged(f);
  });

  test("explicit env base cannot be redirected by either old or Pi persisted settings", async (t) => {
    const f = await fixture(t);
    const base = join(f.root, "explicit");
    await put(join(base, ".zcode", "v2", "setting.json"), { dataBaseDir: join(f.root, "unwanted"), locale: "zh-CN" });
    const main = probe(f, "main", { ZCODE_DATA_BASE_DIR: base, ZCODE_DESKTOP_HOME_DIR: f.home });
    isolated(main, base, base);
    isolated(probe(f, "host", main.childEnv), base, base);
    await unchanged(f);
  });

  test("standalone services and CLI defaults keep their upstream home semantics", async (t) => {
    const f = await fixture(t);
    const raw = probe(f, "standalone");
    assert.equal(raw.base, f.home);
    assert.equal(raw.cliConfig, join(f.home, ".zcode", "cli", "config.json"));
    await unchanged(f);
  });
}
