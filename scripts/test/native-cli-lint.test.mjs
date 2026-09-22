import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  assessReports, validateTopology, validateTaskPlan, validateSourcePragmas, validateRawResult, sourceBlob,
} from "../check-native-cli-lint.mjs";

const repo = fileURLToPath(new URL("../../", import.meta.url));
const policy = JSON.parse(readFileSync(join(repo, "scripts/native-cli-lint-baseline.json"), "utf8"));
const oxlint = join(repo, "apps/zcode-cli/node_modules/oxlint/bin/oxlint");
const put = (root, file, text) => {
  mkdirSync(dirname(join(root, file)), { recursive: true });
  writeFileSync(join(root, file), text);
};
const json = (root, file, value) => put(root, file, JSON.stringify(value));
const lines = (n) => Array.from({ length: n }, (_, i) => `export const v${i} = ${i};`).join("\n") + "\n";
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "native lint gate "));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const pkg = { directory: "packages/example", name: "@zcode/example", lint: "oxlint src", minimumFiles: 1 };
  const file = `apps/zcode-cli/${pkg.directory}/src/original.ts`;
  put(root, file, lines(401));
  json(root, ".oxlintrc.json", { rules: { "max-lines": ["error", policy.options], "no-debugger": "error" } });
  const baseline = {
    ...structuredClone(policy), packages: [pkg], allowances: {}, inlinePragmaBlobs: {},
    files: [{ file, rule: policy.rule, count: 1, upstreamLines: 401, maxLines: 401, upstreamBlob: sourceBlob(lines(401)) }],
  };
  const lint = () => ({
    ...pkg,
    ...spawnSync(process.execPath, [oxlint, ...pkg.lint.split(" ").slice(1), "--format", "json"], {
      cwd: join(root, "apps/zcode-cli", pkg.directory), encoding: "utf8",
    }),
  });
  return { root, file, pkg, baseline, lint, check: () => assessReports(root, baseline, [lint()]) };
}
const fails = (result, pattern) => {
  assert.ok(result.failures.length > 0, "gate must fail");
  assert.match(result.failures.join("\n"), pattern);
};

test("real oxlint: unchanged original overlong source accepted, raw error remains", (t) => {
  const f = fixture(t);
  assert.equal(f.lint().status, 1);
  assert.equal(f.check().accepted[0].lines, 401);
  assert.deepEqual(f.check().failures, []);
  put(f.root, f.file, lines(401).replaceAll("\n", "\r\n"));
  assert.deepEqual(assessReports(f.root, f.baseline, [f.lint()], { verifyUpstream: true }).failures, []);
});

test("real oxlint: one unapproved effective line of growth is rejected", (t) => {
  const f = fixture(t);
  put(f.root, f.file, lines(402));
  fails(f.check(), /growth.*402.*401/);
});

test("real oxlint: unknown overlong file cannot spend an existing file's budget", (t) => {
  const f = fixture(t);
  put(f.root, f.file.replace("original.ts", "new.ts"), lines(401));
  fails(f.check(), /unknown.*new\.ts/);
});

test("real oxlint: other error on a baselined file is never forgiven", (t) => {
  const f = fixture(t);
  put(f.root, f.file, "debugger;\n" + lines(400));
  fails(f.check(), /no-debugger/);
});

test("real oxlint: non-max-lines error in a short new file is rejected", (t) => {
  const f = fixture(t);
  put(f.root, f.file.replace("original.ts", "new.ts"), "debugger;\n");
  fails(f.check(), /new\.ts.*no-debugger/);
});

test("real oxlint: explicit wiring is bounded by both count and reviewed source blob", (t) => {
  const f = fixture(t);
  f.baseline.files[0].maxLines = 403;
  f.baseline.allowances[f.file] = { lines: 2, blob: sourceBlob(lines(403)), reason: "Reviewed fixture wiring" };
  put(f.root, f.file, lines(403));
  assert.deepEqual(f.check().failures, []);
  put(f.root, f.file, lines(404));
  fails(f.check(), /growth/);
  put(f.root, f.file, lines(402));
  fails(f.check(), /unapproved wiring/);
  put(f.root, f.file, lines(403).replace("v0 = 0", "v0 = 9"));
  fails(f.check(), /unapproved wiring/);
});

