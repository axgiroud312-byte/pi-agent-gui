import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { conversationTopicWireFrameSchema } from '@zcode/shared/zcode-protocol-v4';
import { PiNativeV4Service } from '../src/pi-agent/pi-native-v4-service.js';
import type { PiSessionSupervisor } from '../src/pi-agent/pi-session-supervisor.js';

test('a bookmark failure after accepted Pi input preserves its ACK and blocks a later uncorrelatable input', async () => {
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
    assert.equal(create.status, 'accepted');
    assert.equal(promptCalls, 1);
    const frames: unknown[] = [];
    const listener = service.onDynamicConversationFrame(target)(frame => frames.push(frame));
    try {
      await service.subscribeConversationV4({ ...target, sessionId });
      await new Promise(resolve => setImmediate(resolve));
      const initial = conversationTopicWireFrameSchema.parse(frames[0]);
      assert.equal(initial.kind, 'complete');
      if (initial.kind === 'complete' && initial.frame.payload.kind === 'snapshot') {
        assert.equal(initial.frame.payload.snapshot.control.lastError?.code, 'pi.historyBookmarkFailed');
      }
      const next = await service.sendConversationCommandV4({ ...target, envelope: {
        commandId: randomUUID(), clientId: 'bookmark-ack', sessionId, type: 'sendText',
        issuedAt: Date.now(), payload: { text: 'second explicit user action' },
      } });
      assert.equal(next.status, 'failed');
      assert.match(next.message ?? '', /filesystem unavailable|persist Pi input correlation/);
      assert.equal(promptCalls, 1, 'storage failure cannot admit a second uncorrelatable side effect');
    } finally { listener.dispose(); }
  } finally { await service.dispose(); await rm(workspacePath, { recursive: true, force: true }); }
});
