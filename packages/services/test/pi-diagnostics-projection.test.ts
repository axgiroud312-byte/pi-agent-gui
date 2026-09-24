import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { PiNativeV4Service } from '../src/pi-agent/pi-native-v4-service.js';
import { PiSessionSupervisor } from '../src/pi-agent/pi-session-supervisor.js';
import type { PiRpcClient } from '../src/pi-agent/pi-rpc-client.js';

test('startup extension errors, stderr, malformed protocol and unknown records remain visible without payloads in logs', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-diagnostics-'));
  const id = randomUUID();
  let sessionFile = '';
  const secret = 'secret-model-token-and-prompt';
  const warnings: string[] = [];
  const originalWarn = console.warn;
  class Client extends EventEmitter {
    pid = process.pid;
    async start() {
      this.emit('record', { type: 'extension_error', error: secret });
      this.emit('diagnostic', { kind: 'stderr', message: secret });
    }
    async dispose() {}
    async request(command: { type: string }) {
      return { success: true, data: command.type === 'get_state'
        ? { sessionId: id, sessionFile, isStreaming: false, isCompacting: false,
          pendingMessageCount: 0 } : {} };
    }
  }
  const client = new Client();
  const supervisor = new PiSessionSupervisor({ piEntry: join(root, 'unused'),
    env: { PI_CODING_AGENT_SESSION_DIR: root },
    clientFactory: options => {
      sessionFile = options.args[options.args.indexOf('--session') + 1]!;
      return client as unknown as PiRpcClient;
    } });
  const service = new PiNativeV4Service(supervisor, join(root, 'catalog'));
  console.warn = (...args: unknown[]) => { warnings.push(args.map(String).join(' ')); };
  try {
    const ack = await service.sendConversationCommandV4({ workspacePath: root, envelope: {
      commandId: randomUUID(), clientId: 'diagnostics', sessionId: null,
      type: 'createSession', issuedAt: Date.now(), payload: { workspaceId: root },
    } });
    assert.equal(ack.status, 'accepted');
    const record = (service as unknown as { sessions: Map<string, { snapshot: { control: {
      phase: string; lastError: { message: string } | null } } }> }).sessions.get(id);
    assert.equal(record?.snapshot.control.phase, 'error');
    assert.match(record?.snapshot.control.lastError?.message ?? '', /extension failed/i);
    client.emit('record', { type: 'future_metadata', payload: secret });
    client.emit('record', { type: 'future_metadata', payload: secret });
    client.emit('diagnostic', { kind: 'protocol', message: secret });
    assert.match(record?.snapshot.control.lastError?.message ?? '', /protocol output was malformed/i);
    assert.equal(warnings.filter(line => line.includes('unprojected Pi record')).length, 1);
    assert.ok(warnings.some(line => line.includes('Pi runtime diagnostic stderr')));
    assert.ok(warnings.some(line => line.includes('Pi runtime diagnostic protocol')));
    assert.ok(warnings.every(line => !line.includes(secret)), 'logs must not reveal stderr or unknown record payloads');
  } finally {
    console.warn = originalWarn;
    await service.dispose();
    await rm(root, { recursive: true, force: true });
  }
});
