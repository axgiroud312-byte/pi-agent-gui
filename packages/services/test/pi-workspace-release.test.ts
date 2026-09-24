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

test('global disposal drains in-flight create before returning and fences further admission', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-global-dispose-starting-'));
  const gate = Promise.withResolvers<void>();
  const started = Promise.withResolvers<void>();
  const sessionId = randomUUID();
  const active = new Set<string>();
  let starts = 0;
  let disposals = 0;
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
    dispose: async () => { disposals++; active.clear(); },
  });
  const service = createPiAgentService('unused', fake as unknown as PiSessionSupervisor);
  const target = { workspacePath: root };
  const create = () => service.sendConversationCommandV4({ ...target, envelope: {
    commandId: randomUUID(), clientId: 'global-dispose-race', sessionId: null, type: 'createSession',
    issuedAt: Date.now(), payload: { workspaceId: root },
  } });
  let pending: ReturnType<typeof create> | undefined;
  try {
    pending = create();
    await started.promise;
    const disposing = service.disposeAllAndWait();
    assert.equal(await Promise.race([disposing.then(() => true),
      new Promise<boolean>(resolve => setImmediate(() => resolve(false)))]), false,
    'global dispose must await the already started command');
    const rejected = await create();
    assert.equal(rejected.status, 'failed');
    assert.equal(starts, 1, 'disposal must fence new Pi starts');
    gate.resolve();
    await disposing;
    assert.equal((await pending).status, 'failed');
    assert.equal(active.size, 0, 'no runtime may become active after dispose completes');
    assert.equal(disposals, 1);
  } finally {
    gate.resolve();
    await Promise.allSettled(pending ? [pending] : []);
    await service.disposeAllAndWait();
    await rm(root, { recursive: true, force: true });
  }
});

test('failed workspace close still drains late admission and clears subscriptions and lifecycle state', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-release-failed-close-'));
  const gate = Promise.withResolvers<void>();
  const started = Promise.withResolvers<void>();
  const failure = new Error('first session close failed');
  const ids = [randomUUID(), randomUUID(), randomUUID()];
  const active = new Set<string>();
  const closed: string[] = [];
  let starts = 0;
  const fake = Object.assign(new EventEmitter(), {
    createSession: async () => {
      const index = starts++;
      if (index === 2) { started.resolve(); await gate.promise; }
      const id = ids[index]!;
      active.add(id);
      return { sessionId: id, sessionFile: join(root, `${id}.jsonl`), workspacePath: root,
        pid: process.pid, phase: 'idle' as const, uncertainDelivery: false };
    },
    closeSession: async (id: string) => {
      closed.push(id);
      active.delete(id);
      if (id === ids[0]) throw failure;
    },
    getState: async (id: string) => ({ sessionId: id, sessionFile: join(root, `${id}.jsonl`),
      isStreaming: false, isCompacting: false, pendingMessageCount: 0 }),
    dispose: async () => { active.clear(); },
  });
  const service = createPiAgentService('unused', fake as unknown as PiSessionSupervisor);
  const target = { workspacePath: root };
  const events: string[] = [];
  const listener = service.onAgentRuntimeLifecycle(event => events.push(event.state));
  const create = () => service.sendConversationCommandV4({ ...target, envelope: {
    commandId: randomUUID(), clientId: 'failed-release', sessionId: null, type: 'createSession',
    issuedAt: Date.now(), payload: { workspaceId: root },
  } });
  let pending: ReturnType<typeof create> | undefined;
  let releasing: Promise<void> | undefined;
  try {
    const subscription = await service.subscribeSessionsIndexV4(target);
    assert.equal((await create()).status, 'accepted');
    assert.equal((await create()).status, 'accepted');
    const before = await service.getWorkspaceRuntimeIdentity(target);
    pending = create();
    await started.promise;
    releasing = service.disposeWorkspace(target);
    void releasing.catch(() => {});
    assert.equal(await Promise.race([releasing.then(() => true, () => true),
      new Promise<boolean>(resolve => setImmediate(() => resolve(false)))]), false,
    'even a failing close must drain the pending startup');
    gate.resolve();
    await assert.rejects(releasing, error => error instanceof AggregateError && error.errors.includes(failure));
    assert.equal((await pending).status, 'failed');
    assert.deepEqual(closed.sort(), [...ids].sort(), 'all owned and late sessions are closed');
    assert.equal(active.size, 0);
    await assert.rejects(service.resyncSessionsIndexV4({ ...target, subscriptionId: subscription.ack.subscriptionId }), /subscription/);
    assert.deepEqual(events, ['available', 'unavailable']);
    assert.ok((await service.getWorkspaceRuntimeIdentity(target)).generation > before.generation);
  } finally {
    gate.resolve();
    await Promise.allSettled([...(pending ? [pending] : []), ...(releasing ? [releasing] : [])]);
    listener.dispose();
    await service.disposeAllAndWait();
    await rm(root, { recursive: true, force: true });
  }
});

