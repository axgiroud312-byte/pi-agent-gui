import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { test } from "node:test";
import {
  copyFixedPiNestedPackages,
  createAsarPackageManifestReader,
  resolveFixedPiNestedPackagePlan,
} from "./fixed-pi-nested-packages.mjs";

async function cleanupTempRoot(root) {
  const safeRoot = resolve(root);
  if (!safeRoot.startsWith(`${resolve(tmpdir())}${sep}`)) throw new Error("Refusing temp cleanup outside system temp");
  await rm(safeRoot, { recursive: true, force: true });
}

test("fixed Pi nested packages are planned by name and exact version without replacing root modules", async () => {
  const root = await mkdtemp(join(tmpdir(), "fixed-pi-nested-"));
  try {
    const sourcePi = join(root, "source", "node_modules", "@earendil-works", "pi-coding-agent");
    const sourceNested = join(sourcePi, "node_modules");
    const staging = join(root, "staging");
    const packagedPi = join(staging, "node_modules", "@earendil-works", "pi-coding-agent");
    const packagedNested = join(packagedPi, "node_modules");
    const rootMinimatch = join(staging, "node_modules", "minimatch", "package.json");
    await Promise.all([
      mkdir(join(sourceNested, "minimatch"), { recursive: true }),
      mkdir(join(sourceNested, "brace-expansion"), { recursive: true }),
      mkdir(packagedNested, { recursive: true }),
      mkdir(join(packagedNested, "highlight.js"), { recursive: true }),
      mkdir(join(staging, "node_modules", "minimatch"), { recursive: true }),
    ]);
    await Promise.all([
      writeFile(join(sourcePi, "package.json"), JSON.stringify({ name: "@earendil-works/pi-coding-agent", version: "0.87.0" })),
      writeFile(join(sourceNested, "minimatch", "package.json"), JSON.stringify({ name: "minimatch", version: "10.2.6" })),
      writeFile(join(sourceNested, "minimatch", "index.js"), "module.exports = 10;\n"),
      writeFile(join(sourceNested, "brace-expansion", "package.json"), JSON.stringify({ name: "brace-expansion", version: "5.0.12" })),
      writeFile(join(sourceNested, "brace-expansion", "index.js"), "module.exports = 5;\n"),
      writeFile(join(packagedPi, "package.json"), JSON.stringify({ name: "@earendil-works/pi-coding-agent", version: "0.87.0" })),
      writeFile(rootMinimatch, JSON.stringify({ name: "minimatch", version: "10.2.5" })),
      writeFile(join(packagedNested, "highlight.js", "package.json"), JSON.stringify({ name: "highlight.js", version: "10.7.3" })),
    ]);

    const readPackagedManifest = relativePath => {
      try { return JSON.parse(readFileSync(join(staging, relativePath), "utf8")); }
      catch (error) { if (error.code === "ENOENT") return null; throw error; }
    };
    const initial = await resolveFixedPiNestedPackagePlan({ sourcePiPackageRoot: sourcePi, expectedPiVersion: "0.87.0", readPackagedManifest });
    assert.deepEqual(initial.toCopy.map(entry => entry.moduleName), ["brace-expansion", "minimatch"]);
    await copyFixedPiNestedPackages({ stagingDir: staging, entries: initial.toCopy });
    assert.equal(JSON.parse(await readFile(rootMinimatch, "utf8")).version, "10.2.5");
    assert.equal(JSON.parse(await readFile(join(packagedNested, "minimatch", "package.json"), "utf8")).version, "10.2.6");
    assert.equal(JSON.parse(await readFile(join(packagedNested, "highlight.js", "package.json"), "utf8")).version, "10.7.3");

    const complete = await resolveFixedPiNestedPackagePlan({ sourcePiPackageRoot: sourcePi, expectedPiVersion: "0.87.0", readPackagedManifest });
    assert.deepEqual(complete.toCopy, []);
    await writeFile(join(packagedNested, "minimatch", "package.json"), JSON.stringify({ name: "other-package", version: "10.2.6" }));
    const wrongName = await resolveFixedPiNestedPackagePlan({ sourcePiPackageRoot: sourcePi, expectedPiVersion: "0.87.0", readPackagedManifest });
    assert.deepEqual(wrongName.toCopy.map(entry => entry.moduleName), ["minimatch"]);
    await writeFile(join(packagedNested, "minimatch", "package.json"), JSON.stringify({ name: "minimatch", version: "10.2.5" }));
    const wrongVersion = resolveFixedPiNestedPackagePlan({ sourcePiPackageRoot: sourcePi, expectedPiVersion: "0.87.0", readPackagedManifest });
    assert.deepEqual(wrongVersion.toCopy.map(entry => entry.moduleName), ["minimatch"]);
    await writeFile(join(packagedPi, "package.json"), JSON.stringify({ name: "@earendil-works/pi-coding-agent", version: "0.88.0" }));
    assert.throws(
      () => resolveFixedPiNestedPackagePlan({ sourcePiPackageRoot: sourcePi, expectedPiVersion: "0.87.0", readPackagedManifest }),
      /Pi packaged version/,
    );
    const absentPi = resolveFixedPiNestedPackagePlan({
      sourcePiPackageRoot: sourcePi,
      expectedPiVersion: "0.87.0",
      readPackagedManifest: () => null,
      allowMissingPackagedPi: true,
    });
    assert.deepEqual(absentPi.toCopy.map(entry => entry.moduleName), ["brace-expansion", "minimatch"]);
    assert.throws(
      () => resolveFixedPiNestedPackagePlan({ sourcePiPackageRoot: sourcePi, expectedPiVersion: "0.88.0", readPackagedManifest }),
      /Pi source version/,
    );
  } finally {
    await cleanupTempRoot(root);
  }
});

test("asar manifest reader handles Windows paths and distinguishes missing manifests", () => {
  const manifest = { name: "minimatch", version: "10.2.6" };
  const reader = createAsarPackageManifestReader({
    archivePath: "app.asar",
    asarEntries: ["\\node_modules\\minimatch\\package.json"],
    extractFile: (archive, path) => {
      assert.equal(archive, "app.asar");
      assert.equal(path, join("node_modules", "minimatch", "package.json"));
      return Buffer.from(JSON.stringify(manifest));
    },
  });
  assert.deepEqual(reader(join("node_modules", "minimatch", "package.json")), manifest);
  assert.equal(reader(join("node_modules", "brace-expansion", "package.json")), null);
});
