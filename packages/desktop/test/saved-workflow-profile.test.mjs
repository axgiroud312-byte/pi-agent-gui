// Source-level regression: native saved-workflow store/tools/GUI ops with real temporary files.
// Run through apps/zcode-cli/test/run-product-policy.mjs; no model/Agent execution is claimed.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { homedir, tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { serializeSavedWorkflow } from "../../../apps/zcode-cli/packages/core/src/tool/handlers/saved-workflows/frontmatter.ts";

const PI_SCRIPT = 'return { origin: "pi-profile" };\n';
const PROJECT_SCRIPT = 'return { origin: "project" };\n';
const LEGACY_SCRIPT = 'return { origin: "legacy-sentinel" };\n';
const META = { description: "Temporary saved workflow", whenToUse: "Profile regression only" };
const fileIn = (root, name) => join(root, ".zcode/workflows", `${name}.dwf.ts`);

function guardLegacy(root) {
  const accesses = [];
  const restore = [];
  function check(value, method) {
    if (typeof value !== "string" && !(value instanceof URL) && !Buffer.isBuffer(value)) return;
    const path = resolve(value instanceof URL ? fileURLToPath(value) : String(value));
    const rel = relative(root, path);
    if (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)) {
      accesses.push({ method, path });
      throw new Error(`Legacy saved-workflow access: ${method}`);
    }
  }
  for (const target of [fs, fsp]) {
    for (const name of ["readFile", "readdir", "stat", "exists", "open", "writeFile", "mkdir", "unlink", "rename"]) {
      for (const method of [name, `${name}Sync`]) {
        const original = target[method];
        if (typeof original !== "function") continue;
        target[method] = function (...args) {
          check(args[0], method);
          if (name === "rename") check(args[1], method);
          return original.apply(this, args);
        };
        restore.push(() => { target[method] = original; });
      }
    }
  }
  syncBuiltinESMExports();
  return () => {
    for (const undo of restore.reverse()) undo();
    syncBuiltinESMExports();
    assert.deepEqual(accesses, [], "native operations must not even probe the legacy workflow archive");
  };
}

