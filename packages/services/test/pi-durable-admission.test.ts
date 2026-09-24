import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { PiCommandLedger } from '../src/pi-agent/pi-command-ledger.js';
import { PiNativeV4Service } from '../src/pi-agent/pi-native-v4-service.js';
import { PiSessionSupervisor } from '../src/pi-agent/pi-session-supervisor.js';
import { PiRpcClient, PiRpcError } from '../src/pi-agent/pi-rpc-client.js';
import { PiSessionCatalog } from '../src/pi-agent/pi-session-catalog.js';

test('durable admission fences repeated create across Host restarts and queries saved ACK', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-durable-create-'));
  let starts = 0;
  const sessionId = randomUUID();
  const fake = Object.assign(new EventEmitter(), {
    createSession: async () => { starts++; return { sessionId, sessionFile: join(root, 'history.jsonl'),
      workspacePath: root, pid: process.pid, phase: 'idle', uncertainDelivery: false }; },
    getState: async () => ({ sessionId, sessionFile: join(root, 'history.jsonl'), isStreaming: false }),
    closeSession: async () => {}, dispose: async () => {},
  }) as unknown as PiSessionSupervisor;
  const envelope = { commandId: randomUUID(), clientId: 'durable', sessionId: null,
    type: 'createSession' as const, issuedAt: Date.now(), payload: { workspaceId: root } };
  const directory = join(root, 'index');
  const first = new PiNativeV4Service(fake, directory);
  try {
    assert.equal((await first.sendConversationCommandV4({ workspacePath: root, envelope })).status, 'accepted');
    const second = new PiNativeV4Service(fake, directory);
    try {
      const query = await second.queryConversationCommandsV4({ workspacePath: root,
        commands: [{ commandId: envelope.commandId, sessionId: null }] });
      assert.equal(query.results[0]?.result !== 'unknown' && query.results[0]?.result.status, 'accepted');
      assert.equal((await second.sendConversationCommandV4({ workspacePath: root, envelope })).status, 'duplicate');
      assert.equal(starts, 1);
    } finally { await second.dispose(); }
  } finally { await first.dispose(); await rm(root, { recursive: true, force: true }); }
});

