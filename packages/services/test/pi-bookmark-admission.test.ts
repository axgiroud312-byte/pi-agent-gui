import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { PiNativeV4Service } from '../src/pi-agent/pi-native-v4-service.js';
import type { PiSessionSupervisor } from '../src/pi-agent/pi-session-supervisor.js';

test('a bookmark failure before first input rejects admission without executing Pi', async () => {
  const workspacePath = await mkdtemp(join(tmpdir(), 'pi-bookmark-ack-'));
  const sessionId = randomUUID();
  const sessionFile = join(workspacePath, 'pi-history.jsonl');
  const view = { sessionId, sessionFile, workspacePath, pid: process.pid,
    phase: 'idle' as const, uncertainDelivery: false };
  let promptCalls = 0;
  const fake = Object.assign(new EventEmitter(), {
    createSession: async () => view,
    getState: async () => ({ sessionId, sessionFile, isStreaming: false, messageCount: 0 }),
    sendText: async () => { promptCalls++; },
    closeSession: async () => {},
    dispose: async () => {},
  });
  const service = new PiNativeV4Service(fake as unknown as PiSessionSupervisor, join(workspacePath, 'app'));
  const catalog = service as unknown as { catalog: { save: () => Promise<boolean> } };
  catalog.catalog.save = async () => { throw new Error('filesystem unavailable'); };
  const target = { workspacePath };
  try {
    const create = await service.sendConversationCommandV4({ ...target, envelope: {
      commandId: randomUUID(), clientId: 'bookmark-ack', sessionId: null, type: 'createSession',
      issuedAt: Date.now(), payload: { workspaceId: workspacePath, firstInput: { text: 'write once' } },
    } });
    assert.equal(create.status, 'failed');
    assert.match(create.message ?? '', /filesystem unavailable/);
    assert.equal(promptCalls, 0, 'no prompt may run before its identity is durable');
    const next = await service.sendConversationCommandV4({ ...target, envelope: {
      commandId: randomUUID(), clientId: 'bookmark-ack', sessionId, type: 'sendText',
      issuedAt: Date.now(), payload: { text: 'second explicit user action' },
    } });
    assert.equal(next.status, 'failed');
    assert.equal(promptCalls, 0);
  } finally { await service.dispose(); await rm(workspacePath, { recursive: true, force: true }); }
});