test('failed global supervisor disposal still drains commands and aggregates the failure', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-global-failed-close-'));
  const gate = Promise.withResolvers<void>();
  const started = Promise.withResolvers<void>();
  const failure = new Error('supervisor close failed');
  const id = randomUUID();
  const active = new Set<string>();
  const fake = Object.assign(new EventEmitter(), {
    createSession: async () => {
      started.resolve();
      await gate.promise;
      active.add(id);
      return { sessionId: id, sessionFile: join(root, `${id}.jsonl`), workspacePath: root,
        pid: process.pid, phase: 'idle' as const, uncertainDelivery: false };
    },
    closeSession: async (sessionId: string) => { active.delete(sessionId); },
    dispose: async () => { throw failure; },
  });
  const service = createPiAgentService('unused', fake as unknown as PiSessionSupervisor);
  const target = { workspacePath: root };
  const events: string[] = [];
  const listener = service.onAgentRuntimeLifecycle(event => events.push(event.state));
  let pending: ReturnType<typeof service.sendConversationCommandV4> | undefined;
  let disposing: Promise<void> | undefined;
  try {
    const subscription = await service.subscribeSessionsIndexV4(target);
    pending = service.sendConversationCommandV4({ ...target, envelope: {
      commandId: randomUUID(), clientId: 'failed-global-dispose', sessionId: null, type: 'createSession',
      issuedAt: Date.now(), payload: { workspaceId: root },
    } });
    await started.promise;
    disposing = service.disposeAllAndWait();
    void disposing.catch(() => {});
    assert.equal(await Promise.race([disposing.then(() => true, () => true),
      new Promise<boolean>(resolve => setImmediate(() => resolve(false)))]), false,
    'supervisor failure cannot make global disposal return before its pending command');
    gate.resolve();
    await assert.rejects(disposing, error => error instanceof AggregateError && error.errors.includes(failure));
    assert.equal((await pending).status, 'failed');
    assert.equal(active.size, 0);
    await assert.rejects(service.resyncSessionsIndexV4({ ...target, subscriptionId: subscription.ack.subscriptionId }), /subscription/);
    assert.deepEqual(events, ['available', 'unavailable']);
  } finally {
    gate.resolve();
    await Promise.allSettled([...(pending ? [pending] : []), ...(disposing ? [disposing] : [])]);
    listener.dispose();
    await rm(root, { recursive: true, force: true });
  }
});

test('global disposal reports both a failing supervisor and a failing workspace close after cleanup', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-global-multiple-failures-'));
  const sessionId = randomUUID();
  const supervisorFailure = new Error('supervisor teardown failed');
  const sessionFailure = new Error('session close failed');
  let active = false;
  const fake = Object.assign(new EventEmitter(), {
    createSession: async () => {
      active = true;
      return { sessionId, sessionFile: join(root, `${sessionId}.jsonl`), workspacePath: root,
        pid: process.pid, phase: 'idle' as const, uncertainDelivery: false };
    },
    getState: async () => ({ sessionId, sessionFile: join(root, `${sessionId}.jsonl`),
      isStreaming: false, isCompacting: false, pendingMessageCount: 0 }),
    closeSession: async () => { active = false; throw sessionFailure; },
    dispose: async () => { throw supervisorFailure; },
  });
  const service = createPiAgentService('unused', fake as unknown as PiSessionSupervisor);
  const target = { workspacePath: root };
  let releasing: Promise<void> | undefined;
  let disposing: Promise<void> | undefined;
  try {
    const subscription = await service.subscribeSessionsIndexV4(target);
    const ack = await service.sendConversationCommandV4({ ...target, envelope: {
      commandId: randomUUID(), clientId: 'multiple-failures', sessionId: null, type: 'createSession',
      issuedAt: Date.now(), payload: { workspaceId: root },
    } });
    assert.equal(ack.status, 'accepted');
    releasing = service.disposeWorkspace(target);
    void releasing.catch(() => {});
    disposing = service.disposeAllAndWait();
    void disposing.catch(() => {});
    await assert.rejects(releasing, error => error instanceof AggregateError && error.errors.includes(sessionFailure));
    await assert.rejects(disposing, error => error instanceof AggregateError &&
      error.errors.includes(supervisorFailure) && error.errors.some(reason =>
        reason instanceof AggregateError && reason.errors.includes(sessionFailure)));
    assert.equal(active, false);
    await assert.rejects(service.resyncSessionsIndexV4({ ...target, subscriptionId: subscription.ack.subscriptionId }), /subscription/);
  } finally {
    await Promise.allSettled([...(releasing ? [releasing] : []), ...(disposing ? [disposing] : [])]);
    await rm(root, { recursive: true, force: true });
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