test("real oxlint: comments and blank lines use native effective-line semantics", (t) => {
  const f = fixture(t);
  put(f.root, f.file, "// comment\n\n/* comment\ncomment */\n" + lines(401));
  assert.deepEqual(f.check().failures, []);
});

test("real oxlint: inline suppression cannot silently retire an overlong baseline", (t) => {
  const f = fixture(t);
  put(f.root, f.file, "/* eslint-disable max-lines */\n" + lines(401));
  fails(f.check(), /missing baseline diagnostic/);
});

test("real oxlint: preserve non-src scopes and --no-ignore, including ignored files", (t) => {
  const f = fixture(t);
  f.pkg.lint = "oxlint src server scripts --no-ignore";
  put(f.root, "apps/zcode-cli/packages/example/.gitignore", "scripts/\n");
  put(f.root, "apps/zcode-cli/packages/example/server/new.ts", "debugger;\n");
  put(f.root, "apps/zcode-cli/packages/example/scripts/new.ts", "debugger;\n");
  const result = f.check();
  fails(result, /server\/new\.ts.*no-debugger/);
  fails(result, /scripts\/new\.ts.*no-debugger/);
});

test("duplicate/new diagnostics, parser errors, malformed output and process failures fail closed", (t) => {
  const f = fixture(t);
  const original = f.lint();
  const report = JSON.parse(original.stdout);
  const assess = (change) => assessReports(f.root, f.baseline, [{ ...original, ...change }]);
  const doubled = { ...report, diagnostics: [...report.diagnostics, report.diagnostics[0]] };
  fails(assess({ stdout: JSON.stringify(doubled) }), /diagnostic count/);
  fails(assess({ stdout: "not JSON" }), /JSON/);
  fails(assess({ stdout: "{}" }), /report shape/);
  fails(assess({ stdout: JSON.stringify({ ...report, number_of_files: 0 }) }), /reduced scan/);
  fails(assess({ status: 2 }), /process/);
  fails(assess({ status: null, signal: "SIGTERM" }), /process/);
  fails(assess({ stderr: "configuration failure" }), /stderr/);
  fails(assess({ status: 0 }), /exit.*diagnostics/);
  fails(assessReports(f.root, f.baseline, []), /missing package/);
  const unknown = { ...original, directory: "packages/unknown" };
  fails(assessReports(f.root, f.baseline, [original, unknown]), /unknown package/);
  put(f.root, f.file.replace("original.ts", "broken.ts"), "export const = ;\n");
  fails(f.check(), /broken\.ts/);
});

test("upstream verification refuses a plausible count derived from different source", (t) => {
  const f = fixture(t);
  put(f.root, f.file, lines(401).replace("v0 = 0", "v0 = 1"));
  fails(assessReports(f.root, f.baseline, [f.lint()], { verifyUpstream: true }), /upstream blob/);
});

test("new files cannot hide max-lines or other errors with inline pragmas", (t) => {
  const f = fixture(t);
  const file = f.file.replace("original.ts", "hidden.ts");
  for (const source of ["/* eslint-disable max-lines */\n" + lines(402), "/* eslint-disable */\ndebugger;\n"]) {
    put(f.root, file, source);
    assert.throws(() => validateSourcePragmas(f.root, f.baseline), /Unreviewed lint pragma/);
  }
});

test("original suppression is retained only for byte-identical source, never new growth", (t) => {
  const f = fixture(t);
  const file = f.file.replace("original.ts", "legacy.ts");
  const original = "/* eslint-disable max-lines */\n" + lines(402);
  put(f.root, file, original);
  f.baseline.inlinePragmaBlobs[file] = sourceBlob(original);
  assert.doesNotThrow(() => validateSourcePragmas(f.root, f.baseline));
  put(f.root, file, original + "debugger;\n");
  assert.throws(() => validateSourcePragmas(f.root, f.baseline), /Unreviewed lint pragma/);
});

function topologyFixture(t) {
  const f = fixture(t);
  for (const file of Object.keys(policy.inputs)) put(f.root, file, readFileSync(join(repo, file)));
  json(f.root, "package.json", { scripts: { lint: "oxlint" } });
  json(f.root, "apps/zcode-cli/package.json", { scripts: { lint: "turbo run lint" } });
  rmSync(join(f.root, "apps/zcode-cli/packages/example"), { recursive: true });
  for (const pkg of policy.packages) json(f.root, `apps/zcode-cli/${pkg.directory}/package.json`, {
    name: pkg.name, scripts: pkg.lint ? { lint: pkg.lint } : {},
  });
  return f.root;
}

