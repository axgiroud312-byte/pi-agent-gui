import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { PiSessionLease } from '../src/pi-agent/pi-session-lease.js';

test('only one Host process owns a Pi session file; dead owner recovery never replays a command',
  { timeout: 20_000 }, async () => {
    const root = await mkdtemp(join(tmpdir(), 'pi-lease-'));
    const sessionFile = join(root, 'example.jsonl');
    const child = spawn(process.execPath, ['--import', import.meta.resolve('tsx'),
      fileURLToPath(new URL('./fixtures/pi-lease-owner.mjs', import.meta.url)), sessionFile],
    { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, windowsHide: true });
    try {
      await new Promise<void>((resolve, reject) => {
        child.stdout.once('data', chunk => String(chunk).includes('locked') ? resolve() : reject(new Error(String(chunk))));
        child.once('error', reject);
        child.once('exit', code => reject(new Error(`Lease owner exited early: ${code}`)));
      });
      await assert.rejects(PiSessionLease.acquire(sessionFile), /already owned/);
      child.kill();
      await new Promise(resolve => child.once('close', resolve));
      const recovered = await PiSessionLease.acquire(sessionFile);
      await assert.rejects(PiSessionLease.acquire(sessionFile), /already owned/);
      await recovered.release();
      const next = await PiSessionLease.acquire(sessionFile);
      await next.release();
    } finally {
      child.kill();
      await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });
