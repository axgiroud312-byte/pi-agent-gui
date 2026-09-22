// Source-level behavior contracts. Production multi-entry proof is a separate prepared-app test.
import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { homedir, tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import {
  buildDesktopProfileRuntimeEnv,
  initializeDesktopProductProfile,
  installDesktopProfileRelaunch,
} from "../src/main/desktopProductProfile.ts";

const PREFIX = "PROFILE_PROBE=";
const SECRET = "fixture-credential-not-a-real-key";
const SESSION = "profile-history-fixture";

if (process.argv[2] === "--profile-probe") {
  const [role, oldHome, action, target] = process.argv.slice(3, 7);
  const legacyAccess = [];
  const forbidden = join(oldHome, ".zcode");
  const guard = (operation, original) => (file, ...args) => {
    const path = file instanceof URL ? fileURLToPath(file) : String(file);
    const rel = relative(forbidden, resolve(path));
    if (!rel.startsWith("..") && !isAbsolute(rel)) {
      legacyAccess.push(`${operation}:${file}`);
      throw new Error("Original ZCode profile access blocked by test");
    }
    return original(file, ...args);
  };
  if (role !== "standalone") {
    for (const name of ["readFileSync", "writeFileSync", "existsSync", "statSync", "readdirSync"]) fs[name] = guard(name, fs[name]);
    for (const name of ["readFile", "writeFile", "stat", "lstat", "access", "readdir"]) fsp[name] = guard(name, fsp[name]);
    syncBuiltinESMExports();
  }
  const executionBefore = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
  const profile = role === "main" ? initializeDesktopProductProfile() : undefined;
  const paths = await import("../../services/src/paths.ts");
  const { getDefaultConfigPath, createConfig } = await import(
    "../../../apps/zcode-cli/packages/adapters/src/config/index.ts"
  );
  const result = {
    home: homedir(), base: paths.getDataBaseDir(), appConfig: paths.getAppConfigDir(),
    tasks: paths.getTasksIndexDatabasePath(), cliConfig: getDefaultConfigPath(),
    executionBefore, executionAfter: { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE },
    legacyAccess,
  };
  if (role !== "standalone") {
    const { createSettingService } = await import("../../services/src/setting/settingService.ts");
    const { createCredentialService } = await import("../../services/src/credential/credentialService.ts");
    const { createSqliteSessionStore } = await import(
      "../../../apps/zcode-cli/packages/adapters/src/storage/session-store/sqlite-session-store.ts"
    );
    const { listSSHConfigAliasesFromLocalConfig } = await import("../../services/src/system/sshConfigAlias.ts");
    const { resolveTerminalFontProfile } = await import("../../services/src/terminal/terminalProfile.ts");
    const { createNodeContextSourceAdapter } = await import("../../../apps/zcode-cli/packages/adapters/src/context/index.ts");
    const { createSkillsService } = await import("../../services/src/skills/skillsService.ts");
    const { createNodeCustomCommandAdapter } = await import("../../../apps/zcode-cli/packages/adapters/src/commands/index.ts");
    const { resolveWorkspaceHookTrustStorePath } = await import("../../../apps/zcode-cli/packages/adapters/src/storage/workspace-hook-trust-store.ts");
    const settings = createSettingService();
    result.locale = (await settings.get()).locale;
    await settings.update({ locale: "en-US" });
    const config = createConfig({ workingDirectory: process.cwd() });
    result.agentStorage = config.config.storage.dir;
    result.agentDatabase = config.config.storage.sessionDbPath;
    result.profileHome = process.env.ZCODE_DESKTOP_PROFILE_HOME;
    result.childEnv = buildDesktopProfileRuntimeEnv(result.base, result.profileHome);
    result.instructions = (await createNodeContextSourceAdapter().resolveContextSources({
      workingDirectory: process.cwd(), userInstructions: { workingDirectory: process.cwd() },
    })).userInstructions;
    result.skills = await createSkillsService({ isDesktopRuntime: true }).list({ workspacePath: process.cwd() });
    result.commands = await createNodeCustomCommandAdapter().discoverCommands({ workingDirectory: process.cwd() });
    result.hookTrustFile = await resolveWorkspaceHookTrustStorePath();
    result.ssh = await listSSHConfigAliasesFromLocalConfig();
    const git = spawnSync("git", ["config", "--global", "user.name"], { encoding: "utf8" });
    assert.equal(git.status, 0, git.stderr);
    result.gitName = git.stdout.trim();
    result.terminalProfile = resolveTerminalFontProfile({ settings: {}, env: process.env });
    const shell = process.platform === "win32"
      ? spawnSync(process.env.ComSpec || "cmd.exe", ["/d", "/c", "echo %USERPROFILE%"], { encoding: "utf8" })
      : spawnSync("/bin/sh", ["-c", 'printf "%s" "$HOME"'], { encoding: "utf8" });
    assert.equal(shell.status, 0, shell.stderr);
    result.terminalHome = shell.stdout.trim();
    const credentials = createCredentialService();
    const store = createSqliteSessionStore();
    try {
      result.historyPath = store.getDatabasePath();
      if (action === "seed") {
        await credentials.save("fixture:profile", SECRET);
        await store.createSession({ id: SESSION, projectID: "profile-project", slug: "profile-history", directory: process.cwd(), title: "History survives a data move", version: "1" });
      }
      result.credential = await credentials.load("fixture:profile");
      result.session = await store.getSession(SESSION);
    } finally { store.close(); }
    if (action === "move") await settings.updateDataBaseDir(target);
    if (action === "reset") await settings.updateDataBaseDir(undefined);
    if (profile) {
      const app = { relaunch: (options) => { result.relaunchArgs = options.args; } };
      installDesktopProfileRelaunch(app, profile, [process.execPath, fileURLToPath(import.meta.url)]);
      app.relaunch();
    }
  }
  console.log(PREFIX + JSON.stringify(result));
} else {
  async function put(file, value) {
    await fsp.mkdir(dirname(file), { recursive: true });
    await fsp.writeFile(file, typeof value === "string" ? value : JSON.stringify(value));
  }
  async function fixture(t) {
    const root = await fsp.mkdtemp(join(tmpdir(), "pi-native-profile-"));
    t.after(() => fsp.rm(root, { recursive: true, force: true }));
    const home = join(root, "user");
    const workspace = join(root, "workspace");
    await fsp.mkdir(workspace, { recursive: true });
    await fsp.mkdir(join(workspace, ".git"));
    const oldSetting = join(home, ".zcode", "v2", "setting.json");
    const oldCli = join(home, ".zcode", "cli", "config.json");
    await put(oldSetting, { dataBaseDir: join(root, "old-redirect"), sentinel: "legacy-settings" });
    await put(oldCli, { storage: { dir: join(root, "old-agent") }, sentinel: "legacy-agent" });
    await put(join(home, ".zcode", "AGENTS.md"), "legacy instructions must not load");
    await put(join(home, ".pi-agent-ide", ".zcode", "AGENTS.md"), "Pi profile instructions");
    const skill = (name) => `---\nname: ${name}\ndescription: Profile fixture skill\n---\nFixture instructions.\n`;
    await put(join(home, ".pi-agent-ide", ".zcode", "skills", "pi-fixture", "SKILL.md"), skill("pi-fixture"));
    await put(join(home, ".agents", "skills", "external-fixture", "SKILL.md"), skill("external-fixture"));
    await put(join(workspace, ".zcode", "skills", "workspace-fixture", "SKILL.md"), skill("workspace-fixture"));
    await put(join(home, ".pi-agent-ide", ".zcode", "commands", "pi-fixture.md"), "Pi command");
    await put(join(home, ".agents", "commands", "external-fixture.md"), "External command");
    await put(join(workspace, ".zcode", "commands", "workspace-fixture.md"), "Workspace command");
    await put(join(home, ".gitconfig"), '[user]\n name = Execution Home User\n email = fixture@example.invalid\n');
    await put(join(home, ".ssh", "config"), "Host profile-fixture\n HostName fixture.example.invalid\n User fixture\n Port 2222\n");
    await put(join(home, ".config", "Code", "User", "settings.json"), { "terminal.integrated.fontFamily": "Profile Test Mono" });
    return { root, home, workspace, oldSetting, oldCli, before: await fsp.readFile(oldSetting), beforeCli: await fsp.readFile(oldCli) };
  }
  function probe(f, role, overrides = {}, action = "", target = "", marker) {
    const env = { ...process.env, HOME: f.home, USERPROFILE: f.home,
      APPDATA: join(f.home, "AppData/Roaming"), LOCALAPPDATA: join(f.home, "AppData/Local") };
    for (const key of Object.keys(env)) {
      if (/^ZCODE_|^GIT_CONFIG_|^XDG_CONFIG_HOME$/i.test(key)) delete env[key];
    }
    Object.assign(env, overrides);
    const args = [fileURLToPath(import.meta.url), "--profile-probe", role, f.home, action, target];
    if (marker) args.push(marker);
    const child = spawnSync(process.execPath, args, { cwd: f.workspace, env, encoding: "utf8", timeout: 30000 });
    assert.equal(child.status, 0, `${child.stdout}\n${child.stderr}`);
    const line = child.stdout.split(/\r?\n/).find((value) => value.startsWith(PREFIX));
    assert.ok(line, child.stdout);
    return JSON.parse(line.slice(PREFIX.length));
  }
  async function unchanged(f) {
    assert.deepEqual(await fsp.readFile(f.oldSetting), f.before);
    assert.deepEqual(await fsp.readFile(f.oldCli), f.beforeCli);
  }
  function isolated(result, f, base, anchor) {
    assert.equal(result.base, base);
    assert.equal(result.home, f.home);
    assert.deepEqual(result.executionAfter, result.executionBefore);
    assert.equal(result.appConfig, join(base, ".zcode/v2"));
    assert.equal(result.tasks, join(base, ".zcode/v2/tasks-index.sqlite"));
    assert.equal(result.cliConfig, join(anchor, ".zcode/cli/config.json"));
    assert.equal(result.agentStorage, join(anchor, ".zcode"));
    assert.equal(result.agentDatabase, join(anchor, ".zcode/cli/db/db.sqlite"));
    assert.equal(result.historyPath, result.agentDatabase);
    assert.equal(result.profileHome, anchor);
    assert.equal(result.instructions.sources.find((source) => source.scope === "user").content, "Pi profile instructions");
    assert.deepEqual(result.skills.skills.map((skill) => skill.name).sort(), ["external-fixture", "pi-fixture", "workspace-fixture"]);
    assert.deepEqual(result.commands.commands.map((command) => command.name).sort(), ["external-fixture", "pi-fixture", "workspace-fixture"]);
    assert.equal(result.hookTrustFile, join(anchor, ".zcode/security/workspace-hook-trust-v1.json"));
    assert.equal(result.gitName, "Execution Home User");
    assert.ok(result.ssh.some((item) => item.alias === "profile-fixture" && item.port === 2222));
    assert.match(result.terminalProfile.fontFamily, /Profile Test Mono/);
    assert.equal(result.terminalHome, f.home);
    assert.deepEqual(result.legacyAccess, []);
  }

  test("desktop app isolation preserves real Git global config, SSH aliases and terminal HOME/profile", async (t) => {
    const f = await fixture(t);
    const anchor = join(f.home, ".pi-agent-ide");
    const main = probe(f, "main");
    isolated(main, f, anchor, anchor);
    for (const role of ["host", "scheduler", "agent"]) isolated(probe(f, role, main.childEnv), f, anchor, anchor);
    await unchanged(f);
  });

  test("actual encrypted credentials and native SQLite history survive v2 data moves and relaunch", async (t) => {
    const f = await fixture(t);
    const anchor = join(f.home, ".pi-agent-ide");
    const base = join(f.root, "custom-v2");
    const seeded = probe(f, "main", {}, "seed");
    assert.equal(seeded.credential, SECRET);
    const encrypted = await fsp.readFile(join(anchor, ".zcode/v2/credentials.json"), "utf8");
    assert.match(encrypted, /enc:v1:/);
    assert.ok(!encrypted.includes(SECRET));
    const moved = probe(f, "main", {}, "move", base);
    const marker = moved.relaunchArgs.find((arg) => arg.startsWith("--pi-desktop-profile-relaunch="));
    assert.ok(marker);
    const restored = probe(f, "main", moved.childEnv, "", "", marker);
    isolated(restored, f, base, anchor);
    assert.equal(restored.credential, SECRET);
    assert.equal(restored.session.title, "History survives a data move");
    assert.equal(restored.historyPath, seeded.historyPath);
    assert.equal(await fsp.readFile(join(base, ".zcode/v2/credentials.json"), "utf8"), encrypted);
    assert.equal(fs.existsSync(join(base, ".zcode/cli")), false);
    isolated(probe(f, "main"), f, base, anchor); // Fresh Explorer/deep-link launch, no inherited app env.
    const reset = probe(f, "main", {}, "reset");
    const resetMarker = reset.relaunchArgs.find((arg) => arg.startsWith("--pi-desktop-profile-relaunch="));
    const defaultAgain = probe(f, "main", reset.childEnv, "", "", resetMarker);
    isolated(defaultAgain, f, anchor, anchor);
    assert.equal(defaultAgain.credential, SECRET);
    assert.equal(defaultAgain.session.id, SESSION);
    await unchanged(f);
  });

  test("explicit data override wins while settings and history keep their independent profile anchor", async (t) => {
    const f = await fixture(t);
    const anchor = join(f.home, ".pi-agent-ide");
    const base = join(f.root, "explicit-v2");
    await put(join(anchor, ".zcode/v2/setting.json"), { dataBaseDir: join(f.root, "persisted-v2") });
    const main = probe(f, "main", { ZCODE_DATA_BASE_DIR: base });
    isolated(main, f, base, anchor);
    if (process.platform === "win32") isolated(probe(f, "main", { zcode_data_base_dir: base }), f, base, anchor);
    const marker = main.relaunchArgs.find((arg) => arg.startsWith("--pi-desktop-profile-relaunch="));
    isolated(probe(f, "main", main.childEnv, "", "", marker), f, base, anchor);
    await unchanged(f);
  });

  test("standalone services and CLI keep upstream defaults", async (t) => {
    const f = await fixture(t);
    const raw = probe(f, "standalone");
    assert.equal(raw.base, f.home);
    assert.equal(raw.cliConfig, join(f.home, ".zcode/cli/config.json"));
    await unchanged(f);
  });
}
