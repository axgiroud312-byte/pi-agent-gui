import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { on } from 'node:events';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { sessionsIndexTopicWireFrameSchema } from '@zcode/shared/zcode-protocol-v4';
import { PiNativeV4Service } from '../src/pi-agent/pi-native-v4-service.js';
import { PiSessionSupervisor } from '../src/pi-agent/pi-session-supervisor.js';

test('pinned Pi exhausted retry retains model failure in the native control', { timeout: 30_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-exhausted-retry-'));
  const profile = join(root, 'profile');
  let attempts = 0;
  const server = createServer(async (req, res) => {
    for await (const _ of req) { /* drain model request */ }
    attempts++;
    res.writeHead(503, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'still overloaded', type: 'server_error' } }));
  });
  let service: PiNativeV4Service | undefined;
  try {
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    await mkdir(profile);
    await writeFile(join(profile, 'models.json'), JSON.stringify({ providers: {
      'retry-contract': { baseUrl: `http://127.0.0.1:${address.port}/v1`, api: 'openai-completions',
        apiKey: 'local-test-only', models: [{ id: 'retry-contract' }] },
    } }));
    await writeFile(join(profile, 'settings.json'), JSON.stringify({ retry: {
      enabled: true, maxRetries: 1, baseDelayMs: 20, provider: { maxRetries: 0 },
    } }));
    const runtime = new PiSessionSupervisor({
      piEntry: fileURLToPath(import.meta.resolve('@earendil-works/pi-coding-agent/rpc-entry')),
      env: { PI_CODING_AGENT_DIR: profile, PI_TELEMETRY: '0' },
      rpcArgs: ['--offline', '--no-extensions', '--no-skills', '--no-prompt-templates', '--no-context-files',
        '--provider', 'retry-contract', '--model', 'retry-contract'],
    });
    service = new PiNativeV4Service(runtime, join(root, 'catalog'));
    const target = { workspacePath: root };
    const create = await service.sendConversationCommandV4({ ...target, envelope: {
      commandId: randomUUID(), clientId: 'exhausted-retry', sessionId: null, type: 'createSession',
      issuedAt: Date.now(), payload: { workspaceId: root },
    } });
    assert.equal(create.result?.type, 'createSession');
    if (create.result?.type !== 'createSession') throw Error('missing Pi session');
    const sessionId = create.result.sessionId;
    const settled = (async () => {
      for await (const [id, record] of on(runtime, 'record', { signal: AbortSignal.timeout(20_000) })) {
        if (id === sessionId && record.type === 'agent_settled') return;
      }
    })();
    const ack = await service.sendConversationCommandV4({ ...target, envelope: {
      commandId: randomUUID(), clientId: 'exhausted-retry', sessionId, type: 'sendText', issuedAt: Date.now(),
      payload: { text: 'must fail after retries' },
    } });
    assert.equal(ack.status, 'accepted');
    await settled;
    assert.equal(attempts, 2);
    assert.equal(runtime.getSession(sessionId)?.phase, 'error');
    assert.match(runtime.getSession(sessionId)?.error ?? '', /overloaded/);
    const record = (service as unknown as { sessions: Map<string, {
      snapshot: { control: { lastError: { message: string } | null } } }> }).sessions.get(sessionId);
    assert.match(record?.snapshot.control.lastError?.message ?? '', /overloaded/);
    await (service as unknown as { reconciliations: Map<string, Promise<void>> }).reconciliations.get(sessionId);
  } finally {
    await service?.dispose();
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
});

