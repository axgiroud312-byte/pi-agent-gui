import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import {
  applyDesktopProductProfile,
  buildDesktopProfileRuntimeEnv,
  initializeDesktopProductProfile,
  installDesktopProfileRelaunch,
  resolveDesktopProductProfile,
  resolveDesktopSettingsFile,
} from "../src/main/desktopProductProfile.ts";

async function fixture(t) {
  const home = await mkdtemp(join(tmpdir(), "pi-profile-policy-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  return home;
}

async function setting(file, value) {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(value));
}

test("default desktop reads only the Pi profile, ignoring a legacy redirect sentinel", async (t) => {
  const home = await fixture(t);
  const old = join(home, ".zcode", "v2", "setting.json");
  await setting(old, { dataBaseDir: join(home, "legacy-redirect"), sentinel: "original" });
  const before = await readFile(old);
  const reads = [];
  const profile = resolveDesktopProductProfile({
    env: { HOME: home, USERPROFILE: home },
    homePath: home,
    readSettings(file) {
      reads.push(file);
      assert.notEqual(file, old);
      throw Object.assign(new Error("missing"), { code: "ENOENT" });
    },
  });
  assert.equal(profile.dataBaseDir, join(home, ".pi-agent-ide"));
  assert.deepEqual(reads, [join(home, ".pi-agent-ide", ".zcode", "v2", "setting.json")]);
  assert.deepEqual(await readFile(old), before);
});

test("explicit data base wins before any bootstrap read, including conflicting desktop HOME", async (t) => {
  const home = await fixture(t);
  const env = { HOME: home, ZCODE_DESKTOP_HOME_DIR: home, ZCODE_DATA_BASE_DIR: " ./explicit " };
  const reads = [];
  const profile = resolveDesktopProductProfile({
    env,
    homePath: home,
    cwd: home,
    readSettings(file) { reads.push(file); return JSON.stringify({ dataBaseDir: home }); },
  });
  assert.deepEqual(reads, [], "explicit base must not consult persisted redirects");
  assert.equal(profile.dataBaseDir, resolve(home, "explicit"));
  assert.equal(profile.settingsHome, join(home, ".pi-agent-ide"));
  applyDesktopProductProfile(profile, env);
  assert.equal(env.ZCODE_DATA_BASE_DIR, profile.dataBaseDir);
  assert.equal(env.HOME, home);
  assert.equal(env.ZCODE_DESKTOP_HOME_DIR, home);
  assert.equal(resolveDesktopSettingsFile(env), profile.settingsFile);
});

test("Pi custom data directory restores while settings remain at the stable Pi anchor", async (t) => {
  const home = await fixture(t);
  const anchor = join(home, ".pi-agent-ide");
  const custom = join(home, "custom-data");
  const file = join(anchor, ".zcode", "v2", "setting.json");
  await setting(file, { dataBaseDir: custom });
  const env = { HOME: home, USERPROFILE: home };
  const profile = resolveDesktopProductProfile({ env, homePath: home });
  assert.equal(profile.dataBaseDir, custom);
  applyDesktopProductProfile(profile, env);
  assert.equal(env.ZCODE_DESKTOP_PROFILE_HOME, anchor);
  assert.equal(env.HOME, home);
  assert.equal(env.USERPROFILE, home);
  assert.equal(env.ZCODE_DATA_BASE_DIR, custom, "computed root must be set before shared chunks evaluate");
  assert.equal(resolveDesktopSettingsFile(env), file);
  await setting(file, { dataBaseDir: join(home, "next-data") });
  let restart;
  const app = { relaunch: (options) => { restart = options; } };
  installDesktopProfileRelaunch(app, profile, ["electron", "app"]);
  app.relaunch();
  const relaunched = initializeDesktopProductProfile(env, ["electron", ...restart.args]);
  assert.equal(relaunched.dataBaseDir, join(home, "next-data"));
  assert.equal(relaunched.settingsHome, anchor);
  assert.equal(env.ZCODE_DATA_BASE_DIR, relaunched.dataBaseDir);
  // A caller changing the env between launches must not be overridden by the old marker.
  env.ZCODE_DATA_BASE_DIR = join(home, "caller-new-root");
  assert.equal(initializeDesktopProductProfile(env, ["electron", ...restart.args]).dataBaseDir, env.ZCODE_DATA_BASE_DIR);
});

test("invalid/blank Pi settings stay in profile; persisted relative paths use its anchor", async (t) => {
  const home = await fixture(t);
  const env = { HOME: home };
  const anchor = join(home, ".pi-agent-ide");
  for (const contents of ["broken", "null", "[]", '{"dataBaseDir":" "}']) {
    assert.equal(resolveDesktopProductProfile({ env, readSettings: () => contents }).dataBaseDir, anchor);
  }
  assert.equal(resolveDesktopProductProfile({
    env, readSettings: () => '{"dataBaseDir":"data"}',
  }).dataBaseDir, join(anchor, "data"));
});

test("host/scheduler and inherited Agent storage receive the same absolute root", async (t) => {
  const home = await fixture(t);
  const anchor = join(home, ".pi-agent-ide");
  const base = join(home, "custom-data");
  const env = {
    HOME: home, USERPROFILE: home, ZCODE_DATA_BASE_DIR: home,
    ...buildDesktopProfileRuntimeEnv(base, anchor),
  };
  assert.equal(env.HOME, home);
  assert.equal(env.USERPROFILE, home);
  assert.equal(env.ZCODE_DATA_BASE_DIR, base);
  assert.equal(env.ZCODE_DESKTOP_PROFILE_HOME, anchor);
  assert.equal(env.ZCODE_STORAGE_DIR, join(anchor, ".zcode"));
  assert.equal(env.ZCODE_HOME, env.ZCODE_STORAGE_DIR);
  assert.equal(env.ZCODE_LOG_DIR, join(anchor, ".zcode", "cli", "log"));
  assert.equal(env.ZCODE_SESSION_DB_PATH, join(anchor, ".zcode", "cli", "db", "db.sqlite"));
  assert.equal(env.ZCODE_SESSION_DB, env.ZCODE_SESSION_DB_PATH);
});

test("explicit app anchor normalizes independently of OS/test HOME and movable data root", async (t) => {
  const home = await fixture(t);
  const env = { HOME: home, USERPROFILE: home, ZCODE_DESKTOP_HOME_DIR: join(home, "os-test-home"),
    ZCODE_DESKTOP_PROFILE_HOME: " ./app-profile ", ZCODE_DATA_BASE_DIR: " ./movable-v2 " };
  const profile = resolveDesktopProductProfile({ env, cwd: home });
  applyDesktopProductProfile(profile, env);
  assert.equal(env.ZCODE_DESKTOP_PROFILE_HOME, join(home, "app-profile"));
  assert.equal(env.ZCODE_DATA_BASE_DIR, join(home, "movable-v2"));
  assert.equal(env.ZCODE_DESKTOP_HOME_DIR, join(home, "os-test-home"));
  assert.equal(env.HOME, home);
  assert.equal(env.USERPROFILE, home);
  assert.equal(profile.settingsFile, join(home, "app-profile", ".zcode/v2/setting.json"));
});

test("malformed, relative and duplicate relaunch markers fail before changing the environment", async (t) => {
  const home = await fixture(t);
  const prefix = "--pi-desktop-profile-relaunch=";
  for (const value of ["broken", null, {}, { version: 2, derivedDataBaseDir: home, explicitDataBaseDir: null },
    { version: 1, derivedDataBaseDir: "relative", explicitDataBaseDir: null },
    { version: 1, derivedDataBaseDir: home, explicitDataBaseDir: "relative" }]) {
    const env = { HOME: home };
    assert.throws(() => initializeDesktopProductProfile(env, ["electron", prefix + encodeURIComponent(JSON.stringify(value))]));
    assert.deepEqual(env, { HOME: home });
  }
  assert.throws(() => initializeDesktopProductProfile({ HOME: home }, ["electron", prefix, prefix]), /Multiple/);
});
