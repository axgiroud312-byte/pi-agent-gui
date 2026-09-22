import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import {
  applyDesktopProductProfile,
  buildDesktopProfileRuntimeEnv,
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
  const profile = resolveDesktopProductProfile({
    env,
    homePath: home,
    cwd: home,
    readSettings() { assert.fail("explicit base must not consult persisted redirects"); },
  });
  assert.equal(profile.dataBaseDir, resolve(home, "explicit"));
  assert.equal(profile.settingsHome, profile.dataBaseDir);
  applyDesktopProductProfile(profile, env);
  assert.equal(env.ZCODE_DATA_BASE_DIR, profile.dataBaseDir);
  assert.equal(env.HOME, profile.dataBaseDir);
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
  assert.equal(env.ZCODE_DESKTOP_HOME_DIR, anchor);
  assert.equal(env.ZCODE_DATA_BASE_DIR, undefined, "computed main root must not become an explicit override on relaunch");
  assert.equal(resolveDesktopSettingsFile(env), file);
  await setting(file, { dataBaseDir: join(home, "next-data") });
  const relaunched = resolveDesktopProductProfile({ env, homePath: home });
  assert.equal(relaunched.dataBaseDir, join(home, "next-data"));
  assert.equal(relaunched.settingsHome, anchor);
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
  assert.equal(env.HOME, base);
  assert.equal(env.USERPROFILE, base);
  assert.equal(env.ZCODE_DATA_BASE_DIR, base);
  assert.equal(env.ZCODE_DESKTOP_HOME_DIR, anchor);
  assert.equal(env.ZCODE_STORAGE_DIR, join(base, ".zcode"));
  assert.equal(env.ZCODE_HOME, env.ZCODE_STORAGE_DIR);
  assert.equal(env.ZCODE_LOG_DIR, join(base, ".zcode", "cli", "log"));
  assert.equal(env.ZCODE_SESSION_DB_PATH, join(base, ".zcode", "cli", "db", "db.sqlite"));
  assert.equal(env.ZCODE_SESSION_DB, env.ZCODE_SESSION_DB_PATH);
});