test("topology rejects new packages, dropped scopes/flags, hooks, root override and hidden config", (t) => {
  const root = topologyFixture(t);
  assert.doesNotThrow(() => validateTopology(root, policy));
  const file = "apps/zcode-cli/packages/debug/package.json";
  const original = readFileSync(join(root, file));
  for (const scripts of [{ lint: "oxlint src" }, { lint: "oxlint src server scripts", prelint: "echo skip" }]) {
    json(root, file, { name: "debug", scripts });
    assert.throws(() => validateTopology(root, policy), /script/);
  }
  put(root, file, original);
  for (const directory of ["packages/core", "tools/prompt-trajectory"]) {
    const pkg = policy.packages.find(p => p.directory === directory);
    const manifest = `apps/zcode-cli/${directory}/package.json`;
    json(root, manifest, { name: pkg.name, scripts: { lint: "oxlint src" } });
    assert.throws(() => validateTopology(root, policy), /script/);
    json(root, manifest, { name: pkg.name, scripts: { lint: pkg.lint } });
  }
  json(root, "apps/zcode-cli/package.json", { scripts: { lint: "turbo run lint --filter=@zcode/adapters" } });
  assert.throws(() => validateTopology(root, policy), /script/);
  json(root, "apps/zcode-cli/package.json", { scripts: { lint: "turbo run lint" } });
  json(root, "apps/zcode-cli/packages/unknown/package.json", { name: "unknown" });
  assert.throws(() => validateTopology(root, policy), /package topology/);
  rmSync(join(root, "apps/zcode-cli/packages/unknown"), { recursive: true });
  json(root, "package.json", { scripts: { lint: "oxlint --allow max-lines" } });
  assert.throws(() => validateTopology(root, policy), /script/);
  json(root, "package.json", { scripts: { lint: "oxlint" } });
  json(root, "apps/zcode-cli/packages/debug/src/.oxlintrc.json", { rules: { "max-lines": "off" } });
  assert.throws(() => validateTopology(root, policy), /unreviewed lint input/);
});

test("Turbo plan must cover all 17 packages, exact scopes, and no added task dependencies", () => {
  const tasks = policy.packages.map(p => ({ directory: p.directory, package: p.name, command: p.lint ?? "<NONEXISTENT>", task: "lint", dependencies: [], cliArguments: [] }));
  assert.doesNotThrow(() => validateTaskPlan(policy, { tasks }));
  assert.throws(() => validateTaskPlan(policy, { tasks: tasks.slice(1) }), /Turbo/);
  assert.throws(() => validateTaskPlan(policy, { tasks: [...tasks, tasks[0]] }), /Turbo/);
  const changed = structuredClone(tasks);
  changed[0].dependencies.push("@zcode/core#build");
  assert.throws(() => validateTaskPlan(policy, { tasks: changed }), /Turbo/);
});

test("raw lint failure is only attributable to a completed matching lint task, not a broken command", () => {
  const packages = [{ name: "@zcode/example", errors: 1, warnings: 0 }];
  const raw = {
    status: 1, signal: null,
    stdout: "@zcode/example:lint: Found 0 warnings and 1 errors.\nFailed: @zcode/example#lint\n",
    stderr: " ERROR  @zcode/example#lint: command (fixture) pnpm run lint exited (1)\n ERROR  run failed: command exited (1)\n",
  };
  assert.doesNotThrow(() => validateRawResult(raw, packages));
  assert.throws(() => validateRawResult({ ...raw, stdout: "command not found" }, packages), /raw lint/);
  assert.throws(() => validateRawResult({ ...raw, status: 2 }, packages), /raw lint/);
  assert.throws(() => validateRawResult({ ...raw, status: 0 }, packages), /raw lint/);
  assert.throws(() => validateRawResult({ ...raw, stderr: " ERROR run failed" }, packages), /raw lint/);
  assert.throws(() => validateRawResult({ ...raw, stderr: raw.stderr + " ERROR unrelated tool failure\n" }, packages), /raw lint/);
  assert.throws(() => validateRawResult({ ...raw, stdout: raw.stdout.replace("0 warnings", "1 warnings") }, packages), /raw lint/);
});
