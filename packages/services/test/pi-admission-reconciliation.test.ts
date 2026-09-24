import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { PiRpcClient, PiRpcError } from '../src/pi-agent/pi-rpc-client.js';
import { PiSessionSupervisor } from '../src/pi-agent/pi-session-supervisor.js';
import { PiNativeV4Service } from '../src/pi-agent/pi-native-v4-service.js';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'pi-admission-'));
  let id = '';
  class ControlledPi extends EventEmitter {
    readonly pid = process.pid;
    prompts = 0;
    streaming = false;
    readonly calls: string[] = [];
    postAdmissionError: Error | undefined;
    noRun = false;
    queued = { steering: [] as string[], followUp: [] as string[] };
    readonly messages: Record<string, unknown>[] = [];
    model: { provider: string; id: string; reasoning: boolean } | undefined;
    thinkingLevel = 'off';
    async start() {}
    async dispose() {}
    async request(command: { type: string; message?: string; provider?: string; modelId?: string; level?: string }) {
      this.calls.push(command.type);
      if (command.type === 'set_model') this.model = { provider: command.provider!, id: command.modelId!, reasoning: false };
      if (command.type === 'set_thinking_level') this.thinkingLevel = command.level!;
      if (command.type === 'abort') this.streaming = false;
      if (command.type === 'clear_queue') {
        const cleared = this.queued;
        this.queued = { steering: [], followUp: [] };
        this.emit('record', { type: 'queue_update', ...this.queued });
        return { success: true, data: cleared };
      }
      if (command.type === 'prompt') {
        await writeFile(join(root, 'session.jsonl'), '{}\n');
        this.prompts++;
        this.streaming = !this.noRun;
        if (!this.noRun) {
          const message = { role: 'user', content: [{ type: 'text', text: command.message }], timestamp: Date.now() };
          this.messages.push(message);
          this.emit('record', { type: 'message_start', message });
          this.emit('record', { type: 'message_end', message });
        }
      }
      if (command.type === 'get_state' && this.prompts && this.postAdmissionError) throw this.postAdmissionError;
      return { success: true, data: command.type === 'get_state'
        ? { sessionId: id, sessionFile: join(root, 'session.jsonl'), messageCount: this.prompts,
          model: this.model, thinkingLevel: this.thinkingLevel,
          isStreaming: this.streaming, isCompacting: false, pendingMessageCount: 0 }
        : command.type === 'get_entries' ? { entries: [], leafId: null }
        : command.type === 'get_messages' ? { messages: this.messages } : {} };
    }
  }
  const client = new ControlledPi();
  const supervisor = new PiSessionSupervisor({ piEntry: join(root, 'unused.js'), clientFactory: options => {
    id = options.args[options.args.indexOf('--session-id') + 1]!;
    return client as unknown as PiRpcClient;
  } });
  const service = new PiNativeV4Service(supervisor, join(root, 'catalog'));
  return { root, client, supervisor, service, target: { workspacePath: root },
    id: () => id, close: async () => { await service.dispose(); await rm(root, { recursive: true, force: true }); } };
}

for (const firstInput of [true, false]) {
  for (const error of [new Error('bad state payload'), new PiRpcError('TIMEOUT', 'get_state timeout', 'unknown')]) {
    test(`${firstInput ? 'create first input' : 'sendText'} stays accepted when later inspection fails: ${error.message}`, async () => {
      const f = await fixture();
      const commandId = randomUUID();
      const create = { commandId: firstInput ? commandId : randomUUID(), clientId: 'admission-test',
        sessionId: null, type: 'createSession' as const, issuedAt: Date.now(),
        payload: { workspaceId: f.root, ...(firstInput ? { firstInput: { text: 'execute once' } } : {}) } };
      try {
        f.client.postAdmissionError = error;
        const created = await f.service.sendConversationCommandV4({ ...f.target, envelope: create });
        assert.equal(created.status, 'accepted', created.message);
        const envelope = firstInput ? create : { commandId, clientId: 'admission-test', sessionId: f.id(),
          type: 'sendText' as const, issuedAt: Date.now(), payload: { text: 'execute once' } };
        const ack = firstInput ? created : await f.service.sendConversationCommandV4({ ...f.target, envelope });
        assert.equal(ack.status, 'accepted', ack.message);
        assert.equal(f.client.prompts, 1);
        const duplicate = await f.service.sendConversationCommandV4({ ...f.target, envelope });
        assert.equal(duplicate.status, 'duplicate');
        assert.equal(f.client.prompts, 1, 'Acknowledged input must never be replayed');
        assert.equal(f.supervisor.getSession(f.id())?.uncertainDelivery, false,
          'Unknown delivery of a read-only query is not unknown delivery of the already accepted prompt');
        assert.match(f.supervisor.getSession(f.id())?.error ?? '', /accepted.*state/i);
        await assert.rejects(f.supervisor.sendText(f.id(), 'try again'), /reconcil/i);
        assert.equal(f.client.prompts, 1);
      } finally { await f.close(); }
    });
  }
}

