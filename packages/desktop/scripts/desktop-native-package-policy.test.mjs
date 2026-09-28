import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDesktopNativePackagePrunePatterns, findDesktopNativePackageViolations } from './desktop-native-package-policy.mjs';

test('desktop native policy excludes every builder-collected esbuild platform before target injection', () => {
  const patterns = createDesktopNativePackagePrunePatterns('win32-x64');
  assert.ok(patterns.includes('!node_modules/@esbuild/**'));
  assert.ok(patterns.includes('!**/node_modules/@esbuild/**'));
});

test('desktop native policy rejects non-target esbuild packages at root and inside Chord', () => {
  const entries = [
    { path: '/node_modules/@esbuild/win32-x64/esbuild.exe', packState: 'unpack' },
    { path: '/node_modules/@esbuild/linux-x64/package.json', packState: 'pack' },
    { path: '/node_modules/@earendil-works/chord/node_modules/@esbuild/darwin-x64/package.json', packState: 'pack' },
  ];
  const violations = findDesktopNativePackageViolations(entries, 'win32-x64');
  assert.equal(violations.length, 2);
  assert.ok(violations.some(item => item.includes('linux-x64')));
  assert.ok(violations.some(item => item.includes('darwin-x64')));
});

test('desktop native policy requires the target esbuild binary unpacked', () => {
  const violations = findDesktopNativePackageViolations([
    { path: '/node_modules/@earendil-works/chord/node_modules/@esbuild/win32-x64/esbuild.exe', packState: 'pack' },
  ], 'win32-x64');
  assert.equal(violations.length, 1);
  assert.match(violations[0], /native file still|native 文件仍/);
});
