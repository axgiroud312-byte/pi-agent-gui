import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import { packagedPiEsbuildEnv } from '../src/pi-agent/pi-packaged-esbuild-env.js';

const resources = join('D:', 'isolated-package', 'resources');
const entry = join(resources, 'app.asar', 'node_modules', '@earendil-works', 'pi-coding-agent', 'dist', 'rpc-entry.js');
const binary = join(resources, 'app.asar.unpacked', 'node_modules', '@earendil-works', 'chord', 'node_modules', '@esbuild', 'win32-x64', 'esbuild.exe');

test('only a packaged fixed Pi RPC entry receives the physical Chord esbuild binary', () => {
  const seen: string[] = [];
  const patch = packagedPiEsbuildEnv(entry, {}, 'win32', 'x64', path => { seen.push(path); return path === binary; });
  assert.deepEqual(patch, { ESBUILD_BINARY_PATH: binary });
  assert.deepEqual(seen, [binary]);
  assert.deepEqual(packagedPiEsbuildEnv(join(resources, 'app.asar', 'node_modules', 'other', 'rpc-entry.js'), {}, 'win32', 'x64', () => { throw new Error('should not probe'); }), {});
  assert.deepEqual(packagedPiEsbuildEnv(join(resources, 'source', 'rpc-entry.js'), {}, 'win32', 'x64', () => { throw new Error('should not probe'); }), {});
});

test('explicit inherited ESBUILD_BINARY_PATH is never overridden', () => {
  assert.deepEqual(packagedPiEsbuildEnv(entry, { ESBUILD_BINARY_PATH: 'D:\\caller\\esbuild.exe' }, 'win32', 'x64', () => { throw new Error('should not probe'); }), {});
  assert.deepEqual(packagedPiEsbuildEnv(entry, { ESBUILD_BINARY_PATH: '' }, 'win32', 'x64', () => { throw new Error('should not probe'); }), {});
});

test('packaged Pi fails before spawn if its target binary is missing', () => {
  assert.throws(() => packagedPiEsbuildEnv(entry, {}, 'win32', 'x64', () => false), /binary is missing/);
});

test('non-Windows packaged targets use the target-specific bin path', () => {
  const macEntry = join(resources, 'app.asar', 'node_modules', '@earendil-works', 'pi-coding-agent', 'dist', 'rpc-entry.js');
  const expected = join(resources, 'app.asar.unpacked', 'node_modules', '@earendil-works', 'chord', 'node_modules', '@esbuild', 'darwin-arm64', 'bin', 'esbuild');
  assert.deepEqual(packagedPiEsbuildEnv(macEntry, {}, 'darwin', 'arm64', path => path === expected), { ESBUILD_BINARY_PATH: expected });
});