test('native draft prewarm config mirrors are accepted, but real execution changes still fail closed', async () => {
  const f = await fixture();
  const selection = { providerId: 'new-provider', modelId: 'pi-native-test',
    options: { reasoningLevel: 'enabled' } };
  const config = { mode: 'build', planEnabled: false, followupMode: 'queue',
    modelSelection: selection, provider: 'new-provider', model: 'pi-native-test', thought: 'enabled' };
  const create = (extras: Record<string, unknown>, id = randomUUID()) =>
    f.service.sendConversationCommandV4({ ...f.target, envelope: {
      commandId: id, clientId: 'native-draft', sessionId: null, type: 'createSession',
      issuedAt: Date.now(), payload: { workspaceId: f.root, ...extras },
    } });
  try {
    for (const changed of [
      { ...config, planEnabled: true }, { ...config, mode: 'yolo' },
      { ...config, followupMode: 'guide' }, { ...config, provider: 'different-provider' },
      { ...config, model: 'different-model' }, { ...config, thought: 'different-level' },
    ]) {
      const rejected = await create({ config: changed });
      assert.equal(rejected.status, 'failed');
      assert.equal(rejected.reasonCode, 'pi.commandNotImplemented');
    }
    assert.equal(f.client.calls.length, 0, 'unsupported changes must not start Pi');
    const prewarmed = await create({ config });
    assert.equal(prewarmed.status, 'accepted', prewarmed.message);
    assert.equal(f.client.calls.filter(call => call === 'set_model').length, 1,
      'draft model selection must reach Pi before the first input');
    assert.equal(f.client.prompts, 0);
  } finally { await f.close(); }
});

test('unsupported permissions and execution constraints fail before any Pi side effect', async () => {
  const f = await fixture();
  const create = (commandId: string, extras: Record<string, unknown>) =>
    f.service.sendConversationCommandV4({ ...f.target, envelope: {
      commandId, clientId: 'constraints', sessionId: null, type: 'createSession',
      issuedAt: Date.now(), payload: { workspaceId: f.root, ...extras },
    } });
  try {
    for (const extras of [
      { config: { mode: 'yolo' } }, { config: { mode: 'plan' } },
      { config: { model: 'unsupported' } }, { firstInput: { text: 'do not execute', planEnabled: true } },
      { firstInput: { text: 'do not execute', mode: 'edit' } },
      { mcpServers: [{ name: 'unavailable', command: 'never-run', args: [], env: [] }] },
    ]) {
      const ack = await create(randomUUID(), extras);
      assert.equal(ack.status, 'failed', JSON.stringify(extras));
      assert.equal(ack.reasonCode, 'pi.commandNotImplemented');
    }
    assert.equal(f.client.calls.length, 0, 'rejected create must not even start Pi');
    assert.equal((await create(randomUUID(), {})).status, 'accepted');
    for (const extras of [
      { mode: 'yolo' }, { mode: 'plan' }, { planEnabled: true },
      { browserAmbientContext: { tabCount: 1, currentUrl: 'https://example.com' } },
      { toolDisallowlist: ['bash'] }, { requestedDelivery: 'queue' },
    ]) {
      const ack = await f.service.sendConversationCommandV4({ ...f.target, envelope: {
        commandId: randomUUID(), clientId: 'constraints', sessionId: f.id(), type: 'sendText',
        issuedAt: Date.now(), payload: { text: 'do not execute', ...extras },
      } });
      assert.equal(ack.status, 'failed', JSON.stringify(extras));
      assert.equal(ack.reasonCode, 'pi.commandNotImplemented');
    }
    assert.equal(f.client.prompts, 0);
  } finally { await f.close(); }
});

