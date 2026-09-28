import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { PiSessionLease } from '../src/pi-agent/pi-session-lease.js';

interface Result { status: string; piPid?: number; error?: string }

test('two actual Hosts racing to resume one Pi JSONL: loser never constructs or starts Pi',
  { timeout: 40_000 }, async () => {
    const root = await mkdtemp(join(tmpdir(), 'pi-supervisor-race-'));
    const file = join(root, 'session.jsonl');
    const marker = join(root, 'clients-created.txt');
    const id = randomUUID();
    const children: ChildProcess[] = [];
    await writeFile(file, `${JSON.stringify({ type: 'session', version: 3, id,
      timestamp: new Date().toISOString(), cwd: root })}\n`);
    const original = await readFile(file, 'utf8');
    try {
      const startHost = () => {
        const child = spawn(process.execPath, ['--import', import.meta.resolve('tsx'),
          fileURLToPath(new URL('./fixtures/pi-supervisor-owner.mjs', import.meta.url)),
          root, file, id, marker, fileURLToPath(import.meta.resolve('@earendil-works/pi-coding-agent/rpc-entry'))],
        { stdio: ['ignore', 'pipe', 'pipe', 'ipc'], windowsHide: true,
          env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } });
        children.push(child);
        let stderr = '';
        child.stderr?.on('data', chunk => { stderr += String(chunk); });
        const result = new Promise<Result>((resolve, reject) => {
          child.once('message', message => resolve(message as Result));
          child.once('error', reject);
          child.once('exit', code => reject(new Error(`Host exited before report: ${code}: ${stderr}`)));
        });
        return result;
      };
      const results = await Promise.all([startHost(), startHost()]);
      assert.equal(results.filter(result => result.status === 'ready').length, 1);
      assert.match(results.find(result => result.status === 'rejected')?.error ?? '', /already owned|quarantined/);
      assert.equal((await readFile(marker, 'utf8')).trim().split('\n').length, 1,
        'The lease loser must not even construct a Pi client, let alone open history or run startup hooks');
      const pid = results.find(result => result.status === 'ready')?.piPid;
      assert.ok(pid && !children.some(child => child.pid === pid), 'Winner owns a real separate Pi process');
      assert.doesNotThrow(() => process.kill(pid, 0));
      const history = await readFile(file, 'utf8');
      assert.ok(history.startsWith(original), 'The original session header must remain intact');
      // Real Pi may append its initial thinking setting while opening the file;
      // this is precisely why the lease must precede startup, not just prompt.
      const entries = history.trim().split('\n').map(line => JSON.parse(line));
      assert.equal(entries.length, 2);
      assert.equal(entries[1].type, 'thinking_level_change');
    } finally {
      await Promise.all(children.map(async child => {
        if (child.exitCode !== null || child.signalCode !== null) return;
        const closed = once(child, 'close');
        if (child.connected) child.send('close'); else child.kill();
        await closed;
      }));
      const lease = await PiSessionLease.acquire(file);
      await lease.release();
      await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });
