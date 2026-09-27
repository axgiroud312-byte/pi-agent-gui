import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { conversationTopicWireFrameSchema, workspaceConfigTopicWireFrameSchema } from '@zcode/shared/zcode-protocol-v4';
import { PiRpcClient, PiRpcError } from '../src/pi-agent/pi-rpc-client.js';
import { PiSessionSupervisor } from '../src/pi-agent/pi-session-supervisor.js';
import { PiNativeV4Service } from '../src/pi-agent/pi-native-v4-service.js';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'pi-admission-'));
  const id = randomUUID();
  let sessionFile = '';
  class ControlledPi extends EventEmitter {
    readonly pid = process.pid;
    prompts = 0;
    streaming = false;
    readonly calls: string[] = [];
    readonly notifications: Array<Record<string, unknown>> = [];
    modelGate?: Promise<void>;
    modelRequested?: () => void;
    commandsGate?: Promise<void>;
    commandsRequested?: () => void;
    postAdmissionError: Error | undefined;
    noRun = false;
    extensionCommand = false;
    extensionError = false;
    queued = { steering: [] as string[], followUp: [] as string[] };
    queueRevision = 0;
    queuePaused = false;
    readonly messages: Record<string, unknown>[] = [];
    model: { provider: string; id: string; reasoning: boolean } | undefined;
    thinkingLevel = 'off';
    async start() {}
    async dispose() {}
    async notify(command: Record<string, unknown>) { this.notifications.push(command); }
    async request(command: { type: string; message?: string; provider?: string; modelId?: string; level?: string;
      expectedRevision?: number; paused?: boolean }) {
      this.calls.push(command.type);
      const queueCatalog = () => ({ revision: this.queueRevision, paused: this.queuePaused,
        steering: this.queued.steering.map((text, index) => ({ id: `steer-${index}`, text, images: [] })),
        followUp: this.queued.followUp.map((text, index) => ({ id: `follow-${index}`, text, images: [] })) });
      if (command.type === 'pi_gui_queue_capabilities_v1') return { success: true, data: {
        protocol: 'pi-gui-queue/1', codingAgent: '0.87.0', agentCore: '0.87.1',
        stableItemIds: true, atomicRevision: true, images: true,
      } };
      if (command.type === 'pi_gui_queue_catalog_v1') return { success: true, data: queueCatalog() };
      if (command.type === 'pi_gui_queue_set_paused_v1') {
        if (command.expectedRevision !== this.queueRevision) return { success: false, error: 'revision changed' };
        this.queuePaused = command.paused === true;
        this.queueRevision++;
        this.emit('record', { type: 'pi_gui_queue_update_v1', ...queueCatalog() });
        return { success: true, data: queueCatalog() };
      }
      if (command.type === 'steer' || command.type === 'follow_up') {
        const lane = command.type === 'steer' ? this.queued.steering : this.queued.followUp;
        lane.push(command.message ?? '');
        this.queueRevision++;
        this.emit('record', { type: 'pi_gui_queue_update_v1', ...queueCatalog() });
        return { success: true, data: { queueItemId: command.type === 'steer'
          ? `steer-${lane.length - 1}` : `follow-${lane.length - 1}` } };
      }
      if (command.type === 'set_model') {
        this.modelRequested?.();
        await this.modelGate;
        this.model = { provider: command.provider!, id: command.modelId!, reasoning: false };
      }
      if (command.type === 'set_thinking_level') this.thinkingLevel = command.level!;
      if (command.type === 'get_commands') {
        this.commandsRequested?.();
        await this.commandsGate;
      }
      if (command.type === 'abort') this.streaming = false;
      if (command.type === 'clear_queue') {
        const cleared = this.queued;
        this.queued = { steering: [], followUp: [] };
        this.emit('record', { type: 'queue_update', ...this.queued });
        return { success: true, data: cleared };
      }
      if (command.type === 'prompt') {
        await writeFile(sessionFile, '{}\n');
        this.prompts++;
        this.streaming = !this.noRun;
        if (this.extensionError) this.emit('record', { type: 'extension_error', error: 'command handler failed' });
        if (!this.noRun) {
          const message = { role: 'user', content: [{ type: 'text', text: command.message }], timestamp: Date.now() };
          this.messages.push(message);
          this.emit('record', { type: 'message_start', message });
          this.emit('record', { type: 'message_end', message });
        }
      }
      if (command.type === 'get_state' && this.prompts && this.postAdmissionError) throw this.postAdmissionError;
      return { success: true, data: command.type === 'get_state'
        ? { sessionId: id, sessionFile, messageCount: this.prompts,
          model: this.model, thinkingLevel: this.thinkingLevel,
          isStreaming: this.streaming, isCompacting: false,
          pendingMessageCount: this.queued.steering.length + this.queued.followUp.length }
        : command.type === 'get_entries' ? { entries: [], leafId: null }
        : command.type === 'get_messages' ? { messages: this.messages }
        : command.type === 'get_available_thinking_levels' ? { levels: ['off', 'medium'] }
        : command.type === 'get_session_stats' ? { tokens: { input: 1, output: 2 }, contextUsage: { tokens: 3, contextWindow: 100 } }
        : command.type === 'get_available_models' ? { models: [{ provider: 'test', id: 'model', name: 'Test Model', input: ['text', 'image'] }] }
        : command.type === 'get_commands' ? { commands: [
          { name: 'skill-command', description: 'A Pi resource command', source: 'skill' },
          ...(this.extensionCommand ? [{ name: 'handled', description: 'A no-model Pi extension command',
            source: 'extension' }] : []),
        ] }
        : {} };
    }
  }
  const client = new ControlledPi();
  const supervisor = new PiSessionSupervisor({ piEntry: join(root, 'unused.js'),
    env: { PI_CODING_AGENT_SESSION_DIR: root }, clientFactory: options => {
    sessionFile = options.args[options.args.indexOf('--session') + 1]!;
    return client as unknown as PiRpcClient;
  } });
  const catalogDir = join(root, 'catalog');
  const service = new PiNativeV4Service(supervisor, catalogDir);
  return { root, client, supervisor, service, target: { workspacePath: root },
    catalogDir, id: () => id,
    close: async () => { await service.dispose(); await rm(root, { recursive: true, force: true }); } };
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
      { toolDisallowlist: ['bash'] },
    ]) {
      const ack = await f.service.sendConversationCommandV4({ ...f.target, envelope: {
        commandId: randomUUID(), clientId: 'constraints', sessionId: f.id(), type: 'sendText',
        issuedAt: Date.now(), payload: { text: 'do not execute', ...extras },
      } });
      assert.equal(ack.status, 'failed', JSON.stringify(extras));
      assert.equal(ack.reasonCode, 'pi.commandNotImplemented');
    }
    for (const requestedDelivery of ['queue', 'guide'] as const) {
      const ack = await f.service.sendConversationCommandV4({ ...f.target, envelope: {
        commandId: randomUUID(), clientId: 'constraints', sessionId: f.id(), type: 'sendText',
        issuedAt: Date.now(), payload: { text: `accepted ${requestedDelivery}`, requestedDelivery },
      } });
      assert.equal(ack.status, 'accepted');
      assert.equal(ack.result?.type, 'inputAccepted');
      assert.equal(ack.result?.type === 'inputAccepted' ? ack.result.delivery : null, requestedDelivery);
    }
    assert.equal(f.client.prompts, 0);
    assert.ok(f.client.calls.indexOf('follow_up') >= 0 && f.client.calls.indexOf('steer') >= 0);
  } finally { await f.close(); }
});

