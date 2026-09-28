import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { test } from 'node:test';
import {
  copyChordEsbuildPackages,
  filterChordEsbuildFromRootRuntimeModules,
  findNonTargetEsbuildPlatforms,
  pruneNonTargetEsbuildPlatforms,
  resolveChordEsbuildPlan,
} from './chord-esbuild-package.mjs';

const chordName = '@earendil-works/chord';
const target = 'win32-x64';

async function writePackage(root, name, version, extra = {}) {
  await mkdir(root, { recursive: true });
  await writeFile(join(root, 'package.json'), JSON.stringify({ name, version, ...extra }));
}

function readPackagedManifest(staging, path) {
  try { return JSON.parse(readFileSync(join(staging, path), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

test('Chord keeps exact esbuild API and target binary below its own package without replacing root consumers', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'chord-esbuild-package-'));
  if (!resolve(temp).startsWith(`${resolve(tmpdir())}${sep}`)) throw new Error('Refusing temp cleanup outside system temp');
  try {
    const source = join(temp, 'source', 'node_modules', chordName);
    const staging = join(temp, 'staging');
    const privateRoot = join(staging, 'node_modules', chordName, 'node_modules');
    await writePackage(source, chordName, '0.87.1', { dependencies: { esbuild: '0.28.2' } });
    await writePackage(join(source, 'node_modules', 'esbuild'), 'esbuild', '0.28.2');
    await writeFile(join(source, 'node_modules', 'esbuild', 'main.js'), 'module.exports={};\n');
    await writePackage(join(source, 'node_modules', '@esbuild', target), `@esbuild/${target}`, '0.28.2');
    await writeFile(join(source, 'node_modules', '@esbuild', target, 'esbuild.exe'), 'target');
    await writePackage(join(staging, 'node_modules', chordName), chordName, '0.87.1');
    await writePackage(join(staging, 'node_modules', 'esbuild'), 'esbuild', '0.27.7');
    await writePackage(join(staging, 'node_modules', '@esbuild', target), `@esbuild/${target}`, '0.27.7');
    await writePackage(join(staging, 'node_modules', '@esbuild', 'linux-x64'), '@esbuild/linux-x64', '0.27.7');
    await writePackage(join(privateRoot, '@esbuild', 'darwin-x64'), '@esbuild/darwin-x64', '0.28.2');
    const entries = [
      '/node_modules/@esbuild/linux-x64/package.json',
      '/node_modules/@earendil-works/chord/node_modules/@esbuild/darwin-x64/package.json',
    ];
    const readManifest = path => readPackagedManifest(staging, path);
    const plan = resolveChordEsbuildPlan({ sourceChordPackageRoot: source, targetPlatformKey: target, readPackagedManifest: readManifest, asarEntries: entries });
    assert.equal(plan.version, '0.28.2');
    assert.deepEqual(plan.toCopy.map(entry => entry.moduleName), ['esbuild', `@esbuild/${target}`]);
    assert.deepEqual(plan.nonTargetPlatforms, ['darwin-x64', 'linux-x64']);
    copyChordEsbuildPackages({ stagingDir: staging, entries: plan.toCopy });
    pruneNonTargetEsbuildPlatforms({ stagingDir: staging, targetPlatformKey: target });
    assert.equal(readManifest(join('node_modules', 'esbuild', 'package.json')).version, '0.27.7');
    assert.equal(readManifest(join('node_modules', '@esbuild', target, 'package.json')).version, '0.27.7');
    assert.equal(readManifest(join('node_modules', chordName, 'node_modules', 'esbuild', 'package.json')).version, '0.28.2');
    assert.equal(readManifest(join('node_modules', chordName, 'node_modules', '@esbuild', target, 'package.json')).version, '0.28.2');
    assert.ok(existsSync(join(privateRoot, '@esbuild', target, 'esbuild.exe')));
    assert.equal(existsSync(join(staging, 'node_modules', '@esbuild', 'linux-x64')), false);
    assert.equal(existsSync(join(privateRoot, '@esbuild', 'darwin-x64')), false);
    const complete = resolveChordEsbuildPlan({ sourceChordPackageRoot: source, targetPlatformKey: target, readPackagedManifest: readManifest });
    assert.deepEqual(complete.toCopy, []);
    assert.deepEqual(complete.nonTargetPlatforms, []);
  } finally { await rm(temp, { recursive: true, force: true }); }
});

test('Chord source validation refuses mismatched target binary version', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'chord-esbuild-invalid-'));
  if (!resolve(temp).startsWith(`${resolve(tmpdir())}${sep}`)) throw new Error('Refusing temp cleanup outside system temp');
  try {
    const source = join(temp, 'chord');
    await writePackage(source, chordName, '0.87.1', { dependencies: { esbuild: '0.28.2' } });
    await writePackage(join(source, 'node_modules', 'esbuild'), 'esbuild', '0.28.2');
    await writePackage(join(source, 'node_modules', '@esbuild', target), `@esbuild/${target}`, '0.27.7');
    assert.throws(() => resolveChordEsbuildPlan({ sourceChordPackageRoot: source, targetPlatformKey: target, readPackagedManifest: () => null }), /source mismatch/);
  } finally { await rm(temp, { recursive: true, force: true }); }
});

test('generic root closure excludes Chord private esbuild and every optional platform', () => {
  const entries = [{ moduleName: 'esbuild' }, { moduleName: '@esbuild/win32-x64' }, { moduleName: '@esbuild/linux-x64' }, { moduleName: 'minimatch' }];
  assert.deepEqual(filterChordEsbuildFromRootRuntimeModules(entries), [{ moduleName: 'minimatch' }]);
  assert.deepEqual(findNonTargetEsbuildPlatforms(['/node_modules/@esbuild/win32-x64/esbuild.exe', '/node_modules/@esbuild/linux-x64/bin/esbuild'], target), ['linux-x64']);
});
