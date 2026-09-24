import assert from 'node:assert/strict';
import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { PiSessionSupervisor } from '../src/pi-agent/pi-session-supervisor.js';

test('startup extension dialog fails closed before Pi attaches stdin and cannot authorize a side effect',
  { timeout: 30_000 }, async () => {
    const root = await mkdtemp(join(tmpdir(), 'pi-startup-dialog-'));
    const marker = join(root, 'allowed.txt');
    const piEntry = fileURLToPath(import.meta.resolve('@earendil-works/pi-coding-agent/rpc-entry'));
    const extension = fileURLToPath(new URL('./fixtures/pi-extension-startup-dialog.ts', import.meta.url));
    const supervisor = new PiSessionSupervisor({ piEntry,
      env: { PI_CODING_AGENT_DIR: join(root, 'profile'), PI_BOOTSTRAP_ALLOW_MARKER: marker, PI_TELEMETRY: '0' },
      rpcArgs: ['--offline', '--no-extensions', '-e', extension, '--no-skills', '--no-prompt-templates', '--no-context-files'],
    });
    try {
      // Pi 0.87.0 binds startup extensions before attaching its stdin reader.
      // A session_start dialog may therefore terminate startup rather than
      // accept even the immediate cancellation; failure must be visible/safe.
      await assert.rejects(supervisor.createSession(root), /exited|disposed|timeout/i);
      await assert.rejects(access(marker), /ENOENT/);
    } finally { await supervisor.dispose(); await rm(root, { recursive: true, force: true }); }
  });

test('real pinned Pi extension dialog without timeout is cancelled, not silently allowed or hung',
  { timeout: 30_000 }, async () => {
    const root = await mkdtemp(join(tmpdir(), 'pi-dialog-'));
    const piEntry = fileURLToPath(import.meta.resolve('@earendil-works/pi-coding-agent/rpc-entry'));
    const extension = fileURLToPath(new URL('./fixtures/pi-extension-dialog.ts', import.meta.url));
    const supervisor = new PiSessionSupervisor({ piEntry,
      env: { PI_CODING_AGENT_DIR: join(root, 'profile'), PI_TELEMETRY: '0' },
      rpcArgs: ['--offline', '--no-extensions', '-e', extension, '--no-skills', '--no-prompt-templates', '--no-context-files'],
    });
    const events: Record<string, unknown>[] = [];
    supervisor.on('record', (_id, event) => events.push(event));
    try {
      const view = await supervisor.createSession(root);
      const result = await Promise.race([
        supervisor.sendText(view.sessionId, '/pi-dialog-gate'),
        new Promise<never>((_, reject) => setTimeout(() => reject(Error('Pi dialog hung')), 5000).unref()),
      ]);
      assert.equal(result, 'noRun');
      assert.ok(events.some(event => event.type === 'extension_ui_request' && event.method === 'confirm'));
      assert.ok(events.some(event => event.type === 'extension_ui_request' && event.message === 'SAFE_DENIED'));
      assert.ok(!events.some(event => event.message === 'UNSAFE_GRANTED'));
    } finally { await supervisor.dispose(); await rm(root, { recursive: true, force: true }); }
  });
