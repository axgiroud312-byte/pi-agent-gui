import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { test } from "node:test";
import {
  copyFixedPiNestedPackages,
  resolveRuntimeNestedPackagePlan,
} from "./fixed-pi-nested-packages.mjs";

async function cleanupTempRoot(root) {
  const safeRoot = resolve(root);
  if (!safeRoot.startsWith(`${resolve(tmpdir())}${sep}`)) {
    throw new Error("Refusing temp cleanup outside system temp");
  }
  await rm(safeRoot, { recursive: true, force: true });
}

test("root runtime owners keep incompatible physical nested dependency versions", async () => {
  const root = await mkdtemp(join(tmpdir(), "runtime-nested-package-"));
  try {
    const sourceOwner = join(root, "source", "node_modules", "proper-lockfile");
    const sourceSignalExit = join(sourceOwner, "node_modules", "signal-exit");
    const sourceRetry = join(sourceOwner, "node_modules", "retry");
    const staging = join(root, "staging");
    const packagedOwner = join(staging, "node_modules", "proper-lockfile");
    const packagedRootSignalExit = join(staging, "node_modules", "signal-exit");
    const packagedRootRetry = join(staging, "node_modules", "retry");
    await Promise.all([
      mkdir(sourceSignalExit, { recursive: true }),
      mkdir(sourceRetry, { recursive: true }),
      mkdir(packagedOwner, { recursive: true }),
      mkdir(packagedRootSignalExit, { recursive: true }),
      mkdir(packagedRootRetry, { recursive: true }),
    ]);
    await Promise.all([
      writeFile(join(sourceOwner, "package.json"), JSON.stringify({
        name: "proper-lockfile",
        version: "4.1.2",
        main: "index.js",
      })),
      writeFile(join(sourceSignalExit, "package.json"), JSON.stringify({
        name: "signal-exit",
        version: "3.0.7",
        main: "index.js",
      })),
      writeFile(join(sourceSignalExit, "index.js"), "module.exports = function onExit() {};\n"),
      writeFile(join(sourceRetry, "package.json"), JSON.stringify({
        name: "retry",
        version: "0.12.0",
        main: "index.js",
      })),
      writeFile(join(sourceRetry, "index.js"), "module.exports = { operation() {} };\n"),
      writeFile(join(packagedOwner, "package.json"), JSON.stringify({
        name: "proper-lockfile",
        version: "4.1.2",
        main: "index.js",
      })),
      writeFile(
        join(packagedOwner, "index.js"),
        "const onExit = require('signal-exit'); if (typeof onExit !== 'function') throw new TypeError('onExit is not a function'); module.exports = require('retry');\n",
      ),
      writeFile(join(packagedRootSignalExit, "package.json"), JSON.stringify({
        name: "signal-exit",
        version: "4.1.0",
        main: "index.js",
      })),
      writeFile(join(packagedRootSignalExit, "index.js"), "module.exports = { onExit() {} };\n"),
      writeFile(join(packagedRootRetry, "package.json"), JSON.stringify({
        name: "retry",
        version: "0.13.1",
        main: "index.js",
      })),
      writeFile(join(packagedRootRetry, "index.js"), "module.exports = { operation() { throw new Error('wrong retry'); } };\n"),
    ]);

    const readPackagedManifest = relativePath => {
      try {
        return JSON.parse(readFileSync(join(staging, relativePath), "utf8"));
      } catch (error) {
        if (error.code === "ENOENT") return null;
        throw error;
      }
    };
    const runtimeModules = [{ moduleName: "proper-lockfile", sourceModulePath: sourceOwner }];
    const initial = resolveRuntimeNestedPackagePlan({ runtimeModules, readPackagedManifest });
    assert.deepEqual(
      initial.toCopy.map(entry => `${entry.ownerPackageName}:${entry.moduleName}@${entry.version}`),
      ["proper-lockfile:retry@0.12.0", "proper-lockfile:signal-exit@3.0.7"],
    );

    const loadPackagedOwner = () => execFileSync(
      process.execPath,
      ["-e", "require(process.argv[1])", packagedOwner],
      { encoding: "utf8", windowsHide: true, stdio: "pipe" },
    );
    assert.throws(loadPackagedOwner, /onExit is not a function/);
    copyFixedPiNestedPackages({ stagingDir: staging, entries: initial.toCopy });
    assert.equal(loadPackagedOwner(), "");
    assert.deepEqual(resolveRuntimeNestedPackagePlan({ runtimeModules, readPackagedManifest }).toCopy, []);
  } finally {
    await cleanupTempRoot(root);
  }
});