test('late Stop neither rewrites a settled turn nor cancels a newer run', async () => {
  const f = await fixture();
  try {
    await f.service.sendConversationCommandV4({ ...f.target, envelope: {
      commandId: randomUUID(), clientId: 'stop-test', sessionId: null, type: 'createSession',
      issuedAt: Date.now(), payload: { workspaceId: f.root },
    } });
    const send = () => f.service.sendConversationCommandV4({ ...f.target, envelope: {
      commandId: randomUUID(), clientId: 'stop-test', sessionId: f.id(), type: 'sendText',
      issuedAt: Date.now(), payload: { text: 'run' },
    } });
    const stop = (expectedForegroundExecutionId?: string) => f.service.sendConversationCommandV4({ ...f.target, envelope: {
      commandId: randomUUID(), clientId: 'stop-test', sessionId: f.id(), type: 'stop',
      issuedAt: Date.now(), payload: { expectedForegroundExecutionId },
    } });
    assert.equal((await send()).status, 'accepted');
    const first = f.supervisor.getSession(f.id())?.foregroundExecutionId;
    assert.ok(first);
    f.client.streaming = false;
    f.client.emit('record', { type: 'agent_settled' });
    const before = await f.service.conversationRowsRangeV4({ ...f.target, sessionId: f.id(), limit: 100 });
    assert.equal((await stop(first)).status, 'noop');
    assert.equal(f.supervisor.getSession(f.id())?.phase, 'settled');
    const after = await f.service.conversationRowsRangeV4({ ...f.target, sessionId: f.id(), limit: 100 });
    assert.deepEqual(after.rows, before.rows, 'Late Stop must not mark a successful turn interrupted');
    assert.equal((await send()).status, 'accepted');
    const second = f.supervisor.getSession(f.id())?.foregroundExecutionId;
    assert.ok(second && second !== first);
    assert.equal((await stop(first)).status, 'stale');
    assert.equal((await stop()).status, 'stale', 'An unfenced Stop must not target an arbitrary new run');
    assert.equal(f.client.calls.filter(type => ['abort', 'clear_queue'].includes(type)).length, 0);
    assert.equal(f.supervisor.getSession(f.id())?.foregroundExecutionId, second);
    assert.equal((await stop(second)).status, 'accepted');
    assert.equal(f.client.calls.filter(type => type === 'abort').length, 1);
    assert.equal(f.supervisor.getSession(f.id())?.phase, 'stopped');
    assert.equal(f.supervisor.getSession(f.id())?.foregroundExecutionId, undefined);
  } finally { await f.close(); }
});

test('Stop retains Pi clear_queue handback without claiming queued work will auto-run', async () => {
  const f = await fixture();
  try {
    await f.service.sendConversationCommandV4({ ...f.target, envelope: {
      commandId: randomUUID(), clientId: 'queue-stop', sessionId: null, type: 'createSession',
      issuedAt: Date.now(), payload: { workspaceId: f.root },
    } });
    await f.service.sendConversationCommandV4({ ...f.target, envelope: {
      commandId: randomUUID(), clientId: 'queue-stop', sessionId: f.id(), type: 'sendText',
      issuedAt: Date.now(), payload: { text: 'working' },
    } });
    const execution = f.supervisor.getSession(f.id())?.foregroundExecutionId;
    f.client.queued = { steering: ['change direction'], followUp: ['later'] };
    f.client.emit('record', { type: 'queue_update', ...f.client.queued });
    assert.equal((await f.service.sendConversationCommandV4({ ...f.target, envelope: {
      commandId: randomUUID(), clientId: 'queue-stop', sessionId: f.id(), type: 'stop',
      issuedAt: Date.now(), payload: { expectedForegroundExecutionId: execution },
    } })).status, 'accepted');
    const session = (f.service as unknown as { sessions: Map<string, { snapshot: { queue: {
      items: { text: string }[]; autoDrain: boolean; pauseReason?: string } } }> }).sessions.get(f.id());
    assert.deepEqual(session?.snapshot.queue.items.map(item => item.text), ['change direction', 'later']);
    assert.equal(session?.snapshot.queue.autoDrain, false);
    assert.equal(session?.snapshot.queue.pauseReason, 'stopped');
  } finally { await f.close(); }
});

test('a verified no-run command cannot steal the next actual user message correlation', async () => {
  const f = await fixture();
  try {
    await f.service.sendConversationCommandV4({ ...f.target, envelope: {
      commandId: randomUUID(), clientId: 'no-run', sessionId: null, type: 'createSession',
      issuedAt: Date.now(), payload: { workspaceId: f.root },
    } });
    const send = (commandId: string, text: string) => f.service.sendConversationCommandV4({ ...f.target, envelope: {
      commandId, clientId: 'no-run', sessionId: f.id(), type: 'sendText', issuedAt: Date.now(), payload: { text },
    } });
    f.client.noRun = true;
    assert.equal((await send('no-run-command', '/handled')).status, 'accepted');
    f.client.noRun = false;
    assert.equal((await send('real-user-command', 'hello')).status, 'accepted');
    const result = await f.service.conversationRowsRangeV4({ ...f.target, sessionId: f.id(), limit: 100 });
    const rows = result.rows.filter(row => row.kind === 'userInput');
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.sourceCommandId, 'real-user-command');
  } finally { await f.close(); }
});
