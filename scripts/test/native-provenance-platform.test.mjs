import assert from "node:assert/strict";
import test from "node:test";
import { assertProductionGraphs, missingProductionPackages } from "../third-party-npm.mjs";
import { assertProductionNoticeCoverage, platformOptionalPackages } from "../third-party-platform.mjs";

const aix = "@esbuild/aix-ppc64@0.28.2";
const win = "@esbuild/win32-x64@0.28.2";
const linux = "@esbuild/linux-x64@0.28.2";
const lock = {
  packages: {
    [aix]: { os: ["aix"], cpu: ["ppc64"] },
    [win]: { os: ["win32"], cpu: ["x64"] },
    [linux]: { os: ["linux"], cpu: ["x64"] },
  },
  snapshots: { [aix]: { optional: true }, [win]: { optional: true }, [linux]: { optional: true } },
};
const current = { os: "win32", cpu: "x64" };
const supported = { os: ["current", "darwin", "linux", "win32"], cpu: ["current", "x64", "arm64"], libc: ["current", "glibc"] };
const item = key => ({ name: key.slice(0, key.lastIndexOf("@")), version: key.slice(key.lastIndexOf("@") + 1) });
const required = new Map([aix, win, linux].map(key => [key, item(key)]));
const installed = new Map([win, linux].map(key => [key, {}]));
// Real pnpm 10 ls output flattens these transitive optional edges into dependencies.
const graph = keys => [{ name: "workspace", dependencies: Object.fromEntries(keys.map(key => [item(key).name, item(key)])) }];

test("uninstalled AIX optional is recorded, not required by a Windows cross-platform install", () => {
  const allowed = platformOptionalPackages(lock, supported, current);
  assert.deepEqual([...allowed.keys()], [aix]);
  const result = assertProductionGraphs(graph([...required.keys()]), graph([...installed.keys()]), allowed);
  assert.equal(result.has(aix), true, "Keep the full locked production union");
  const missing = missingProductionPackages(result, installed, allowed);
  assert.equal(missing[0].name, "@esbuild/aix-ppc64");
  assert.deepEqual(missing[0].constraints, { os: ["aix"], cpu: ["ppc64"] });
});

test("missing current-platform and configured foreign-platform packages both fail", () => {
  const allowed = platformOptionalPackages(lock, supported, current);
  for (const key of [win, linux]) {
    const broken = new Map(installed); broken.delete(key);
    assert.throws(() => missingProductionPackages(required, broken, allowed), /Missing installed dependency/);
    assert.throws(() => assertProductionGraphs(graph([...required.keys()]), graph([...broken.keys()]), allowed), /Missing:/);
  }
});

test("platform constraints alone, package-name exceptions, and wrong versions cannot excuse required dependencies", () => {
  const mandatory = structuredClone(lock);
  mandatory.snapshots[aix] = {};
  assert.equal(platformOptionalPackages(mandatory, supported, current).has(aix), false);
  mandatory.snapshots[aix] = { optional: true };
  mandatory.snapshots[`${aix}(peer@1.0.0)`] = {};
  assert.equal(platformOptionalPackages(mandatory, supported, current).has(aix), false);
  for (const key of ["@napi-rs/canvas-android-arm64@1.0.0", "dep@1.0.0"]) {
    assert.throws(() => missingProductionPackages(new Map([[key, item(key)]]), new Map()), /Missing installed dependency/);
  }
  const allowed = platformOptionalPackages(lock, supported, current);
  assert.throws(() => assertProductionGraphs(graph([win]), graph(["@esbuild/win32-x64@0.27.7"]), allowed), /Stale:/);
});

test("host defaults, CPU, libc, negation and any follow platform metadata, not package names", () => {
  const constraints = { osOnly: { os: ["!win32"] }, cpuOnly: { cpu: ["arm64"] }, musl: { libc: ["musl"] }, universal: { os: ["any"] }, plain: {} };
  const fixture = { packages: constraints, snapshots: Object.fromEntries(Object.keys(constraints).map(key => [key, { optional: true }])) };
  assert.deepEqual([...platformOptionalPackages(fixture, {}, current).keys()], ["osOnly", "cpuOnly"]);
  assert.deepEqual([...platformOptionalPackages(fixture, {}, { os: "linux", cpu: "arm64", libc: "glibc" }).keys()], ["musl"]);
  assert.deepEqual([...platformOptionalPackages(fixture, { os: ["any"], cpu: ["any"], libc: ["any"] }, current).keys()], []);
  assert.equal(platformOptionalPackages(lock, {}, { os: "aix", cpu: "ppc64" }).has(aix), false);
});

test("every actually installed production version needs notices, including foreign optionals", () => {
  const inventory = { packages: [win, linux].map(key => ({ ...item(key), notices: [{ member: "LICENSE", sha256: "fixture" }] })) };
  assert.doesNotThrow(() => assertProductionNoticeCoverage(required, installed, inventory));
  assert.throws(() => assertProductionNoticeCoverage(required, new Map([...installed, [aix, {}]]), inventory), /Missing production notice coverage: @esbuild\/aix-ppc64@0.28.2/);
  assert.throws(() => assertProductionNoticeCoverage(required, installed, { packages: [] }), /Missing production notice coverage/);
  inventory.packages[0].notices = [];
  assert.throws(() => assertProductionNoticeCoverage(required, installed, inventory), /Missing production notice coverage/);
});