test('workspace config projects Pi model and resource command catalogs', async () => {
  const f = await fixture();
  const frames: unknown[] = [];
  const listener = f.service.onDynamicWorkspaceConfigFrame(f.target)(frame => frames.push(frame));
  try {
    await f.service.sendConversationCommandV4({ ...f.target, envelope: {
      commandId: randomUUID(), clientId: 'catalog', sessionId: null, type: 'createSession',
      issuedAt: Date.now(), payload: { workspaceId: f.root },
    } });
    const subscription = await f.service.subscribeWorkspaceConfigV4(f.target);
    await new Promise(resolve => setImmediate(resolve));
    const wire = workspaceConfigTopicWireFrameSchema.parse(frames.at(-1));
    assert.equal(wire.kind, 'complete');
    if (wire.kind !== 'complete' || wire.frame.payload.kind !== 'snapshot') throw Error('missing config snapshot');
    assert.equal(wire.frame.payload.snapshot.config.configOptions[0]?.category, 'pi-model');
    assert.equal(wire.frame.payload.snapshot.config.configOptions[0]?.options?.[0]?.value, 'test/model');
    assert.equal(wire.frame.payload.snapshot.config.slashCommands[0]?.name, 'skill-command');
    await f.service.unsubscribeWorkspaceConfigV4({ ...f.target, subscriptionId: subscription.ack.subscriptionId });
  } finally { listener.dispose(); await f.close(); }
});

