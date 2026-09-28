import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { PiNativeV4Service } from '../src/pi-agent/pi-native-v4-service.js';
import { PiSessionSupervisor } from '../src/pi-agent/pi-session-supervisor.js';
import { PiRpcClient } from '../src/pi-agent/pi-rpc-client.js';

const tick = () => new Promise<void>(resolve => setImmediate(resolve));

test('late records cannot strand a stale settled history read or overwrite a newer Pi result', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-ordered-history-'));
  let sessionFile = '';
  const id = randomUUID();
  let streaming = false;
  let calls = 0;
  const firstRead = Promise.withResolvers<void>();
  const readStarted = Promise.withResolvers<void>();
  const user = { role: 'user', content: 'input', timestamp: 1000 };
  const failed = { role: 'assistant', content: [{ type: 'text', text: 'stale failure' }], timestamp: 1001 };
  const final = { role: 'assistant', content: [{ type: 'text', text: 'authoritative' }], timestamp: 1002 };
  class DelayedClient extends EventEmitter {
    pid = process.pid;
    async start() {}
    async dispose() {}
    async request(command: { type: string }) {
      if (command.type === 'prompt') { streaming = true; await writeFile(sessionFile, '{"type":"session"}\n'); }
      if (command.type === 'get_messages') {
        calls++;
        if (calls === 1) { readStarted.resolve(); await firstRead.promise; }
        return { success: true, data: { messages: calls === 1 ? [user, failed] : [user, final] } };
      }
      return { success: true, data: command.type === 'get_entries' ? { entries: [], leafId: null }
        : command.type === 'get_state' ? { sessionId: id, sessionFile, isStreaming: streaming, pendingMessageCount: 0 } : {} };
    }
  }
  const client = new DelayedClient();
  const supervisor = new PiSessionSupervisor({ piEntry: join(root, 'unused'),
    env: { PI_CODING_AGENT_SESSION_DIR: root }, clientFactory: options => {
    sessionFile = options.args[options.args.indexOf('--session') + 1]!;
    return client as unknown as PiRpcClient;
  } });
  const service = new PiNativeV4Service(supervisor, join(root, 'catalog'));
  const target = { workspacePath: root };
  try {
    await service.sendConversationCommandV4({ ...target, envelope: {
      commandId: randomUUID(), clientId: 'ordered', sessionId: null, type: 'createSession',
      issuedAt: Date.now(), payload: { workspaceId: root },
    } });
    const commandId = randomUUID();
    await service.sendConversationCommandV4({ ...target, envelope: {
      commandId, clientId: 'ordered', sessionId: id, type: 'sendText', issuedAt: Date.now(),
      payload: { text: 'input' },
    } });
    const emit = (type: string, extra: Record<string, unknown> = {}) => client.emit('record', { type, ...extra });
    emit('message_start', { message: user }); emit('message_end', { message: user });
    emit('message_start', { message: failed }); emit('message_end', { message: failed });
    streaming = false;
    emit('agent_settled');
    await readStarted.promise;
    emit('extension_ui_request', { method: 'notify', id: randomUUID(), message: 'post-settled' });
    firstRead.resolve();
    for (let attempt = 0; attempt < 50 && calls < 2; attempt++) await new Promise(resolve => setTimeout(resolve, 10));
    await (service as unknown as { reconciliations: Map<string, Promise<void>> }).reconciliations.get(id);
    const rows = await service.conversationRowsRangeV4({ ...target, sessionId: id, limit: 100 });
    const assistant = rows.rows.find(row => row.kind === 'assistantText');
    assert.equal(assistant?.kind === 'assistantText' ? assistant.text : '', 'authoritative');
    assert.equal(rows.rows.find(row => row.kind === 'userInput')?.sourceCommandId, commandId);
    assert.equal(calls, 2);
  } finally { firstRead.resolve(); await service.dispose(); await rm(root, { recursive: true, force: true }); }
});

