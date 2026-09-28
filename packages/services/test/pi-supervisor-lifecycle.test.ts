import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, sep } from 'node:path';
import { test } from 'node:test';
import { PiRpcClient } from '../src/pi-agent/pi-rpc-client.js';
import { PiSessionLease } from '../src/pi-agent/pi-session-lease.js';
import { PiSessionSupervisor } from '../src/pi-agent/pi-session-supervisor.js';

class Client extends EventEmitter {
  readonly pid = process.pid;
  disposed = false;
  streaming = false;
  constructor(readonly id: string, readonly file: string) { super(); }
  async start() {}
  async request(command: { type: string }) {
    return { success: true, data: command.type === 'get_state'
      ? { sessionId: this.id, sessionFile: this.file, isStreaming: this.streaming, pendingMessageCount: 0 } : {} };
  }
  async dispose() { this.disposed = true; }
}

test('create marks an isolated explicit Pi history path before constructing or starting its child', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-prestart-mark-'));
  const profile = join(root, 'profile');
  let client: Client | undefined;
  let file = '';
  const supervisor = new PiSessionSupervisor({ piEntry: join(root, 'unused'),
    env: { PI_CODING_AGENT_DIR: profile }, clientFactory: options => {
      const index = options.args.indexOf('--session');
      assert.notEqual(index, -1, 'new Pi child must receive a protected explicit path');
      file = options.args[index + 1]!;
      client = new Client(randomUUID(), file);
      client.start = async () => {
        const owner = JSON.parse(await readFile(`${file}.pi-agent-ide.lock`, 'utf8')) as { token: string };
        const marker = JSON.parse(await readFile(`${file}.pi-agent-ide.lock.runtime-uncertain`, 'utf8')) as { token: string };
        assert.equal(marker.token, owner.token, 'quarantine must be persisted before child startup');
      };
      return client as unknown as PiRpcClient;
    } });
  try {
    const view = await supervisor.createSession(root);
    assert.equal(view.sessionId, client?.id, 'Pi-reported identity is authoritative for a new session');
    assert.equal(view.sessionFile, file);
    const profileRelativeFile = relative(await realpath(profile), file);
    assert.ok(profileRelativeFile.split(sep)[0] === 'sessions' &&
      !profileRelativeFile.startsWith('..') && !isAbsolute(profileRelativeFile),
      'custom agent profile owns the session path');
    await supervisor.closeSession(view.sessionId);
  } finally {
    await supervisor.dispose();
    await rm(root, { recursive: true, force: true });
  }
});

test('failed pre-start quarantine never constructs a Pi child or leaves a reusable writer', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-prestart-refuse-'));
  const profile = join(root, 'profile');
  let constructed = 0;
  const original = PiSessionLease.prototype.markRuntimeUncertain;
  PiSessionLease.prototype.markRuntimeUncertain = async function() { throw new Error('quarantine persistence failed'); };
  const supervisor = new PiSessionSupervisor({ piEntry: join(root, 'unused'),
    env: { PI_CODING_AGENT_DIR: profile }, clientFactory: () => {
      constructed++;
      return new Client(randomUUID(), join(root, 'unexpected.jsonl')) as unknown as PiRpcClient;
    } });
  try {
    await assert.rejects(supervisor.createSession(root), /quarantine persistence failed/);
    assert.equal(constructed, 0);
  } finally {
    PiSessionLease.prototype.markRuntimeUncertain = original;
    await supervisor.dispose();
    await rm(root, { recursive: true, force: true });
  }
});

