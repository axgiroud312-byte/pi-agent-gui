import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { test } from "node:test";
import {
  copyFixedPiNestedPackages,
  FIXED_PI_NESTED_PACKAGE_OWNERS,
  resolveFixedPiFamilyNestedPackagePlan,
  resolvePiAiProxyAgentBasePlan,
  resolveRootMinimatchNestedPackagePlan,
  resolveRootRuntimePackageRepairs,
} from "./fixed-pi-nested-packages.mjs";

const PI = "@earendil-works/pi-coding-agent";
const CORE = "@earendil-works/pi-agent-core";
const AI = "@earendil-works/pi-ai";
const TUI = "@earendil-works/pi-tui";

async function cleanupTempRoot(root) {
  const safeRoot = resolve(root);
  if (!safeRoot.startsWith(`${resolve(tmpdir())}${sep}`)) throw new Error("Refusing temp cleanup outside system temp");
  await rm(safeRoot, { recursive: true, force: true });
}

test("fixed Pi direct dependency family keeps five nested versions at their owners", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-family-runtime-"));
  try {
    const sourceRoots = new Map();
    const staging = join(root, "staging");
    const nested = new Map([
      [CORE, [["diff", "8.0.4"]]],
      [AI, [["http-proxy-agent", "9.1.0"], ["https-proxy-agent", "9.1.0"]]],
      [TUI, [["get-east-asian-width", "1.6.0"], ["marked", "18.0.11"]]],
    ]);
    for (const owner of [PI, CORE, AI, TUI]) {
      const source = join(root, "source", "node_modules", owner);
      const packed = join(staging, "node_modules", owner);
      sourceRoots.set(owner, source);
      await Promise.all([mkdir(source, { recursive: true }), mkdir(packed, { recursive: true })]);
      const manifest = { name: owner, version: owner === PI ? "0.87.0" : "0.87.1" };
      if (owner === PI) manifest.dependencies = Object.fromEntries([CORE, AI, TUI].map(name => [name, "^0.87.0"]));
      await Promise.all([
        writeFile(join(source, "package.json"), JSON.stringify(manifest)),
        writeFile(join(packed, "package.json"), JSON.stringify(manifest)),
      ]);
      for (const [name, version] of nested.get(owner) ?? []) {
        const packageRoot = join(source, "node_modules", name);
        await mkdir(packageRoot, { recursive: true });
        const nestedManifest = { name, version };
        if (owner === AI) nestedManifest.dependencies = { "agent-base": "9.0.0" };
        await Promise.all([
          writeFile(join(packageRoot, "package.json"), JSON.stringify(nestedManifest)),
          writeFile(join(packageRoot, "index.js"), `module.exports = ${JSON.stringify(version)};\n`),
        ]);
      }
    }
    const rootMarked = join(staging, "node_modules", "marked", "package.json");
    await mkdir(join(staging, "node_modules", "marked"), { recursive: true });
    await writeFile(rootMarked, JSON.stringify({ name: "marked", version: "16.4.2" }));
    const rootAgentBase = join(staging, "node_modules", "agent-base", "package.json");
    const sourceAgentBase = join(root, "source", "node_modules", "agent-base");
    await Promise.all([
      mkdir(join(staging, "node_modules", "agent-base"), { recursive: true }),
      mkdir(sourceAgentBase, { recursive: true }),
    ]);
    await Promise.all([
      writeFile(rootAgentBase, JSON.stringify({ name: "agent-base", version: "7.1.4" })),
      writeFile(join(sourceAgentBase, "package.json"), JSON.stringify({ name: "agent-base", version: "9.0.0" })),
    ]);
    const readPackagedManifest = path => {
      try { return JSON.parse(readFileSync(join(staging, path), "utf8")); }
      catch (error) { if (error.code === "ENOENT") return null; throw error; }
    };

    assert.deepEqual(FIXED_PI_NESTED_PACKAGE_OWNERS, [PI, CORE, AI, TUI]);
    const missing = resolveFixedPiFamilyNestedPackagePlan({ sourcePackageRoots: sourceRoots, expectedPiVersion: "0.87.0", readPackagedManifest });
    assert.deepEqual(missing.toCopy.map(entry => `${entry.ownerPackageName}:${entry.moduleName}`), [
      `${CORE}:diff`, `${AI}:http-proxy-agent`, `${AI}:https-proxy-agent`,
      `${TUI}:get-east-asian-width`, `${TUI}:marked`,
    ]);
    copyFixedPiNestedPackages({ stagingDir: staging, entries: missing.toCopy });
    const proxyAgentBase = resolvePiAiProxyAgentBasePlan({ sourcePackageRoots: sourceRoots, workspaceRoot: join(root, "source"), readPackagedManifest });
    assert.deepEqual(proxyAgentBase.toCopy.map(entry => `${entry.ownerPackageName}:${entry.moduleName}@${entry.version}`), [`${AI}:agent-base@9.0.0`]);
    copyFixedPiNestedPackages({ stagingDir: staging, entries: proxyAgentBase.toCopy });
    assert.equal(JSON.parse(readFileSync(rootMarked)).version, "16.4.2");
    assert.equal(JSON.parse(readFileSync(rootAgentBase)).version, "7.1.4");
    assert.equal(JSON.parse(readFileSync(join(staging, "node_modules", AI, "node_modules", "agent-base", "package.json"))).version, "9.0.0");
    assert.equal(JSON.parse(readFileSync(join(staging, "node_modules", TUI, "node_modules", "marked", "package.json"))).version, "18.0.11");
    const complete = resolveFixedPiFamilyNestedPackagePlan({ sourcePackageRoots: sourceRoots, expectedPiVersion: "0.87.0", readPackagedManifest });
    assert.deepEqual(complete.toCopy, []);
  } finally {
    await cleanupTempRoot(root);
  }
});

