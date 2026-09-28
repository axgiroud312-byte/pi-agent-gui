import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { conversationTopicWireFrameSchema, type SessionControl } from '@zcode/shared/zcode-protocol-v4';
import type { PiRpcClient } from '../src/pi-agent/pi-rpc-client.js';
import { PiNativeV4Service } from '../src/pi-agent/pi-native-v4-service.js';
import { PiSessionSupervisor } from '../src/pi-agent/pi-session-supervisor.js';

for (const scenario of ['failure', 'aborted', 'extension', 'protocol',
  'recovery', 'recovery-extension', 'recovery-protocol'] as const) {
  test(`compaction ${scenario} reaches native subscribers and preserves error ownership`, { timeout: 10_000 }, async () => {
    const root = await mkdtemp(join(tmpdir(), 'pi-compact-error-'));
    const sessionId = randomUUID();
    let sessionFile = '';
    class Client extends EventEmitter {
      readonly pid = process.pid;
      streaming = false;
      async start() {}
      async dispose() {}
      async request(command: { type: string }) {
        if (command.type === 'prompt') this.streaming = true;
        if (command.type === 'abort') this.streaming = false;
        return { success: true, data: command.type === 'get_state'
          ? { sessionId, sessionFile, isStreaming: this.streaming, pendingMessageCount: 0 }
          : command.type === 'get_entries' ? { entries: [], leafId: null }
          : command.type === 'get_messages' ? { messages: [] } : {} };
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
    const reconciled = () => (service as unknown as {
      reconciliations: Map<string, Promise<void>>;
    }).reconciliations.get(sessionId);
    const emit = (type: string, extra: Record<string, unknown> = {}) => client.emit('record', { type, ...extra });
    const control = async () => {
      const received = Promise.withResolvers<SessionControl>();
      const listener = service.onDynamicConversationFrame(target)(wire => {
        const frame = conversationTopicWireFrameSchema.parse(wire);
        if (frame.kind === 'complete' && frame.frame.payload.kind === 'snapshot') {
          received.resolve(frame.frame.payload.snapshot.control);
        }
      });
      try {
        const sub = await service.subscribeConversationV4({ ...target, sessionId });
        const value = await received.promise;
        await service.unsubscribeConversationV4({ ...target, subscriptionId: sub.ack.subscriptionId });
        return value;
      } finally { listener.dispose(); }
    };
    try {
      const create = await service.sendConversationCommandV4({ ...target, envelope: {
        commandId: randomUUID(), clientId: 'compact-error', sessionId: null, type: 'createSession',
        issuedAt: Date.now(), payload: { workspaceId: root },
      } });
      assert.equal(create.status, 'accepted');
      await supervisor.sendText(sessionId, 'run');
      emit('agent_start');
      emit('message_end', { message: { role: 'assistant', stopReason: 'error', errorMessage: 'transient model error' } });
      const hasExtensionError = scenario.endsWith('extension');
      const hasProtocolError = scenario.endsWith('protocol');
      if (hasExtensionError) emit('extension_error', { error: 'independent extension failure' });
      if (hasProtocolError) client.emit('diagnostic', { kind: 'protocol', message: 'malformed record' });
      emit('compaction_start', { reason: 'overflow' });
      if (scenario.startsWith('recovery')) {
        emit('compaction_end', { reason: 'overflow', result: {}, aborted: false, willRetry: true });
        // Pi continues after overflow compaction without auto_retry_end.
        emit('agent_start');
        emit('message_end', { message: { role: 'assistant', stopReason: 'stop', content: [] } });
        client.streaming = false;
        emit('agent_settled');
        await reconciled();
        const recovered = await control();
        assert.equal(recovered.phase, hasExtensionError || hasProtocolError ? 'error' : 'completedSuccess');
        assert.equal(recovered.lastError?.message ?? null, hasExtensionError ? 'independent extension failure'
          : hasProtocolError ? 'Pi protocol output was malformed; inspect the session before sending another input' : null);
        return;
      }
      emit('compaction_end', { reason: 'overflow', result: null, aborted: scenario === 'aborted',
        ...(scenario === 'aborted' ? {} : { errorMessage: 'Compaction failed: quota exceeded' }) });
      const expected = scenario === 'extension' ? 'independent extension failure'
        : scenario === 'protocol' ? 'Pi protocol output was malformed; inspect the session before sending another input'
        : scenario === 'aborted' ? 'Pi compaction aborted' : 'Compaction failed: quota exceeded';
      assert.equal((await control()).lastError?.message, expected, 'failure reason is visible before settled');
      emit('auto_retry_end', { success: true });
      client.streaming = false;
      emit('agent_settled');
      await reconciled();
      const failed = await control();
      assert.equal(failed.phase, 'error');
      assert.equal(failed.lastError?.message, expected, 'successful model retry cannot erase an independent failure');
      assert.equal(failed.lastError?.code, scenario === 'protocol' ? 'pi.deliveryUnknown' : 'pi.runtimeError');
      if (scenario === 'protocol') {
        await assert.rejects(supervisor.sendText(sessionId, 'must not bypass reconciliation'), /reconciliation/);
      } else {
        await supervisor.sendText(sessionId, 'new run after recovery');
        assert.equal((await control()).lastError, null, 'new input clears the previous recoverable run error');
        emit('agent_start');
        emit('compaction_start');
        emit('compaction_end', { result: {}, aborted: false });
        client.streaming = false;
        emit('agent_settled');
        await reconciled();
        const recovered = await control();
        assert.equal(recovered.phase, 'completedSuccess');
        assert.equal(recovered.lastError, null);
      }
    } finally { await service.dispose(); await rm(root, { recursive: true, force: true }); }
  });
}
