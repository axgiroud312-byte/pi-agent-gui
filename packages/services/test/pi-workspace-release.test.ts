import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { createPiAgentService } from '../src/pi-agent/pi-agent-service.js';
import { PiSessionSupervisor } from '../src/pi-agent/pi-session-supervisor.js';
import { PiSessionLease } from '../src/pi-agent/pi-session-lease.js';

test('native workspace release awaits Pi exit and lease release, preserves the other workspace and advances identity',
  { timeout: 30_000 }, async () => {
    const root = await mkdtemp(join(tmpdir(), 'pi-workspace-release-'));
    const one = { workspacePath: join(root, 'one') }, two = { workspacePath: join(root, 'two') };
    await Promise.all([mkdir(one.workspacePath), mkdir(two.workspacePath)]);
    const piEntry = fileURLToPath(import.meta.resolve('@earendil-works/pi-coding-agent/rpc-entry'));
    const supervisor = new PiSessionSupervisor({ piEntry,
      env: { PI_CODING_AGENT_DIR: join(root, 'profile'), PI_OFFLINE: '1' },
      rpcArgs: ['--offline', '--no-extensions', '--no-skills', '--no-prompt-templates', '--no-context-files'],
    });
    const service = createPiAgentService(piEntry, supervisor);
    const events: string[] = [];
    const listener = service.onAgentRuntimeLifecycle(event => {
      if (event.workspaceKey === one.workspacePath) events.push(event.state);
    });
    const create = async (target: { workspacePath: string }) => {
      const ack = await service.sendConversationCommandV4({ ...target, envelope: {
        commandId: randomUUID(), clientId: 'workspace-release', sessionId: null, type: 'createSession',
        issuedAt: Date.now(), payload: { workspaceId: target.workspacePath },
      } });
      assert.equal(ack.status, 'accepted', ack.message);
      assert.equal(ack.result?.type, 'createSession');
      if (ack.result?.type !== 'createSession') throw new Error('Missing session');
      return supervisor.getSession(ack.result.sessionId)!;
    };
    try {
      const subscription = await service.subscribeSessionsIndexV4(one);
      const [first, other] = await Promise.all([create(one), create(two)]);
      const before = await service.getWorkspaceRuntimeIdentity(one);
      await Promise.all([service.disposeWorkspace(one), service.disposeWorkspace(one)]);
      assert.equal(supervisor.getSession(first.sessionId), undefined);
      assert.throws(() => process.kill(first.pid, 0), /ESRCH|no such process/i);
      const lease = await PiSessionLease.acquire(first.sessionFile);
      await lease.release();
      assert.equal(supervisor.getSession(other.sessionId)?.pid, other.pid);
      assert.equal((await supervisor.getState(other.sessionId)).sessionId, other.sessionId);
      await assert.rejects(service.resyncSessionsIndexV4({ ...one, subscriptionId: subscription.ack.subscriptionId }), /subscription/);
      assert.deepEqual(events, ['available', 'unavailable']);
      const after = await service.getWorkspaceRuntimeIdentity(one);
      assert.ok(after.generation > before.generation);
      assert.notEqual(after.identity, before.identity);
      await service.subscribeSessionsIndexV4(one);
      const reopened = await create(one);
      assert.notEqual(reopened.pid, first.pid);
      assert.deepEqual(events, ['available', 'unavailable', 'available']);
    } finally {
      listener.dispose();
      await service.disposeAllAndWait();
      await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

test('workspace release fences new admission and drains an already pending startup without leaking it', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-release-starting-'));
  const gate = Promise.withResolvers<void>();
  const started = Promise.withResolvers<void>();
  const sessionId = randomUUID();
  const active = new Set<string>();
  let starts = 0;
  const fake = Object.assign(new EventEmitter(), {
    createSession: async () => {
      starts++;
      started.resolve();
      await gate.promise;
      active.add(sessionId);
      return { sessionId, sessionFile: join(root, 'session.jsonl'), workspacePath: root,
        pid: process.pid, phase: 'idle' as const, uncertainDelivery: false };
    },
    closeSession: async (id: string) => { active.delete(id); },
    dispose: async () => { active.clear(); },
  });
  const service = createPiAgentService('unused', fake as unknown as PiSessionSupervisor);
  const target = { workspacePath: root };
  const create = () => service.sendConversationCommandV4({ ...target, envelope: {
    commandId: randomUUID(), clientId: 'release-race', sessionId: null, type: 'createSession',
    issuedAt: Date.now(), payload: { workspaceId: root },
  } });
  try {
    const pending = create();
    await started.promise;
    const releasing = service.disposeWorkspace(target);
    const rejected = await create();
    assert.equal(rejected.status, 'failed');
    assert.equal(rejected.reasonCode, 'pi.workspaceClosing');
    assert.equal(starts, 1, 'Closing workspace cannot start another Pi');
    gate.resolve();
    await releasing;
    const cancelled = await pending;
    assert.equal(cancelled.status, 'failed', 'A startup cancelled before admission is not accepted');
    assert.match(cancelled.message ?? '', /workspace is closing/);
    assert.equal(active.size, 0, 'Release must wait for the in-flight runtime to be closed');
  } finally {
    gate.resolve();
    await service.disposeAllAndWait();
    await rm(root, { recursive: true, force: true });
  }
});