test('pinned Pi retries transient model failure and settled native/history rows converge after restart',
  { timeout: 40_000 }, async () => {
    const root = await mkdtemp(join(tmpdir(), 'pi-real-retry-'));
    const profile = join(root, 'profile');
    const directory = join(root, 'catalog');
    const piEntry = fileURLToPath(import.meta.resolve('@earendil-works/pi-coding-agent/rpc-entry'));
    let attempts = 0;
    const server = createServer(async (req, res) => {
      for await (const _ of req) { /* drain request */ }
      attempts++;
      if (attempts === 1) {
        res.writeHead(503, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'overloaded', type: 'server_error' } }));
        return;
      }
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      for (const [delta, finish_reason] of [[{ role: 'assistant', content: 'RECOVERED_FROM_RETRY' }, null], [{}, 'stop']]) {
        res.write(`data: ${JSON.stringify({ id: 'retry', object: 'chat.completion.chunk', created: 1,
          model: 'retry-contract', choices: [{ index: 0, delta, finish_reason }] })}\n\n`);
      }
      res.end('data: [DONE]\n\n');
    });
    const supervisor = () => new PiSessionSupervisor({ piEntry,
      env: { PI_CODING_AGENT_DIR: profile, PI_TELEMETRY: '0' },
      rpcArgs: ['--offline', '--no-extensions', '--no-skills', '--no-prompt-templates', '--no-context-files',
        '--provider', 'retry-contract', '--model', 'retry-contract'],
    });
    let service: PiNativeV4Service | undefined;
    try {
      await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
      const address = server.address();
      assert.ok(address && typeof address !== 'string');
      await mkdir(profile);
      await writeFile(join(profile, 'models.json'), JSON.stringify({ providers: {
        'retry-contract': { baseUrl: `http://127.0.0.1:${address.port}/v1`, api: 'openai-completions',
          apiKey: 'local-test-only', models: [{ id: 'retry-contract' }] },
      } }));
      await writeFile(join(profile, 'settings.json'), JSON.stringify({ retry: {
        enabled: true, maxRetries: 2, baseDelayMs: 20, provider: { maxRetries: 0 },
      } }));
      const runtime = supervisor();
      service = new PiNativeV4Service(runtime, directory);
      const target = { workspacePath: root };
      const create = await service.sendConversationCommandV4({ ...target, envelope: {
        commandId: randomUUID(), clientId: 'retry-test', sessionId: null, type: 'createSession',
        issuedAt: Date.now(), payload: { workspaceId: root },
      } });
      assert.equal(create.status, 'accepted', create.message);
      assert.equal(create.result?.type, 'createSession');
      if (create.result?.type !== 'createSession') throw Error('missing Pi session');
      const sessionId = create.result.sessionId;
      const commandId = randomUUID();
      const settled = (async () => {
        for await (const [id, record] of on(runtime, 'record', { signal: AbortSignal.timeout(20_000) })) {
          if (id === sessionId && record.type === 'agent_settled') return;
        }
      })();
      const ack = await service.sendConversationCommandV4({ ...target, envelope: {
        commandId, clientId: 'retry-test', sessionId, type: 'sendText', issuedAt: Date.now(),
        payload: { text: 'reply after retry' },
      } });
      assert.equal(ack.status, 'accepted', ack.message);
      await settled;
      assert.equal(attempts, 2, 'Pi itself, not the GUI, retries the provider request');
      assert.equal(runtime.getSession(sessionId)?.phase, 'settled');
      assert.equal(runtime.getSession(sessionId)?.error, undefined, 'successful retry must clear only its transient error');
      const liveRecord = (service as unknown as { sessions: Map<string, {
        snapshot: { control: { lastError: unknown } } }> }).sessions.get(sessionId);
      assert.equal(liveRecord?.snapshot.control.lastError, null, 'successful retry clears live native lastError');
      await (service as unknown as { reconciliations: Map<string, Promise<void>> }).reconciliations.get(sessionId);
      const expected = await runtime.getMessages(sessionId);
      assert.ok(expected.length >= 2);
      // Settled reconciliation is asynchronous; wait for its authoritative row.
      let live;
      for (let attempt = 0; attempt < 80; attempt++) {
        live = await service.conversationRowsRangeV4({ ...target, sessionId, limit: 100 });
        if (live.rows.some(row => row.kind === 'assistantText' && row.text.includes('RECOVERED_FROM_RETRY'))) break;
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      assert.ok(live?.rows.some(row => row.kind === 'assistantText' && row.text.includes('RECOVERED_FROM_RETRY')));
      assert.equal(live.rows.find(row => row.kind === 'userInput')?.sourceCommandId, commandId);
      await new Promise(resolve => setTimeout(resolve, 80)); // wait for bookmark write after settled
      await service.dispose();
      const restoredSupervisor = supervisor();
      service = new PiNativeV4Service(restoredSupervisor, directory);
      const indexFrames: unknown[] = [];
      service.onDynamicSessionsIndexFrame(target)(frame => indexFrames.push(frame));
      await service.subscribeSessionsIndexV4(target);
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(restoredSupervisor.getSession(sessionId), undefined,
        'restoring the project list must not start a Pi process');
      const frame = sessionsIndexTopicWireFrameSchema.parse(indexFrames[0]);
      assert.equal(frame.kind, 'complete');
      if (frame.kind !== 'complete' || frame.frame.payload.kind !== 'snapshot') throw Error('missing index snapshot');
      const indexed = frame.frame.payload.snapshot.sessions.find(entry => entry.sessionId === sessionId);
      assert.equal(indexed?.title, 'reply after retry');
      assert.equal(indexed?.titleSource, 'generated');
      assert.equal(indexed?.phase, 'completedSuccess');
      assert.equal(indexed?.sessionEnded, true);
      await service.subscribeConversationV4({ ...target, sessionId });
      const restored = await service.conversationRowsRangeV4({ ...target, sessionId, limit: 100 });
      assert.deepEqual(restored.rows, live.rows);
      assert.equal(restored.rows.find(row => row.kind === 'userInput')?.sourceCommandId, commandId);
    } finally {
      await service?.dispose();
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
      await rm(root, { recursive: true, force: true });
    }
  });
