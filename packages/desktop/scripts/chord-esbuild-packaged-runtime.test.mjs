import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { test } from 'node:test';
import { copyChordEsbuildPackages, copyChordPackageWithoutNestedModules, pruneNonTargetEsbuildPlatforms, resolveChordEsbuildPlan } from './chord-esbuild-package.mjs';

const sourceChord = process.env.PI_CHORD_SOURCE_ROOT;
const electronExe = process.env.PI_ELECTRON_EXE;
const packageRoot = process.env.PI_ASAR_RESOLVE_ROOT;

test('target-only Chord packages transform from inside app.asar with Electron Node runtime', {
  skip: !sourceChord || !electronExe || !packageRoot ? 'requires explicit local source, Electron, and asar paths' : false,
}, async () => {
  const temp = await mkdtemp(join(tmpdir(), 'chord-esbuild-asar-'));
  if (!resolve(temp).startsWith(`${resolve(tmpdir())}${sep}`)) throw new Error('Refusing temp cleanup outside system temp');
  try {
    const stage = join(temp, 'stage');
    const asarPath = join(temp, 'app.asar');
    const targetChord = join(stage, 'node_modules', '@earendil-works', 'chord');
    await mkdir(dirname(targetChord), { recursive: true });
    copyChordPackageWithoutNestedModules({ sourceModulePath: sourceChord, targetModulePath: targetChord });
    const plan = resolveChordEsbuildPlan({
      sourceChordPackageRoot: sourceChord,
      targetPlatformKey: 'win32-x64',
      readPackagedManifest: () => null,
    });
    copyChordEsbuildPackages({ stagingDir: stage, entries: plan.toCopy });
    pruneNonTargetEsbuildPlatforms({ stagingDir: stage, targetPlatformKey: 'win32-x64' });
    await writeFile(join(stage, 'probe.cjs'), `
const path=require('node:path');
const chordBase=path.join(__dirname,'node_modules','@earendil-works','chord','dist','node');
const resolved=require.resolve('esbuild',{paths:[chordBase]});
const esbuild=require(resolved);
const code=esbuild.transformSync('let answer=42',{loader:'js'}).code;
console.log('CHORD_ESBUILD_PROBE='+JSON.stringify({resolved,version:esbuild.version,code}));
`);
    const require = createRequire(join(packageRoot, 'package.json'));
    const asar = require('@electron/asar');
    const cli = join(dirname(require.resolve('@electron/asar/package.json')), 'bin', 'asar.js');
    const packed = spawnSync(process.execPath, [cli, 'pack', stage, asarPath, '--unpack', '*.{node,dll,dylib,exe}'], { encoding: 'utf8', windowsHide: true, timeout: 30000 });
    assert.equal(packed.status, 0, `${packed.stdout}\n${packed.stderr}`);
    const binaryEntry = join('node_modules', '@earendil-works', 'chord', 'node_modules', '@esbuild', 'win32-x64', 'esbuild.exe');
    assert.equal(asar.statFile(asarPath, binaryEntry).unpacked, true);
    assert.ok(existsSync(join(`${asarPath}.unpacked`, binaryEntry)));
    const run = spawnSync(electronExe, [join(asarPath, 'probe.cjs')], {
      // The packaged Pi child receives this same physical sidecar path from packagedPiEsbuildEnv.
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', ESBUILD_BINARY_PATH: join(`${asarPath}.unpacked`, binaryEntry) },
      encoding: 'utf8', windowsHide: true, timeout: 30000,
    });
    assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
    const match = /CHORD_ESBUILD_PROBE=(\{[^\n]+\})/.exec(run.stdout);
    assert.ok(match, `Probe output missing: ${run.stdout}\n${run.stderr}`);
    const observed = JSON.parse(match[1]);
    assert.equal(observed.version, plan.version);
    assert.match(observed.resolved.replaceAll('\\', '/'), /chord\/node_modules\/esbuild\/lib\/main\.js$/);
    assert.match(observed.code, /answer = 42/);
  } finally { await rm(temp, { recursive: true, force: true }); }
});
