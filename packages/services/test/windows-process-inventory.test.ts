import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  readWindowsProcessListAsync,
  verifyWindowsProcessIdentityAsync,
} from '../src/process/windowsProcessListAsync.js';
import {
  WINDOWS_TOOLHELP_ASSEMBLY_BASE64,
  WINDOWS_TOOLHELP_ASSEMBLY_SHA256,
  WINDOWS_TOOLHELP_SOURCE_SHA256,
} from '../src/process/windowsToolhelpProcessCommand.js';

test('precompiled Windows inventory keeps its reviewable source and assembly bytes intact', () => {
  const source = readFileSync(new URL('../src/process/NativeProcessList.cs', import.meta.url));
  const assembly = Buffer.from(WINDOWS_TOOLHELP_ASSEMBLY_BASE64, 'base64');
  assert.equal(createHash('sha256').update(source).digest('hex').toUpperCase(),
    WINDOWS_TOOLHELP_SOURCE_SHA256);
  assert.equal(createHash('sha256').update(assembly).digest('hex').toUpperCase(),
    WINDOWS_TOOLHELP_ASSEMBLY_SHA256);
});

test('Windows native inventory records the owned PID, parent and stable creation identity',
  { skip: process.platform !== 'win32' }, async () => {
    const inheritedModulePath = process.env.PSModulePath;
    delete process.env.PSModulePath; // Match the isolated Electron Host, not the CI test shell.
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
    try {
      await once(child, 'spawn');
      assert.ok(child.pid);
      const identities = await readWindowsProcessListAsync({ ownedProcessStartedAtMs: Date.now() });
      const identity = identities.find((row) => row.pid === child.pid);
      assert.ok(identity, 'the live owned process must have a queryable creation time');
      assert.equal(identity.parentPid, process.pid);
      assert.match(identity.startTime, /^windows-utc-us:\d+$/);
      assert.equal(await verifyWindowsProcessIdentityAsync(identity, 5000), true);
      assert.equal(await verifyWindowsProcessIdentityAsync(
        { ...identity, startTime: 'windows-utc-us:0' }, 5000), false);
      const exited = once(child, 'exit');
      assert.equal(child.kill('SIGKILL'), true);
      await exited;
      assert.equal(await verifyWindowsProcessIdentityAsync(identity, 5000), false,
        'an exited PID must never be accepted as the original owned process');
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      if (child.exitCode === null && child.signalCode === null) await once(child, 'exit');
      if (inheritedModulePath === undefined) delete process.env.PSModulePath;
      else process.env.PSModulePath = inheritedModulePath;
    }
  });
