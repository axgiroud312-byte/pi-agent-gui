import assert from 'node:assert/strict';
import { test } from 'node:test';
import { collectWindowsDescendants } from '../src/process/processTreeSnapshotAsync.js';
import type { ProcessIdentity } from '../src/process/processTreeTypes.js';

test('Pi tree excludes older children of recycled Windows parent PIDs', () => {
  const identity = (pid: number, parentPid: number, createdAtUs: number): ProcessIdentity => ({
    pid, parentPid, startTime: `windows-utc-us:${createdAtUs}`,
  });
  const table = [
    identity(200, 100, 900), // Old child retained the same PPID after root PID 100 was reused.
    identity(201, 200, 1_200), // Newer child of that old branch is still unrelated.
    identity(300, 100, 1_100), // Actual child of the new root.
    identity(301, 300, 1_050), // Older process after parent PID 300 was reused.
    identity(302, 300, 1_200), // Actual grandchild.
    { pid: 400, parentPid: 100, startTime: 'unknown' },
  ];
  assert.deepEqual(collectWindowsDescendants(100, table, 1_000n).map(({ pid }) => pid), [300, 302]);
});