async function runProbe(mode, fixture) {
  const { cwd, home, profile, overrideHome } = fixture;
  const executionBefore = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, home: homedir() };
  const restoreGuard = mode.startsWith("standalone") ? () => {} : guardLegacy(join(home, ".zcode/workflows"));
  try {
    const store = await import("../../../apps/zcode-cli/packages/core/src/tool/handlers/saved-workflows/store.ts");
    const gui = await import("../../../apps/zcode-cli/packages/bootstrap/src/zcode-protocol/saved-workflows.ts");
    const { saveWorkflowToolEntry } = await import("../../../apps/zcode-cli/packages/core/src/tool/handlers/save-workflow.ts");
    const { listSavedWorkflowsToolEntry } = await import("../../../apps/zcode-cli/packages/core/src/tool/handlers/list-saved-workflows.ts");
    const { resolveCreateWorkflowInput } = await import("../../../apps/zcode-cli/packages/core/src/tool/handlers/create-workflow-source.ts");
    const workspace = { workspacePath: cwd, workspaceKey: "saved-workflow-fixture" };
    const context = { workingDirectory: cwd };

    async function saveWithTool(name, scope, script = PI_SCRIPT) {
      const resolved = await saveWorkflowToolEntry.resolveInput({ name, scope, script, ...META }, context);
      assert.equal(resolved.result, true, JSON.stringify(resolved));
      assert.deepEqual(saveWorkflowToolEntry.prepareApproval(resolved.input), { gate: "ask" });
      const written = await saveWorkflowToolEntry.handler(resolved.input, context);
      assert.equal(written.ok, true, JSON.stringify(written));
      assert.equal(resolved.input.path, written.path, "approval and actual write must agree");
      assert.equal(resolved.input.overwrite, written.overwritten);
      return { ...written, approval: resolved.input };
    }

    async function resolveForRun(name, expectedPath, expectedScript, scope) {
      const result = await resolveCreateWorkflowInput({ saved: { name, ...(scope ? { scope } : {}) } }, cwd);
      assert.equal(result.result, true, JSON.stringify(result));
      assert.equal(result.input.saved.path, expectedPath);
      assert.equal(result.input.script, expectedScript);
      assert.ok(result.input.saved.draft, "native source resolution should write a real draft");
      assert.equal(await fsp.readFile(result.input.saved.draft, "utf8"), await fsp.readFile(expectedPath, "utf8"));
    }

    async function globalRoundTrip(anchor, name) {
      const path = fileIn(anchor, name);
      const params = { workspace, scope: "global", name };
      const listed = await gui.listSavedWorkflowsOp({}, { workspace, scope: "global" });
      assert.equal(listed.dir, dirname(path));
      assert.deepEqual(listed.invalid, []);
      const saved = await saveWithTool(name, "global");
      assert.equal(saved.path, path);
      assert.equal(saved.overwritten, false);
      assert.equal(store.savedWorkflowExists({ cwd, name, scope: "global" }), true);
      assert.equal((await saveWithTool(name, "global")).overwritten, true);

      // Movable v2/storage overrides must not re-home the saved global archive.
      process.env.ZCODE_DATA_BASE_DIR = join(fixture.root, "moved-v2");
      process.env.ZCODE_STORAGE_DIR = join(fixture.root, "other-storage");
      const refreshed = await gui.listSavedWorkflowsOp({}, { workspace, scope: "global" });
      assert.ok(refreshed.workflows.some((entry) => entry.name === name && entry.path === path));
      const toolList = await listSavedWorkflowsToolEntry.handler({}, context);
      assert.ok(toolList.workflows.some((entry) => entry.name === name && entry.path === path));
      const got = await gui.getSavedWorkflowOp({}, params);
      assert.equal(got.ok, true);
      assert.equal(got.script, PI_SCRIPT);
      assert.equal(got.path, path);
      assert.deepEqual(await gui.updateSavedWorkflowMetaOp({}, { ...params, meta: { description: "Updated in Pi" } }), { ok: true, path });
      const updated = await gui.getSavedWorkflowOp({}, params);
      assert.equal(updated.meta.description, "Updated in Pi");
      assert.equal(updated.script, PI_SCRIPT);
      await resolveForRun(name, path, PI_SCRIPT, "global");

      const bytes = await fsp.readFile(path);
      const projectPath = fileIn(cwd, name);
      assert.deepEqual(await gui.moveSavedWorkflowOp({}, { workspace, name }), { ok: true, from: path, to: projectPath });
      assert.deepEqual(await fsp.readFile(projectPath), bytes, "move preserves exact source bytes");
      assert.equal(fs.existsSync(path), false);
      assert.deepEqual(await gui.getSavedWorkflowOp({}, params), { ok: false, reason: "not_found" });
      await resolveForRun(name, projectPath, PI_SCRIPT);
      assert.equal((await gui.getSavedWorkflowOp({}, { workspace, name })).path, projectPath);

      assert.deepEqual(await gui.deleteSavedWorkflowOp({}, { workspace, name }), { ok: true, path: projectPath });
      assert.equal(fs.existsSync(projectPath), false);
      assert.equal((await saveWithTool(name, "global")).overwritten, false);
      assert.deepEqual(await gui.deleteSavedWorkflowOp({}, params), { ok: true, path });
      assert.equal(fs.existsSync(path), false);
      assert.deepEqual(await gui.deleteSavedWorkflowOp({}, params), { ok: false, reason: "not_found" });
    }

    if (mode === "desktop") {
      await globalRoundTrip(profile, "victim");
      const params = { workspace, scope: "global", name: "legacy-only" };
      assert.deepEqual(await gui.getSavedWorkflowOp({}, params), { ok: false, reason: "not_found" });
      assert.deepEqual(await gui.updateSavedWorkflowMetaOp({}, { ...params, meta: META }), { ok: false, reason: "not_found" });
      assert.deepEqual(await gui.deleteSavedWorkflowOp({}, params), { ok: false, reason: "not_found" });
      assert.deepEqual(await gui.moveSavedWorkflowOp({}, { workspace, name: params.name }), { ok: false, reason: "not_found" });
      assert.equal((await resolveCreateWorkflowInput({ saved: { name: params.name } }, cwd)).result, false);
      assert.deepEqual((await gui.listSavedWorkflowsOp({}, { workspace, scope: "global" })).workflows, []);
    } else if (mode === "options") {
      const name = "shadowed";
      const global = await saveWithTool(name, "global");
      assert.equal(global.path, fileIn(profile, name));
      const project = store.saveSavedWorkflow({ cwd, name, meta: META, script: PROJECT_SCRIPT });
      assert.equal(project.scope, "project", "omitted scope still saves to the workspace");
      assert.equal(project.path, fileIn(cwd, name));
      assert.equal(store.resolveSavedWorkflow({ cwd, name }).script, PROJECT_SCRIPT);
      assert.deepEqual(store.listSavedWorkflows({ cwd }).entries.map((entry) => entry.scope), ["project"]);
      assert.equal((await saveWithTool(name, "global")).approval.shadowing, "hidden_by_project");
      assert.equal(store.findSavedWorkflowShadowing({ cwd, name, scope: "project" }), "hides_global");
      await resolveForRun(name, project.path, PROJECT_SCRIPT);
      await resolveForRun(name, global.path, PI_SCRIPT, "global");
      assert.equal((await gui.getSavedWorkflowOp({}, { workspace, name })).script, PROJECT_SCRIPT);
      assert.deepEqual(await gui.moveSavedWorkflowOp({}, { workspace, name }), { ok: false, reason: "target_exists", path: project.path });
      assert.deepEqual(await gui.deleteSavedWorkflowOp({}, { workspace, name }), { ok: true, path: project.path });
      assert.equal(fs.existsSync(global.path), true, "default GUI delete must not delete the global definition");

      const options = { cwd, homeDir: overrideHome, name: "injected", scope: "global" };
      const injected = store.saveSavedWorkflow({ ...options, meta: META, script: PROJECT_SCRIPT });
      assert.equal(injected.path, fileIn(overrideHome, options.name));
      assert.equal(store.savedWorkflowExists(options), true);
      assert.equal(store.resolveSavedWorkflow(options).script, PROJECT_SCRIPT);
      assert.deepEqual(store.listSavedWorkflows(options).entries.map((entry) => entry.path), [injected.path]);
      assert.equal(store.resolveSavedWorkflow({ cwd, name: options.name }).ok, false);
      assert.deepEqual(store.moveSavedWorkflow(options), { ok: true, from: injected.path, to: fileIn(cwd, options.name) });
      assert.equal(store.savedWorkflowRoot(cwd, "global", { homeDir: "" }).dir, join(".zcode", "workflows"));
      assert.equal(store.savedWorkflowRoot(cwd, "global", { homeDir: "relative-home" }).dir, join("relative-home", ".zcode/workflows"));
      assert.equal(store.savedWorkflowRoot(cwd, "global", { homeDir: undefined }).dir, join(profile, ".zcode/workflows"));
    } else {
      assert.equal(store.savedWorkflowRoot(cwd, "global").dir, join(home, ".zcode/workflows"));
      const legacy = await gui.getSavedWorkflowOp({}, { workspace, name: "legacy-only", scope: "global" });
      assert.equal(legacy.ok, true);
      assert.equal(legacy.script, LEGACY_SCRIPT, "standalone CLI must still read its existing user archive");
      await globalRoundTrip(home, "standalone-new");
      assert.equal(fs.existsSync(join(profile, ".zcode/workflows")), false);
    }
    assert.deepEqual({ HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, home: homedir() }, executionBefore);
  } finally {
    restoreGuard();
  }
}