test('unknown prompt delivery survives Host restart as a blocked session and is never replayed', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-unknown-resume-'));
  let sessionFile = join(root, 'session.jsonl');
  const directory = join(root, 'catalog');
  const id = randomUUID();
  let prompts = 0;
  let delivered = false;
  const target = { workspacePath: root };
  const createSupervisor = () => new PiSessionSupervisor({ piEntry: join(root, 'unused'),
    env: { PI_CODING_AGENT_SESSION_DIR: root }, clientFactory: options => {
    sessionFile = options.args[options.args.indexOf('--session') + 1]!;
    const client = Object.assign(new EventEmitter(), {
      pid: process.pid, start: async () => {}, dispose: async () => {},
      request: async (command: { type: string }) => {
        if (command.type === 'prompt') { prompts++; throw new PiRpcError('TIMEOUT', 'prompt write timed out', 'unknown'); }
        return { success: true, data: command.type === 'get_state'
          ? { sessionId: id, sessionFile, isStreaming: false, isCompacting: false, pendingMessageCount: 0 }
          : command.type === 'get_entries' ? { entries: [], leafId: null }
          : command.type === 'get_messages' ? { messages: delivered
            ? [{ role: 'user', content: 'maybe executed', timestamp: 1000 }] : [] } : {} };
      },
    });
    return client as unknown as PiRpcClient;
  } });
  const create = { commandId: randomUUID(), clientId: 'unknown', sessionId: null,
    type: 'createSession' as const, issuedAt: Date.now(), payload: { workspaceId: root } };
  let first: PiNativeV4Service | undefined;
  let restarted: PiNativeV4Service | undefined;
  try {
    first = new PiNativeV4Service(createSupervisor(), directory);
    assert.equal((await first.sendConversationCommandV4({ ...target, envelope: create })).status, 'accepted');
    const commandId = randomUUID();
    const envelope = { commandId, clientId: 'unknown', sessionId: id,
      type: 'sendText' as const, issuedAt: Date.now(), payload: { text: 'maybe executed' } };
    assert.equal((await first.sendConversationCommandV4({ ...target, envelope })).reasonCode, 'pi.deliveryUnknown');
    await first.dispose(); first = undefined;
    const bookmark = JSON.parse(await readFile(join(directory, `${id}.json`), 'utf8')) as { uncertainDelivery: boolean; pendingIntent?: { commandId: string } };
    assert.equal(bookmark.uncertainDelivery, true);
    assert.equal(bookmark.pendingIntent?.commandId, commandId);
    restarted = new PiNativeV4Service(createSupervisor(), directory);
    const query = await restarted.queryConversationCommandsV4({ ...target,
      commands: [{ commandId, sessionId: id }] });
    assert.equal(query.results[0]?.result !== 'unknown' && query.results[0]?.result.reasonCode, 'pi.deliveryUnknown');
    await restarted.subscribeConversationV4({ ...target, sessionId: id });
    const next = await restarted.sendConversationCommandV4({ ...target, envelope: {
      ...envelope, commandId: randomUUID(), payload: { text: 'must not execute until reconciled' },
    } });
    assert.equal(next.status, 'failed');
    assert.equal(prompts, 1);
    await restarted.dispose(); restarted = undefined;
    const persisted = JSON.parse(await readFile(join(directory, `${id}.json`), 'utf8')) as { pendingIntent?: { commandId: string } };
    assert.equal(persisted.pendingIntent?.commandId, commandId);
    delivered = true;
    await writeFile(sessionFile, '{}\n');
    restarted = new PiNativeV4Service(createSupervisor(), directory);
    await restarted.subscribeConversationV4({ ...target, sessionId: id });
    const rows = await restarted.conversationRowsRangeV4({ ...target, sessionId: id, limit: 100 });
    assert.equal(rows.rows.find(row => row.kind === 'userInput')?.sourceCommandId, commandId);
    assert.equal(prompts, 1, 'reconciliation reads history; it never resends the old prompt');
  } finally { await restarted?.dispose(); await first?.dispose(); await rm(root, { recursive: true, force: true }); }
});