test('dispose waits for an in-flight create after lease acquisition and cannot publish a late session',
  { timeout: 15_000 }, async () => {
    const root = await mkdtemp(join(tmpdir(), 'pi-start-dispose-'));
    let file = '';
    let reservedFile = '';
    let id = '';
    const acquired = Promise.withResolvers<void>();
    const gate = Promise.withResolvers<void>();
    const original = PiSessionLease.acquire;
    const clients: Client[] = [];
    PiSessionLease.acquire = async function(sessionFile: string) {
      reservedFile = sessionFile;
      const lease = await original.call(PiSessionLease, sessionFile);
      acquired.resolve();
      await gate.promise;
      return lease;
    };
    const supervisor = new PiSessionSupervisor({ piEntry: join(root, 'unused'),
      env: { PI_CODING_AGENT_DIR: join(root, 'profile') }, clientFactory: options => {
        id = randomUUID();
        file = options.args[options.args.indexOf('--session') + 1]!;
        const client = new Client(id, file);
        clients.push(client);
        return client as unknown as PiRpcClient;
      } });
    let starting: Promise<unknown> | undefined;
    try {
      starting = supervisor.createSession(root);
      void starting.catch(() => {});
      await acquired.promise;
      const disposing = supervisor.dispose();
      assert.equal(await Promise.race([disposing.then(() => true),
        new Promise<boolean>(resolve => setImmediate(() => resolve(false)))]), false,
      'dispose must not complete while a start owns an unreleased lease');
      gate.resolve();
      await assert.rejects(starting, /disposed/);
      await disposing;
      assert.equal(clients.length, 0, 'a disposed pre-start lease never constructs Pi');
    } finally {
      gate.resolve();
      PiSessionLease.acquire = original;
      await Promise.allSettled(starting ? [starting] : []);
      await supervisor.dispose();
      // The failed start released its reserved path after no child was spawned.
      const lease = await PiSessionLease.acquire(reservedFile);
      await lease.release();
      await rm(root, { recursive: true, force: true });
    }
  });

test('dispose also drains a resume that acquired its history lease before Pi startup',
  { timeout: 15_000 }, async () => {
    const root = await mkdtemp(join(tmpdir(), 'pi-resume-dispose-'));
    const file = join(root, `${randomUUID()}.jsonl`);
    const id = randomUUID();
    const acquired = Promise.withResolvers<void>();
    const gate = Promise.withResolvers<void>();
    const original = PiSessionLease.acquire;
    let clients = 0;
    PiSessionLease.acquire = async function(sessionFile: string) {
      const lease = await original.call(PiSessionLease, sessionFile);
      acquired.resolve();
      await gate.promise;
      return lease;
    };
    const supervisor = new PiSessionSupervisor({ piEntry: join(root, 'unused'),
      env: { PI_CODING_AGENT_DIR: join(root, 'profile') }, clientFactory: () => {
        clients++;
        return new Client(id, file) as unknown as PiRpcClient;
      } });
    let resuming: Promise<unknown> | undefined;
    try {
      await writeFile(file, '{}\n');
      resuming = supervisor.resumeSession(root, file, id);
      void resuming.catch(() => {});
      await acquired.promise;
      const disposing = supervisor.dispose();
      assert.equal(await Promise.race([disposing.then(() => true),
        new Promise<boolean>(resolve => setImmediate(() => resolve(false)))]), false);
      gate.resolve();
      await assert.rejects(resuming, /disposed/);
      await disposing;
      assert.equal(clients, 0, 'disposed resume cannot start Pi after claiming a history lease');
      assert.equal(supervisor.getSession(id), undefined);
    } finally {
      gate.resolve();
      PiSessionLease.acquire = original;
      await Promise.allSettled(resuming ? [resuming] : []);
      await supervisor.dispose();
      const lease = await PiSessionLease.acquire(file);
      await lease.release();
      await rm(root, { recursive: true, force: true });
    }
  });

test('successful model retry does not erase an extension error from the same run', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-retry-extension-'));
  let client: Client | undefined;
  const supervisor = new PiSessionSupervisor({ piEntry: join(root, 'unused'),
    env: { PI_CODING_AGENT_DIR: join(root, 'profile') }, clientFactory: options => {
      client = new Client(randomUUID(), options.args[options.args.indexOf('--session') + 1]!);
      return client as unknown as PiRpcClient;
    } });
  try {
    const view = await supervisor.createSession(root);
    client!.streaming = true;
    assert.equal(await supervisor.sendText(view.sessionId, 'run'), 'run');
    client!.emit('record', { type: 'agent_start' });
    client!.emit('record', { type: 'message_end', message: { role: 'assistant', stopReason: 'error', errorMessage: 'overloaded' } });
    client!.emit('record', { type: 'auto_retry_start' });
    client!.emit('record', { type: 'agent_start' });
    client!.emit('record', { type: 'extension_error', error: 'extension failed' });
    client!.emit('record', { type: 'auto_retry_end', success: true });
    client!.emit('record', { type: 'agent_settled' });
    assert.equal(supervisor.getSession(view.sessionId)?.error, 'extension failed');
    assert.equal(supervisor.getSession(view.sessionId)?.phase, 'error');
  } finally {
    await supervisor.dispose();
    await rm(root, { recursive: true, force: true });
  }
});

