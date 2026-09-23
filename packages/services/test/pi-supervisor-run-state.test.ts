import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { PiRpcClient } from '../src/pi-agent/pi-rpc-client.js';
import { PiSessionSupervisor } from '../src/pi-agent/pi-session-supervisor.js';

test('Pi admission, retry, compaction, extension no-run and agent_settled have distinct native phases', async () => {
  const workspacePath = await mkdtemp(join(tmpdir(), 'pi-phases-'));
  let streaming = false;
  let extensionNoRun = false;
  let sessionId = '';
  class FakePi extends EventEmitter {
    readonly pid = process.pid;
    async start() {}
    async dispose() {}
    async request(command: { type: string }) {
      if (command.type === 'prompt') streaming = !extensionNoRun;
      return { success: true, data: command.type === 'get_state'
        ? { sessionId, sessionFile: join(workspacePath, 'test.jsonl'),
          isStreaming: streaming, isCompacting: false, pendingMessageCount: 0 }
        : {} };
    }
  }
  const client = new FakePi();
  const supervisor = new PiSessionSupervisor({ piEntry: join(workspacePath, 'unused-cli.js'),
    clientFactory: options => {
      sessionId = options.args[options.args.indexOf('--session-id') + 1] ?? '';
      return client as unknown as PiRpcClient;
    } });
  const phase = () => supervisor.getSession(sessionId)?.phase;
  try {
    const created = await supervisor.createSession(workspacePath);
    assert.equal(created.sessionId, sessionId);
    assert.equal(phase(), 'idle');
    await supervisor.sendText(sessionId, 'real prompt');
    assert.equal(phase(), 'accepted', 'prompt reply does not complete the run');
    client.emit('record', { type: 'agent_start' });
    assert.equal(phase(), 'running');
    client.emit('record', { type: 'auto_retry_start' });
    assert.equal(phase(), 'retrying');
    client.emit('record', { type: 'auto_retry_end', success: true });
    assert.equal(phase(), 'running');
    client.emit('record', { type: 'compaction_start' });
    assert.equal(phase(), 'compacting');
    client.emit('record', { type: 'compaction_end' });
    client.emit('record', { type: 'agent_end' });
    assert.equal(phase(), 'running', 'agent_end alone never settles a Pi run');
    client.emit('record', { type: 'agent_settled' });
    assert.equal(phase(), 'settled');
    extensionNoRun = true;
    await supervisor.sendText(sessionId, 'extension command handled without run');
    assert.equal(phase(), 'idle', 'verified no-run extension input returns to idle without agent_settled');
  } finally {
    await supervisor.dispose();
    await rm(workspacePath, { recursive: true, force: true });
  }
});