test('blocking extension UI is projected for the native dialog and explicitly resolved back to Pi', async () => {
  const f = await fixture();
  try {
    await f.service.sendConversationCommandV4({ ...f.target, envelope: {
      commandId: randomUUID(), clientId: 'extension-ui', sessionId: null, type: 'createSession',
      issuedAt: Date.now(), payload: { workspaceId: f.root },
    } });
    f.client.emit('record', { type: 'extension_ui_request', id: 'ext-confirm-1', method: 'confirm',
      title: 'Allow the extension action?' });
    const frames: unknown[] = [];
    const listener = f.service.onDynamicConversationFrame(f.target)(frame => frames.push(frame));
    const subscription = await f.service.subscribeConversationV4({ ...f.target, sessionId: f.id() });
    await new Promise(resolve => setImmediate(resolve));
    const initial = conversationTopicWireFrameSchema.parse(frames.at(-1));
    assert.equal(initial.kind, 'complete');
    if (initial.kind !== 'complete' || initial.frame.payload.kind !== 'snapshot') throw Error('missing snapshot');
    assert.equal(initial.frame.payload.snapshot.pendingInteractions[0]?.interactionId, 'ext-confirm-1');
    assert.equal(initial.frame.payload.snapshot.pendingInteractions[0]?.payload.kind, 'userInput');
    const ack = await f.service.sendConversationCommandV4({ ...f.target, envelope: {
      commandId: randomUUID(), clientId: 'extension-ui', sessionId: f.id(), type: 'resolveInteraction',
      issuedAt: Date.now(), payload: { interactionId: 'ext-confirm-1', answer: { optionId: 'false', action: 'decline' } },
    } });
    assert.equal(ack.status, 'accepted');
    assert.deepEqual(f.client.notifications.at(-1),
      { type: 'extension_ui_response', id: 'ext-confirm-1', confirmed: false });
    const resolvedSubscription = await f.service.subscribeConversationV4({ ...f.target, sessionId: f.id() });
    await new Promise(resolve => setImmediate(resolve));
    const resolvedFrame = conversationTopicWireFrameSchema.parse(frames.at(-1));
    assert.equal(resolvedFrame.kind, 'complete');
    if (resolvedFrame.kind !== 'complete' || resolvedFrame.frame.payload.kind !== 'snapshot') throw Error('missing resolved snapshot');
    assert.equal(resolvedFrame.frame.payload.snapshot.pendingInteractions.length, 0);
    await f.service.unsubscribeConversationV4({ ...f.target, subscriptionId: resolvedSubscription.ack.subscriptionId });
    await f.service.unsubscribeConversationV4({ ...f.target, subscriptionId: subscription.ack.subscriptionId });
    listener.dispose();
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
    const assistant = { role: 'assistant', content: [{ type: 'text', text: 'done' }],
      stopReason: 'stop', timestamp: Date.now() };
    f.client.messages.push(assistant);
    f.client.emit('record', { type: 'message_start', message: assistant });
    f.client.emit('record', { type: 'message_end', message: assistant });
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

test('Stop pauses the Pi-owned queue without claiming queued work will auto-run', async () => {
  const f = await fixture();
  let resumed: PiNativeV4Service | undefined;
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
    const assistant = { role: 'assistant', content: [{ type: 'text', text: 'aborted' }],
      stopReason: 'aborted', timestamp: Date.now() };
    f.client.messages.push(assistant);
    f.client.emit('record', { type: 'message_start', message: assistant });
    f.client.emit('record', { type: 'message_end', message: assistant });
    f.client.emit('record', { type: 'agent_settled' });
    await (f.service as unknown as { reconciliations: Map<string, Promise<void>> }).reconciliations.get(f.id());
    assert.equal((await f.service.sendConversationCommandV4({ ...f.target, envelope: {
      commandId: randomUUID(), clientId: 'queue-stop', sessionId: f.id(), type: 'sendText',
      issuedAt: Date.now(), payload: { text: 'new foreground work' },
    } })).status, 'accepted');
    assert.equal(session?.snapshot.queue.autoDrain, false,
      'a new foreground input must not silently enqueue or auto-run returned work');
    assert.deepEqual(session?.snapshot.queue.items.map(item => item.text), ['change direction', 'later']);
    const beforeRestart = JSON.parse(await readFile(join(f.catalogDir, `${f.id()}.json`), 'utf8')) as {
      queueRecovery?: Array<{ text: string }>;
    };
    assert.deepEqual(beforeRestart.queueRecovery?.map(item => item.text), ['change direction', 'later']);
    await f.service.dispose();
    const restartedSupervisor = new PiSessionSupervisor({ piEntry: join(f.root, 'unused.js'),
      env: { PI_CODING_AGENT_SESSION_DIR: f.root },
      clientFactory: () => f.client as unknown as PiRpcClient });
    resumed = new PiNativeV4Service(restartedSupervisor, f.catalogDir);
    await resumed.subscribeConversationV4({ ...f.target, sessionId: f.id() });
    const restored = (resumed as unknown as { sessions: Map<string, { snapshot: { queue: {
      items: { text: string }[]; autoDrain: boolean; pauseReason?: string } } }> }).sessions.get(f.id());
    assert.deepEqual(restored?.snapshot.queue.items.map(item => item.text), [],
      'a new Pi process has an empty queue; recovery copies must never masquerade as live Pi work');
    const interrupted = (resumed as unknown as { sessions: Map<string, {
      state: { piInterruptedQueueRecovery: Array<{ text: string }> };
    }> }).sessions.get(f.id());
    assert.deepEqual(interrupted?.state.piInterruptedQueueRecovery.map(item => item.text),
      ['change direction', 'later']);
    assert.equal(f.client.prompts, 2, 'reopening must not replay either returned queue item');
  } finally { await resumed?.dispose(); await f.close(); }
});

test('a no-run extension command stays blocked without proof of delivery', async () => {
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
    const next = await send('real-user-command', 'hello');
    assert.equal(next.reasonCode, 'pi.deliveryUnknown');
    const result = await f.service.conversationRowsRangeV4({ ...f.target, sessionId: f.id(), limit: 100 });
    const rows = result.rows.filter(row => row.kind === 'userInput');
    assert.equal(rows.length, 0);
    assert.equal(f.client.prompts, 1);
  } finally { await f.close(); }
});

test('an acknowledged Pi extension command without an agent turn leaves its session usable', async () => {
  const f = await fixture();
  try {
    await f.service.sendConversationCommandV4({ ...f.target, envelope: {
      commandId: randomUUID(), clientId: 'known-extension', sessionId: null, type: 'createSession',
      issuedAt: Date.now(), payload: { workspaceId: f.root },
    } });
    f.client.extensionCommand = true;
    f.client.noRun = true;
    const handled = await f.service.sendConversationCommandV4({ ...f.target, envelope: {
      commandId: randomUUID(), clientId: 'known-extension', sessionId: f.id(), type: 'sendText',
      issuedAt: Date.now(), payload: { text: '/handled' },
    } });
    assert.equal(handled.status, 'accepted');
    assert.equal(f.supervisor.getSession(f.id())?.reconciliationRequired ?? false, false,
      'Pi acknowledged completion of its registered extension command');
    assert.equal(f.supervisor.getSession(f.id())?.phase, 'settled');
    assert.equal((await f.service.getPiSessionSummary({ ...f.target, sessionId: f.id() })).phase,
      'completedSuccess', 'native projection must clear its provisional incomplete turn after Pi handles the command');
    f.client.noRun = false;
    const next = await f.service.sendConversationCommandV4({ ...f.target, envelope: {
      commandId: randomUUID(), clientId: 'known-extension', sessionId: f.id(), type: 'sendText',
      issuedAt: Date.now(), payload: { text: 'next real model turn' },
    } });
    assert.equal(next.status, 'accepted', next.reasonCode);
    assert.equal(f.client.prompts, 2, 'the extension command and next model input enter Pi exactly once each');
  } finally { await f.close(); }
});

test('a registered Pi extension command rejects prompt images before Pi delivery', async () => {
  const f = await fixture();
  try {
    await f.supervisor.createSession(f.root);
    f.client.extensionCommand = true;
    await assert.rejects(f.supervisor.sendText(f.id(), '/handled', [
      { type: 'image', mimeType: 'image/png', data: 'iVBORw0KGgo=' },
    ]), /do not consume prompt images/);
    assert.equal(f.client.prompts, 0, 'Pi must never silently discard an image attached to an extension command');
  } finally { await f.close(); }
});

test('a failed registered Pi extension command preserves its real error and permits a later input', async () => {
  const f = await fixture();
  try {
    await f.supervisor.createSession(f.root);
    f.client.extensionCommand = true;
    f.client.extensionError = true;
    f.client.noRun = true;
    assert.equal(await f.supervisor.sendText(f.id(), '/handled'), 'handledCommand');
    assert.equal(f.supervisor.getSession(f.id())?.phase, 'error');
    assert.equal(f.supervisor.getSession(f.id())?.error, 'command handler failed');
    assert.equal(f.supervisor.getSession(f.id())?.reconciliationRequired ?? false, false);
    f.client.extensionError = false;
    f.client.noRun = false;
    assert.equal(await f.supervisor.sendText(f.id(), 'next input'), 'run');
    assert.equal(f.client.prompts, 2);
  } finally { await f.close(); }
});

test('Stop during Pi command-catalog lookup prevents late slash delivery', async () => {
  const f = await fixture();
  try {
    await f.supervisor.createSession(f.root);
    f.client.extensionCommand = true;
    const requested = Promise.withResolvers<void>();
    const gate = Promise.withResolvers<void>();
    f.client.commandsRequested = requested.resolve;
    f.client.commandsGate = gate.promise;
    const send = f.supervisor.sendText(f.id(), '/handled');
    void send.catch(() => {});
    await requested.promise;
    await assert.rejects(f.supervisor.sendText(f.id(), 'another input'), /already busy/);
    const executionId = f.supervisor.getSession(f.id())?.foregroundExecutionId;
    assert.ok(executionId);
    assert.equal(await f.supervisor.stop(f.id(), executionId), 'stopped');
    gate.resolve();
    await assert.rejects(send, /stopped before delivery/);
    assert.equal(f.client.prompts, 0);
    assert.equal(f.supervisor.getSession(f.id())?.phase, 'stopped');
  } finally { await f.close(); }
});

test('same-session admissions serialize model selection and retain the winning command intent', async () => {
  const f = await fixture();
  const gate = Promise.withResolvers<void>();
  const modelRequested = Promise.withResolvers<void>();
  const send = (commandId: string, modelId: string) => f.service.sendConversationCommandV4({
    ...f.target, envelope: { commandId, clientId: 'serial-admission', sessionId: f.id(),
      type: 'sendText', issuedAt: Date.now(), payload: { text: commandId,
        modelSelection: { providerId: 'local', modelId } } },
  });
  try {
    assert.equal((await f.service.sendConversationCommandV4({ ...f.target, envelope: {
      commandId: randomUUID(), clientId: 'serial-admission', sessionId: null,
      type: 'createSession', issuedAt: Date.now(), payload: { workspaceId: f.root },
    } })).status, 'accepted');
    f.client.modelGate = gate.promise;
    f.client.modelRequested = () => modelRequested.resolve();
    const winner = send('winner', 'model-a');
    await modelRequested.promise;
    const loser = send('loser', 'model-b');
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(f.client.calls.filter(call => call === 'set_model').length, 1);
    gate.resolve();
    assert.equal((await winner).status, 'accepted');
    assert.equal((await loser).reasonCode, 'pi.deliveryUnknown');
    assert.equal(f.client.model?.id, 'model-a');
    assert.equal(f.client.prompts, 1);
    const record = (f.service as unknown as { sessions: Map<string, {
      state: { piPendingIntent?: { commandId: string } } }> }).sessions.get(f.id());
    assert.equal(record?.state.piPendingIntent?.commandId, 'winner');
    const assistant = { role: 'assistant', content: [{ type: 'text', text: 'complete' }],
      stopReason: 'stop', timestamp: Date.now() };
    f.client.messages.push(assistant);
    f.client.emit('record', { type: 'message_start', message: assistant });
    f.client.emit('record', { type: 'message_end', message: assistant });
    f.client.streaming = false;
    f.client.emit('record', { type: 'agent_settled' });
    await (f.service as unknown as { reconciliations: Map<string, Promise<void>> }).reconciliations.get(f.id());
    assert.equal((await send('next', 'model-b')).status, 'accepted');
    assert.equal(f.client.model?.id, 'model-b');
  } finally { gate.resolve(); await f.close(); }
});

test('settled with user-only history remains unresolved in live control and turn rows', async () => {
  const f = await fixture();
  try {
    assert.equal((await f.service.sendConversationCommandV4({ ...f.target, envelope: {
      commandId: randomUUID(), clientId: 'user-only', sessionId: null,
      type: 'createSession', issuedAt: Date.now(), payload: { workspaceId: f.root },
    } })).status, 'accepted');
    assert.equal((await f.service.sendConversationCommandV4({ ...f.target, envelope: {
      commandId: 'user-only-input', clientId: 'user-only', sessionId: f.id(),
      type: 'sendText', issuedAt: Date.now(), payload: { text: 'unfinished' },
    } })).status, 'accepted');
    f.client.streaming = false;
    f.client.emit('record', { type: 'agent_settled' });
    await (f.service as unknown as { reconciliations: Map<string, Promise<void>> }).reconciliations.get(f.id());
    const record = (f.service as unknown as { sessions: Map<string, { snapshot: {
      control: { phase: string; lastError: unknown }; rows: { window: { kind: string; state?: string }[] } } }> }).sessions.get(f.id());
    assert.equal(record?.snapshot.control.phase, 'error');
    assert.ok(record?.snapshot.control.lastError);
    assert.equal(record?.snapshot.rows.window.find(row => row.kind === 'turnHeader')?.state, 'running');
    const rejected = await f.service.sendConversationCommandV4({ ...f.target, envelope: {
      commandId: randomUUID(), clientId: 'user-only', sessionId: f.id(), type: 'sendText',
      issuedAt: Date.now(), payload: { text: 'do not run' },
    } });
    assert.equal(rejected.reasonCode, 'pi.deliveryUnknown');
    assert.equal(f.client.prompts, 1);
  } finally { await f.close(); }
});