test('resume waits for the previous exit lease cleanup, without creating another client early',
  { timeout: 15_000 }, async () => {
    const root = await mkdtemp(join(tmpdir(), 'pi-exit-dispose-'));
    let file = '';
    let id = '';
    const clients: Client[] = [];
    const original = PiSessionLease.prototype.release;
    const releaseEntered = Promise.withResolvers<void>();
    const gate = Promise.withResolvers<void>();
    const supervisor = new PiSessionSupervisor({ piEntry: join(root, 'unused'),
      env: { PI_CODING_AGENT_DIR: join(root, 'profile') }, clientFactory: options => {
        if (!id) id = randomUUID();
        file = options.args[options.args.indexOf('--session') + 1]!;
        const client = new Client(id, file);
        clients.push(client);
        return client as unknown as PiRpcClient;
      } });
    let resuming: Promise<unknown> | undefined;
    try {
      const first = await supervisor.createSession(root);
      await writeFile(file, '');
      let blockFirst = true;
      PiSessionLease.prototype.release = async function() {
        if (blockFirst) { blockFirst = false; releaseEntered.resolve(); await gate.promise; }
        return original.call(this);
      };
      clients[0]!.emit('exit', { code: 1, signal: null });
      await releaseEntered.promise;
      resuming = supervisor.resumeSession(root, first.sessionFile, id);
      void resuming.catch(() => {});
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(clients.length, 1, 'resume must await old release before constructing a new Pi client');
      gate.resolve();
      const second = await resuming;
      assert.equal(second.sessionId, id);
      assert.equal(clients.length, 2);
      await supervisor.closeSession(id);
      const lease = await PiSessionLease.acquire(file);
      await lease.release();
    } finally {
      gate.resolve();
      PiSessionLease.prototype.release = original;
      await Promise.allSettled(resuming ? [resuming] : []);
      await supervisor.dispose();
      await rm(root, { recursive: true, force: true });
    }
  });

test('exit does not release the writer lease until descendant cleanup has completed', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-exit-tree-gate-'));
  const id = randomUUID();
  let file = '';
  const gate = Promise.withResolvers<void>();
  const entered = Promise.withResolvers<void>();
  const clients: Client[] = [];
  const supervisor = new PiSessionSupervisor({ piEntry: join(root, 'unused'),
    env: { PI_CODING_AGENT_SESSION_DIR: root }, clientFactory: options => {
      file = options.args[options.args.indexOf('--session') + 1]!;
      const client = new Client(id, file);
      if (clients.length === 0) client.dispose = async () => {
        entered.resolve();
        await gate.promise;
        client.disposed = true;
      };
      clients.push(client);
      return client as unknown as PiRpcClient;
    } });
  let resuming: Promise<unknown> | undefined;
  try {
    const first = await supervisor.createSession(root);
    await writeFile(file, '');
    clients[0]!.emit('exit', { code: 1, signal: null });
    await entered.promise;
    resuming = supervisor.resumeSession(root, first.sessionFile, id);
    void resuming.catch(() => {});
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(clients.length, 1);
    assert.equal((JSON.parse(await readFile(`${file}.pi-agent-ide.lock`, 'utf8')) as { pid: number }).pid, process.pid);
    gate.resolve();
    assert.equal((await resuming as { sessionId: string }).sessionId, id);
    assert.equal(clients.length, 2);
  } finally {
    gate.resolve();
    await Promise.allSettled(resuming ? [resuming] : []);
    await supervisor.dispose();
    await rm(root, { recursive: true, force: true });
  }
});

test('failed tree verification on close retains the writer lease and quarantine', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-close-tree-failed-'));
  let client: Client | undefined;
  const supervisor = new PiSessionSupervisor({ piEntry: join(root, 'unused'),
    env: { PI_CODING_AGENT_SESSION_DIR: root }, clientFactory: options => {
      client = new Client(randomUUID(), options.args[options.args.indexOf('--session') + 1]!);
      client.dispose = async () => { throw new Error('cannot verify tool descendants'); };
      return client as unknown as PiRpcClient;
    } });
  try {
    const view = await supervisor.createSession(root);
    await assert.rejects(supervisor.closeSession(view.sessionId), /cannot verify tool descendants/);
    assert.ok(await readFile(`${view.sessionFile}.pi-agent-ide.lock`, 'utf8'));
    assert.ok(await readFile(`${view.sessionFile}.pi-agent-ide.lock.runtime-uncertain`, 'utf8'));
    await assert.rejects(PiSessionLease.acquire(view.sessionFile), /quarantined/);
  } finally {
    await assert.rejects(supervisor.dispose(), /Pi session disposal failed/);
    await rm(root, { recursive: true, force: true });
  }
});
