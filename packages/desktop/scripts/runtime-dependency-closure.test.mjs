import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { test } from 'node:test';
import { collectRuntimeModuleClosureEntries } from './runtime-dependency-closure.mjs';

test('runtime closure skips nested module-type package.json and follows the real package dependencies', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-runtime-closure-'));
  if (!resolve(root).startsWith(`${resolve(tmpdir())}${sep}`)) throw new Error('Refusing temp cleanup outside system temp');
  try {
    const parent = join(root, 'node_modules', 'pi-agent');
    const minimatch = join(parent, 'node_modules', 'minimatch');
    const marker = join(minimatch, 'dist', 'commonjs');
    const brace = join(minimatch, 'node_modules', 'brace-expansion');
    await Promise.all([parent, marker, brace].map(path => mkdir(path, { recursive: true })));
    await Promise.all([
      writeFile(join(parent, 'package.json'), JSON.stringify({ name: 'pi-agent', version: '1.0.0', dependencies: { minimatch: '10.2.5' } })),
      writeFile(join(minimatch, 'package.json'), JSON.stringify({ name: 'minimatch', version: '10.2.5', main: './dist/commonjs/index.js', dependencies: { 'brace-expansion': '^5.0.5' } })),
      writeFile(join(marker, 'package.json'), JSON.stringify({ type: 'commonjs' })),
      writeFile(join(marker, 'index.js'), 'module.exports = {};\n'),
      writeFile(join(brace, 'package.json'), JSON.stringify({ name: 'brace-expansion', version: '5.0.5', main: 'index.js' })),
      writeFile(join(brace, 'index.js'), 'module.exports = {};\n'),
    ]);

    const entries = collectRuntimeModuleClosureEntries(['pi-agent'], [root]);
    assert.deepEqual(entries.map(entry => entry.moduleName), ['pi-agent', 'minimatch', 'brace-expansion']);
    assert.equal(entries[1].sourceModulePath, minimatch);
    assert.equal(entries[2].sourceModulePath, brace);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
