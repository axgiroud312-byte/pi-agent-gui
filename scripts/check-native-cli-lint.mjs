import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { delimiter, dirname, join, posix, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs, stripVTControlCharacters } from "node:util";

const CLI = "apps/zcode-cli";
const RULE = "eslint(max-lines)";
const UPSTREAM = "872ad960de7ec172591f7e1952f7849229f94521";
// Explicit presentation avoids GitHub Actions' grouped/unprefixed Turbo and annotation formats.
export const RAW_LINT_ARGUMENTS = Object.freeze([
  "--concurrency=1", "--force", "--log-order=stream", "--log-prefix=task", "--", "--format=default",
]);
const read = (root, file) => readFileSync(join(root, file), "utf8");
const json = (root, file) => JSON.parse(read(root, file));
const lf = (text) => text.replaceAll("\r\n", "\n");
const sha256 = (text) => createHash("sha256").update(text).digest("hex");
const slash = (path) => path.replaceAll("\\", "/");
const ensure = (ok, message) => { if (!ok) throw new Error(message); };
const same = (a, b, message) => assert.deepEqual(a, b, message);
const canonical = (file) => typeof file === "string" && !file.includes("\\") &&
  !file.includes(":") && !file.startsWith("/") && posix.normalize(file) === file &&
  !file.split("/").includes("..");

export function sourceBlob(text) {
  const bytes = Buffer.from(lf(text));
  return createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
}

function validateBaseline(baseline) {
  ensure(baseline.schemaVersion === 1 && baseline.upstream.commit === UPSTREAM &&
    baseline.rule === RULE, "Unsupported native CLI baseline provenance/schema");
  same(baseline.options, { max: 400, skipBlankLines: true, skipComments: true }, "Native 400-line rule changed");
  const seen = new Set();
  for (const entry of baseline.files) {
    const allowance = baseline.allowances[entry.file];
    ensure(canonical(entry.file) && entry.file.startsWith(`${CLI}/`) && !seen.has(entry.file) &&
      entry.rule === RULE && entry.count === 1 && /^[a-f0-9]{40}$/.test(entry.upstreamBlob) &&
      Number.isSafeInteger(entry.upstreamLines) && entry.upstreamLines > 400 &&
      entry.maxLines === entry.upstreamLines + (allowance?.lines ?? 0), `Invalid baseline: ${entry.file}`);
    if (allowance) ensure(Number.isSafeInteger(allowance.lines) && allowance.lines > 0 &&
      /^[a-f0-9]{40}$/.test(allowance.blob) && allowance.reason?.trim(), `Invalid wiring allowance: ${entry.file}`);
    seen.add(entry.file);
  }
  ensure(Object.keys(baseline.allowances).every(file => seen.has(file)), "Allowance without upstream error");
}

// Freeze discovery/ignore inputs as well as scripts: a narrowed scan is not an improvement.
export function validateTopology(root, baseline, { verifyUpstream = false } = {}) {
  function script(file, expected, name) {
    const value = json(root, file);
    ensure((value.scripts?.lint ?? null) === expected && !value.scripts?.prelint &&
      !value.scripts?.postlint && (!name || value.name === name), `Unreviewed lint script: ${file}`);
  }
  script("package.json", "oxlint");
  script(`${CLI}/package.json`, "turbo run lint");
  const discovered = [];
  for (const group of ["packages", "tools"]) {
    for (const entry of readdirSync(join(root, CLI, group), { withFileTypes: true })) {
      if (existsSync(join(root, CLI, group, entry.name, "package.json"))) discovered.push(`${group}/${entry.name}`);
    }
  }
  same(discovered.sort(), baseline.packages.map(p => p.directory).sort(), "Unreviewed package topology");
  for (const pkg of baseline.packages) script(`${CLI}/${pkg.directory}/package.json`, pkg.lint, pkg.name);
  for (const [file, hashes] of Object.entries(baseline.inputs)) {
    ensure((verifyUpstream ? hashes.slice(0, 1) : hashes).includes(sha256(lf(read(root, file)))),
      `Unreviewed lint input: ${file}`);
  }
  const inputName = /^(?:\.oxlintrc.*|oxlint\.config\..*|\.gitignore|\.ignore)$/;
  function discover(directory, recursive) {
    for (const entry of readdirSync(join(root, directory), { withFileTypes: true })) {
      if (["node_modules", ".git", ".turbo", ".scratch"].includes(entry.name)) continue;
      const file = posix.join(directory, entry.name);
      if (inputName.test(entry.name)) ensure(Object.hasOwn(baseline.inputs, file), `unreviewed lint input: ${file}`);
      if (recursive && entry.isDirectory()) discover(file, true);
      if (recursive && entry.isSymbolicLink()) throw new Error(`Unreviewed CLI source link: ${file}`);
    }
  }
  discover("", false);
  discover("apps", false);
  discover(CLI, true);
}