test('Pi queue/retry facts and settled authoritative messages replace failed retry rows without losing command anchor', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-reconcile-'));
  const sessionId = randomUUID();
  let sessionFile = '';
  const user = { role: 'user', timestamp: 1000, content: 'hello' };
  const failed = { role: 'assistant', timestamp: 1001, content: [{ type: 'text', text: 'temporary failure' }], stopReason: 'error' };
  const final = { role: 'assistant', timestamp: 1002, content: [{ type: 'text', text: 'recovered' }], stopReason: 'stop' };
  class Client extends EventEmitter {
    pid = process.pid;
    streaming = false;
    async start() {}
    async dispose() {}
    async request(command: { type: string }) {
      if (command.type === 'prompt') { this.streaming = true; await writeFile(sessionFile, '{"type":"session"}\n'); }
      return { success: true, data: command.type === 'get_state'
        ? { sessionId, sessionFile, isStreaming: this.streaming, isCompacting: false, pendingMessageCount: 0 }
        : command.type === 'get_entries' ? { entries: [], leafId: null }
        : command.type === 'get_messages' ? { messages: [user, final] } : {} };
    }
  }
  const client = new Client();
  const supervisor = new PiSessionSupervisor({ piEntry: join(root, 'unused'),
    env: { PI_CODING_AGENT_SESSION_DIR: root }, clientFactory: options => {
    sessionFile = options.args[options.args.indexOf('--session') + 1]!;
    return client as unknown as PiRpcClient;
  } });
  const service = new PiNativeV4Service(supervisor, join(root, 'catalog'));
  const target = { workspacePath: root };
  try {
    const create = await service.sendConversationCommandV4({ ...target, envelope: {
      commandId: randomUUID(), clientId: 'reconcile', sessionId: null, type: 'createSession',
      issuedAt: Date.now(), payload: { workspaceId: root },
    } });
    assert.equal(create.status, 'accepted');
    const commandId = randomUUID();
    const send = await service.sendConversationCommandV4({ ...target, envelope: {
      commandId, clientId: 'reconcile', sessionId, type: 'sendText', issuedAt: Date.now(), payload: { text: 'hello' },
    } });
    assert.equal(send.status, 'accepted');
    const emit = (type: string, extra: Record<string, unknown> = {}) => client.emit('record', { type, ...extra });
    emit('message_start', { message: user }); emit('message_end', { message: user });
    emit('message_start', { message: failed }); emit('message_end', { message: failed });
    emit('auto_retry_start', { attempt: 1, maxAttempts: 2, delayMs: 1500 });
    emit('queue_update', { steering: ['redirect'], followUp: ['later'] });
    await tick();
    let record = (service as unknown as { sessions: Map<string, { snapshot: { control: { apiRetry: unknown }; queue: { items: { text: string }[] } } }> }).sessions.get(sessionId)!;
    assert.equal((record.snapshot.control.apiRetry as { attempt: number }).attempt, 1);
    assert.deepEqual(record.snapshot.queue.items.map(item => item.text), ['redirect', 'later']);
    emit('auto_retry_end', { success: true, attempt: 1 });
    emit('compaction_start', { reason: 'overflow' });
    emit('compaction_end', { reason: 'overflow', result: {}, willRetry: true, aborted: false });
    client.streaming = false;
    emit('agent_settled');
    await tick(); await tick();
    await (service as unknown as { reconciliations: Map<string, Promise<void>> }).reconciliations.get(sessionId);
    const live = await service.conversationRowsRangeV4({ ...target, sessionId, limit: 100 });
    const assistant = live.rows.find(row => row.kind === 'assistantText');
    assert.equal(assistant?.kind === 'assistantText' ? assistant.text : '', 'recovered');
    assert.equal(live.rows.find(row => row.kind === 'userInput')?.sourceCommandId, commandId);
    record = (service as unknown as { sessions: Map<string, { snapshot: { control: { apiRetry: unknown }; queue: { items: { text: string }[] } } }> }).sessions.get(sessionId)!;
    assert.equal(record.snapshot.control.apiRetry, null);
  } finally { await service.dispose(); await rm(root, { recursive: true, force: true }); }
});