test('a crash with a reserved unknown-delivery receipt cannot replay a command', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-durable-unknown-'));
  const directory = join(root, 'index');
  const key = `${root}:create:${randomUUID()}`;
  const ledger = new PiCommandLedger(join(directory, 'command-admission'));
  let starts = 0;
  const fake = Object.assign(new EventEmitter(), { createSession: async () => { starts++; throw Error('replayed'); },
    dispose: async () => {} }) as unknown as PiSessionSupervisor;
  const envelope = { commandId: key.slice(-36), clientId: 'durable', sessionId: null,
    type: 'createSession' as const, issuedAt: Date.now(), payload: { workspaceId: root } };
  try {
    assert.equal(await ledger.reserve(key), true);
    const restarted = new PiNativeV4Service(fake, directory);
    const ack = await restarted.sendConversationCommandV4({ workspacePath: root, envelope });
    assert.equal(ack.reasonCode, 'pi.deliveryUnknown');
    assert.equal(starts, 0);
    const query = await restarted.queryConversationCommandsV4({ workspacePath: root,
      commands: [{ commandId: envelope.commandId, sessionId: null }] });
    assert.equal(query.results[0]?.result !== 'unknown' && query.results[0]?.result.reasonCode, 'pi.deliveryUnknown');
    await restarted.dispose();
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('a first-input extension side effect without JSONL leaves a discoverable, blocked identity', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-no-history-side-effect-'));
  const directory = join(root, 'catalog');
  const sessionId = randomUUID();
  const sessionFile = join(root, 'never-created.jsonl');
  const commandId = randomUUID();
  const target = { workspacePath: root };
  let effects = 0;
  const fake = Object.assign(new EventEmitter(), {
    createSession: async () => ({ sessionId, sessionFile, workspacePath: root,
      pid: process.pid, phase: 'idle' as const, uncertainDelivery: false }),
    getState: async () => ({ sessionId, sessionFile, isStreaming: false, isCompacting: false,
      pendingMessageCount: 0 }),
    sendText: async () => {
      const saved = JSON.parse(await readFile(join(directory, `${sessionId}.json`), 'utf8')) as {
        pendingIntent?: { commandId: string }; sessionFile: string };
      assert.equal(saved.pendingIntent?.commandId, commandId,
        'the recoverable pointer must be durable before any extension side effect');
      assert.equal(saved.sessionFile, sessionFile);
      effects++;
      return 'noRun' as const;
    },
    closeSession: async () => {}, dispose: async () => {},
  }) as unknown as PiSessionSupervisor;
  const envelope = { commandId, clientId: 'no-history', sessionId: null,
    type: 'createSession' as const, issuedAt: Date.now(),
    payload: { workspaceId: root, firstInput: { text: '/side-effect' } } };
  const first = new PiNativeV4Service(fake, directory);
  let resumed: PiNativeV4Service | undefined;
  try {
    assert.equal((await first.sendConversationCommandV4({ ...target, envelope })).status, 'accepted');
    assert.equal(effects, 1);
    assert.equal(await readFile(sessionFile, 'utf8').then(() => true, () => false), false);
    await first.dispose();
    resumed = new PiNativeV4Service(fake, directory);
    await resumed.subscribeConversationV4({ ...target, sessionId });
    const record = (resumed as unknown as { sessions: Map<string, { snapshot: {
      control: { phase: string; lastError: unknown } } }> }).sessions.get(sessionId);
    assert.equal(record?.snapshot.control.phase, 'error');
    assert.ok(record?.snapshot.control.lastError);
    const rejected = await resumed.sendConversationCommandV4({ ...target, envelope: {
      commandId: randomUUID(), clientId: 'no-history', sessionId,
      type: 'sendText', issuedAt: Date.now(), payload: { text: 'must stay blocked' },
    } });
    assert.equal(rejected.reasonCode, 'pi.deliveryUnknown');
    assert.equal((await resumed.sendConversationCommandV4({ ...target, envelope })).status, 'duplicate');
    assert.equal(effects, 1);
  } finally { await resumed?.dispose(); await first.dispose(); await rm(root, { recursive: true, force: true }); }
});

test('cold Pi history ending with a user message cannot be shown as completed success', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-cold-user-only-'));
  const directory = join(root, 'catalog');
  const file = join(root, 'history.jsonl');
  const id = randomUUID();
  const target = { workspacePath: root };
  await writeFile(file, '{"type":"session"}\n');
  await new PiSessionCatalog(directory).save({ sessionId: id, sessionFile: file,
    workspacePath: root, workspaceKey: root, workspaceId: root,
    createdAt: Date.now(), lastActivityAt: Date.now(), uncertainDelivery: false });
  const supervisor = new PiSessionSupervisor({ piEntry: join(root, 'unused'),
    clientFactory: () => Object.assign(new EventEmitter(), {
      pid: process.pid, start: async () => {}, dispose: async () => {},
      request: async (command: { type: string }) => ({ success: true, data: command.type === 'get_state'
        ? { sessionId: id, sessionFile: file, isStreaming: false, isCompacting: false,
          pendingMessageCount: 0 }
        : command.type === 'get_entries' ? { entries: [], leafId: null }
        : command.type === 'get_messages' ? { messages: [{ role: 'user', content: 'unfinished', timestamp: 1 }] } : {} }),
    }) as unknown as PiRpcClient });
  const service = new PiNativeV4Service(supervisor, directory);
  try {
    await service.subscribeConversationV4({ ...target, sessionId: id });
    const record = (service as unknown as { sessions: Map<string, { snapshot: {
      control: { phase: string; lastError: unknown };
      rows: { window: { kind: string; state?: string }[] } } }> }).sessions.get(id);
    assert.equal(record?.snapshot.control.phase, 'error');
    assert.ok(record?.snapshot.control.lastError);
    assert.equal(record?.snapshot.rows.window.find(row => row.kind === 'turnHeader')?.state, 'running');
  } finally { await service.dispose(); await rm(root, { recursive: true, force: true }); }
});