export function validateTaskPlan(baseline, plan) {
  ensure(Array.isArray(plan.tasks), "Missing Turbo task plan");
  const tasks = plan.tasks.map(task => {
    ensure(task.task === "lint" && task.dependencies?.length === 0 && task.cliArguments?.length === 0 &&
      !task.with?.length, "Unreviewed Turbo task dependencies/arguments");
    return { directory: slash(task.directory), name: task.package, lint: task.command };
  });
  const expected = baseline.packages.map(p => ({ directory: p.directory, name: p.name, lint: p.lint ?? "<NONEXISTENT>" }));
  const sort = (items) => items.sort((a, b) => a.directory.localeCompare(b.directory));
  same(sort(tasks), sort(expected), "Unreviewed Turbo lint topology");
}

export function validateSourcePragmas(root, baseline) {
  const seen = new Set();
  function scan(directory) {
    // Some original script arguments (prompt-trajectory/scripts) do not exist upstream.
    if (!existsSync(join(root, directory))) return;
    for (const entry of readdirSync(join(root, directory), { withFileTypes: true })) {
      if (["node_modules", ".git", ".turbo"].includes(entry.name)) continue;
      const file = `${directory}/${entry.name}`;
      if (entry.isDirectory()) scan(file);
      else if (/\.(?:[cm]?[jt]sx?|vue|svelte|astro)$/.test(file)) {
        const text = read(root, file);
        // Conservative source guard, not a substitute line counter. Existing pragma-bearing
        // files are frozen, so their inherited suppressions cannot shelter any new code.
        if (/\/[/*]\s*(?:eslint|oxlint)(?:-disable\b|\s)/.test(text)) {
          ensure(baseline.inlinePragmaBlobs?.[file] === sourceBlob(text), `Unreviewed lint pragma/source: ${file}`);
          seen.add(file);
        }
      }
    }
  }
  for (const pkg of baseline.packages.filter(p => p.lint)) {
    for (const scope of pkg.lint.split(" ").slice(1).filter(arg => !arg.startsWith("--"))) {
      scan(`${CLI}/${pkg.directory}/${scope}`);
    }
  }
  same([...seen].sort(), Object.keys(baseline.inlinePragmaBlobs ?? {}).sort(), "Inherited lint pragma retirement needs review");
}

export function assessReports(root, baseline, reports, { verifyUpstream = false } = {}) {
  const failures = [], accepted = [], warnings = [], packages = [], seenPackages = new Set(), seenFiles = new Map();
  const entries = new Map(baseline.files.map(entry => [entry.file, entry]));
  for (const report of reports) {
    const pkg = baseline.packages.find(p => p.directory === report.directory && p.lint);
    if (!pkg || seenPackages.has(report.directory)) { failures.push(`unknown package or duplicate report: ${report.directory}`); continue; }
    seenPackages.add(report.directory);
    try {
      ensure(report.name === pkg.name && report.lint === pkg.lint, `Package script mismatch: ${pkg.directory}`);
      ensure(!report.error && !report.signal && [0, 1].includes(report.status), `Lint process failure: ${pkg.name}`);
      ensure(!report.stderr?.trim(), `Unexpected lint stderr: ${pkg.name}: ${report.stderr}`);
      const data = JSON.parse(report.stdout);
      ensure(Array.isArray(data.diagnostics) && Number.isSafeInteger(data.number_of_files) &&
        data.number_of_files >= pkg.minimumFiles && Number.isSafeInteger(data.number_of_rules) &&
        data.number_of_rules > 0, `Invalid report shape or reduced scan: ${pkg.name}`);
      if (verifyUpstream) ensure(data.number_of_files === pkg.minimumFiles, `Upstream scan changed: ${pkg.name}`);
      let errors = 0, warningCount = 0;
      for (const diagnostic of data.diagnostics) {
        ensure(["warning", "error"].includes(diagnostic.severity) && typeof diagnostic.message === "string" &&
          canonical(slash(diagnostic.filename)), `Invalid diagnostic shape: ${pkg.name}`);
        const file = `${CLI}/${pkg.directory}/${slash(diagnostic.filename)}`;
        if (diagnostic.severity === "warning") { warnings.push({ file, ...diagnostic }); warningCount++; continue; }
        errors++;
        const entry = entries.get(file);
        if (diagnostic.code !== RULE) { failures.push(`${file}: ${diagnostic.code ?? "parse error"}: ${diagnostic.message}`); continue; }
        if (!entry) { failures.push(`unknown max-lines file: ${file}`); continue; }
        seenFiles.set(file, (seenFiles.get(file) ?? 0) + 1);
        const match = /^File has too many lines \((\d+)\)\.$/.exec(diagnostic.message);
        ensure(match && diagnostic.help === "Maximum allowed is 400.", `Unrecognized max-lines diagnostic: ${file}`);
        const lines = Number(match[1]), limit = verifyUpstream ? entry.upstreamLines : entry.maxLines;
        if (lines > limit || lines <= 400) { failures.push(`Unapproved growth: ${file}: ${lines} > ${limit}`); continue; }
        const blob = sourceBlob(read(root, file));
        if (verifyUpstream && (lines !== entry.upstreamLines || blob !== entry.upstreamBlob)) {
          failures.push(`Fixed upstream blob/count mismatch: ${file}`); continue;
        }
        if (!verifyUpstream && lines > entry.upstreamLines && blob !== baseline.allowances[file]?.blob) {
          failures.push(`unapproved wiring source: ${file}`); continue;
        }
        accepted.push({ file, rule: RULE, lines, limit, upstreamLines: entry.upstreamLines, blob });
      }
      ensure(report.status === (errors ? 1 : 0), `Lint exit contradicts diagnostics: ${pkg.name}`);
      packages.push({ name: pkg.name, directory: pkg.directory, command: pkg.lint, files: data.number_of_files, errors, warnings: warningCount });
    } catch (error) { failures.push(`${pkg.name}: ${error.message}`); }
  }
  for (const pkg of baseline.packages.filter(p => p.lint)) {
    if (!seenPackages.has(pkg.directory)) failures.push(`missing package report: ${pkg.directory}`);
  }
  // Missing errors need an explicit retirement review, rather than hiding them with ignores/pragmas.
  for (const entry of baseline.files) {
    const count = seenFiles.get(entry.file) ?? 0;
    if (count !== entry.count) failures.push(`${count ? "extra diagnostic count" : "missing baseline diagnostic"}: ${entry.file}: ${count} != ${entry.count}`);
  }
  return { failures, accepted, warnings, packages };
}

export function validateRawResult(raw, packages) {
  const errorCount = packages.reduce((sum, p) => sum + p.errors, 0);
  ensure(!raw.error && !raw.signal && raw.status === (errorCount ? 1 : 0), "Unexplained raw lint process/exit result");
  if (!errorCount) return;
  const stdout = stripVTControlCharacters(raw.stdout), stderr = stripVTControlCharacters(raw.stderr);
  const failed = [...stderr.matchAll(/ERROR\s+(\S+)#lint: command .+ exited \(1\)/g)].map(m => m[1]);
  ensure(failed.length > 0, "Unattributed raw lint failure (missing Turbo failed task)");
  const completed = [...stdout.matchAll(/^(\S+):lint: Found (\d+) warnings? and (\d+) errors?\./gm)];
  for (const done of completed) {
    const pkg = packages.find(p => p.name === done[1]);
    ensure(pkg && Number(done[3]) === pkg.errors && Number(done[2]) === pkg.warnings,
      `Stale or unexplained raw lint result: ${done[1]}`);
  }
  for (const line of stderr.split(/\r?\n/).filter(line => /^\s*ERROR\b/.test(line))) {
    ensure(/ERROR\s+\S+#lint: command .+ exited \(1\)\s*$/.test(line) ||
      /ERROR\s+run failed: command\s+exited \(1\)\s*$/.test(line), `Unexplained raw lint stderr: ${line}`);
  }
  for (const name of failed) {
    const pkg = packages.find(p => p.name === name), done = completed.find(m => m[1] === name);
    ensure(pkg?.errors > 0 && done && Number(done[3]) === pkg.errors && Number(done[2]) === pkg.warnings,
      `Unexplained raw lint failure: ${name}`);
  }
  for (const match of stdout.matchAll(/^\S+:lint:\s+[x×] ([^:]+):/gm)) {
    ensure(match[1] === RULE, `Non-baseline raw lint error: ${match[1]}`);
  }
}

function findOxlint(root, directory, version) {
  let current = join(root, CLI, directory);
  while (true) {
    const manifest = join(current, "node_modules/oxlint/package.json");
    if (existsSync(manifest)) {
      const pkg = JSON.parse(readFileSync(manifest, "utf8"));
      ensure(pkg.version === version, `Unreviewed oxlint version ${pkg.version}, expected ${version}`);
      return join(dirname(manifest), pkg.bin.oxlint);
    }
    ensure(current !== root, "CLI oxlint missing; install frozen dependencies before running the gate");
    current = dirname(current);
  }
}

export function checkNativeCliLint(root, { output, verifyUpstream = false } = {}) {
  root = resolve(root);
  const baselineText = readFileSync(new URL("./native-cli-lint-baseline.json", import.meta.url), "utf8");
  const baseline = JSON.parse(baselineText);
  const artifact = resolve(output ?? join(root, ".scratch/native-cli-lint", new Date().toISOString().replaceAll(/[:.]/g, "-")));
  ensure(!existsSync(artifact), `Use a fresh artifact directory: ${artifact}`);
  mkdirSync(artifact, { recursive: true });
  const env = { ...process.env };
  const pathKey = Object.keys(env).find(key => key.toLowerCase() === "path") ?? "PATH";
  env[pathKey] = `${join(root, "node_modules/.bin")}${delimiter}${env[pathKey] ?? ""}`;
  const commands = [];
  function run(label, command, args, cwd = root) {
    const result = spawnSync(command, args, { cwd, env, timeout: 120000, maxBuffer: 32 * 1024 * 1024 });
    const stdout = result.stdout ?? Buffer.alloc(0), stderr = result.stderr ?? Buffer.alloc(0);
    writeFileSync(join(artifact, `${label}.stdout.log`), stdout);
    writeFileSync(join(artifact, `${label}.stderr.log`), stderr);
    const status = { label, command, args, cwd, status: result.status, signal: result.signal,
      error: result.error?.message, stdoutSha256: sha256(stdout), stderrSha256: sha256(stderr) };
    writeFileSync(join(artifact, `${label}.status.json`), JSON.stringify(status, null, 2) + "\n");
    commands.push(status);
    return { ...status, stdout: stdout.toString("utf8"), stderr: stderr.toString("utf8") };
  }
  // Only constant, shell-safe arguments reach cmd.exe; source/output paths are never shell text.
  const pnpm = (label, args) => process.platform === "win32"
    ? run(label, "cmd.exe", ["/d", "/s", "/c", `pnpm ${args.join(" ")}`]) : run(label, "pnpm", args);
  let result = { failures: [], accepted: [], warnings: [], packages: [] }, raw, sourceCommit;
  try {
    validateBaseline(baseline);
    validateTopology(root, baseline, { verifyUpstream });
    // Turbo fail-fast can terminate another lint task before its final diagnostic summary.
    // Serialize uncached tasks so every reported failure has its own complete current output.
    // The independent JSON scan below still covers every original package/script scope.
    raw = pnpm("raw-cli-lint", ["--dir", CLI, "lint", ...RAW_LINT_ARGUMENTS]);
    const dry = pnpm("turbo-plan", ["--dir", CLI, "exec", "turbo", "run", "lint", "--dry=json"]);
    ensure(dry.status === 0 && !dry.error && !dry.signal, "Turbo lint discovery failed");
    const plan = JSON.parse(dry.stdout);
    validateTaskPlan(baseline, plan);
    sourceCommit = plan.scm?.sha;
    if (verifyUpstream) ensure(sourceCommit === UPSTREAM, "Expected fixed upstream checkout HEAD");
    const reports = [];
    for (const pkg of baseline.packages.filter(p => p.lint)) {
      const binary = findOxlint(root, pkg.directory, baseline.oxlintVersion);
      ensure(/^oxlint (?:[a-z-]+ ?)+$/.test(pkg.lint), `Unsupported lint script: ${pkg.lint}`);
      reports.push({ ...pkg, ...run(pkg.directory.replaceAll("/", "-"), process.execPath,
        [binary, ...pkg.lint.split(" ").slice(1), "--format", "json"], join(root, CLI, pkg.directory)) });
    }
    result = assessReports(root, baseline, reports, { verifyUpstream });
    validateRawResult(raw, result.packages);
    validateTopology(root, baseline, { verifyUpstream });
    validateSourcePragmas(root, baseline);
  } catch (error) { result.failures.push(error.message); }
  const summary = { ...result, passed: result.failures.length === 0, rawLintExitCode: raw?.status ?? null,
    verifyUpstream, sourceCommit, baselineSha256: sha256(lf(baselineText)),
    gateSha256: sha256(lf(readFileSync(fileURLToPath(import.meta.url), "utf8"))),
    upstream: baseline.upstream, wiringCommit: baseline.wiringCommit,
    profileWiringCommit: baseline.profileWiringCommit,
    oxlintVersion: baseline.oxlintVersion, nodeVersion: process.version, root, artifact, commands };
  writeFileSync(join(artifact, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
  return summary;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const { values } = parseArgs({ options: { root: { type: "string" }, output: { type: "string" },
      "verify-upstream": { type: "boolean", default: false } } });
    const result = checkNativeCliLint(values.root ?? fileURLToPath(new URL("../", import.meta.url)), {
      output: values.output, verifyUpstream: values["verify-upstream"],
    });
    console.log(`Native CLI import baseline ${result.passed ? "PASS" : "FAIL"}; raw lint exit ${result.rawLintExitCode}; ${result.accepted.length} bounded max-lines; ${result.warnings.length} warnings.`);
    console.log(`Full raw output, per-package JSON and policy decisions: ${result.artifact}`);
    for (const failure of result.failures) console.error(failure);
    process.exitCode = result.passed ? 0 : 1;
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