if (process.argv[2] === "--saved-workflow-probe") {
  await runProbe(process.argv[3], JSON.parse(process.argv[4]));
} else {
  for (const [mode, title] of [
    ["desktop", "Pi SaveWorkflow + GUI list/get/update/delete/move + run resolution never access the legacy archive"],
    ["options", "saved workflows preserve project defaults/shadowing and explicit homeDir option semantics"],
    ["standalone", "standalone saved workflow lifecycle still uses native HOME"],
    ["standalone-blank", "blank app profile preserves standalone saved workflow defaults"],
  ]) {
    test(title, async (t) => {
      const root = await fsp.mkdtemp(join(tmpdir(), "pi-saved-workflow-"));
      t.after(() => fsp.rm(root, { recursive: true, force: true }));
      const fixture = { root, cwd: join(root, "workspace"), home: join(root, "user"),
        profile: join(root, "pi-profile"), overrideHome: join(root, "explicit-home") };
      await fsp.mkdir(fixture.cwd);
      const sentinels = ["victim", "legacy-only", "shadowed"].map((name) => fileIn(fixture.home, name));
      await fsp.mkdir(dirname(sentinels[0]), { recursive: true });
      const sentinelBytes = serializeSavedWorkflow({ description: "Original application sentinel" }, LEGACY_SCRIPT);
      for (const file of sentinels) await fsp.writeFile(file, sentinelBytes);
      const env = { ...process.env };
      for (const key of Object.keys(env)) if (/^ZCODE_|^NATIVE_SMOKE_|^NODE_OPTIONS$/i.test(key)) delete env[key];
      Object.assign(env, { HOME: fixture.home, USERPROFILE: fixture.home,
        APPDATA: join(fixture.home, "AppData/Roaming"), LOCALAPPDATA: join(fixture.home, "AppData/Local"),
        ZCODE_DATA_BASE_DIR: join(root, "active-v2"), ZCODE_STORAGE_DIR: join(root, "unrelated-storage") });
      if (!mode.startsWith("standalone")) env.ZCODE_DESKTOP_PROFILE_HOME = fixture.profile;
      if (mode === "standalone-blank") env.ZCODE_DESKTOP_PROFILE_HOME = "  ";
      const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), "--saved-workflow-probe", mode, JSON.stringify(fixture)],
        { cwd: fixture.cwd, env, encoding: "utf8", timeout: 30000 });
      assert.equal(child.status, 0, `${child.stdout}\n${child.stderr}`);
      for (const file of sentinels) assert.equal(await fsp.readFile(file, "utf8"), sentinelBytes);
    });
  }
}