test("invalid root module markers are repaired from the right version without flattening Pi nested packages", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-root-runtime-"));
  try {
    const workspace = join(root, "workspace");
    const nested = join(root, "pi-nested");
    for (const [name, version] of [["long", "5.3.2"], ["diff", "9.0.0"], ["lru-cache", "10.4.3"], ["brace-expansion", "2.1.0"], ["hosted-git-info", "8.1.0"]]) {
      const packageRoot = join(workspace, "node_modules", name);
      await mkdir(packageRoot, { recursive: true });
      await writeFile(join(packageRoot, "package.json"), JSON.stringify({ name, version }));
    }
    for (const [name, version] of [["diff", "8.0.4"], ["lru-cache", "11.5.1"], ["brace-expansion", "5.0.12"], ["hosted-git-info", "9.0.3"]]) {
      const packageRoot = join(nested, name);
      await mkdir(packageRoot, { recursive: true });
      await writeFile(join(packageRoot, "package.json"), JSON.stringify({ name, version }));
    }
    const sourceMinimatch = join(workspace, "node_modules", "minimatch");
    const sourceMinimatchBrace = join(sourceMinimatch, "node_modules", "brace-expansion");
    await mkdir(sourceMinimatchBrace, { recursive: true });
    await Promise.all([
      writeFile(join(sourceMinimatch, "package.json"), JSON.stringify({ name: "minimatch", version: "10.2.5", dependencies: { "brace-expansion": "^5.0.5" } })),
      writeFile(join(sourceMinimatchBrace, "package.json"), JSON.stringify({ name: "brace-expansion", version: "5.0.5" })),
    ]);
    const runtimeModules = [
      { moduleName: "diff", sourceModulePath: join(nested, "diff") },
      { moduleName: "lru-cache", sourceModulePath: join(nested, "lru-cache") },
      { moduleName: "long", sourceModulePath: join(workspace, "node_modules", "long") },
      { moduleName: "brace-expansion", sourceModulePath: join(nested, "brace-expansion") },
      { moduleName: "hosted-git-info", sourceModulePath: join(nested, "hosted-git-info") },
      { moduleName: "minimatch", sourceModulePath: join(nested, "minimatch") },
    ];
    const readPackagedManifest = path => {
      if (path.endsWith(join("minimatch", "package.json"))) return { name: "minimatch", version: "10.2.5" };
      if (path.endsWith(join("hosted-git-info", "package.json"))) return { name: "hosted-git-info", version: "9.0.3" };
      if (path.endsWith(join("brace-expansion", "package.json"))) return null;
      return { type: "commonjs" };
    };
    const repairs = resolveRootRuntimePackageRepairs({ runtimeModules, workspaceRoot: workspace, readPackagedManifest });
    assert.deepEqual(repairs.map(entry => [entry.moduleName, JSON.parse(readFileSync(join(entry.sourceModulePath, "package.json"))).version]), [
      ["diff", "9.0.0"], ["lru-cache", "10.4.3"], ["long", "5.3.2"], ["brace-expansion", "2.1.0"], ["hosted-git-info", "8.1.0"],
    ]);
    const minimatchNested = resolveRootMinimatchNestedPackagePlan({ workspaceRoot: workspace, readPackagedManifest });
    assert.deepEqual(minimatchNested.toCopy.map(entry => [entry.ownerPackageName, entry.moduleName, entry.version]), [
      ["minimatch", "brace-expansion", "5.0.5"],
    ]);
  } finally {
    await cleanupTempRoot(root);
  }
});
