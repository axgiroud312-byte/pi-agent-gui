import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { on } from 'node:events';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { PiNativeV4Service } from '../src/pi-agent/pi-native-v4-service.js';
import { PiSessionSupervisor } from '../src/pi-agent/pi-session-supervisor.js';

test('native model cycle uses pinned Pi RPC state for the next model and inference',
  { timeout: 45_000 }, async () => {
    const root = await mkdtemp(join(tmpdir(), 'pi-model-cycle-fixed-'));
    const profile = join(root, 'profile');
    const requests: string[] = [];
    const model = createServer(async (request, response) => {
      let body = '';
      for await (const part of request) body += part;
      const modelId = (JSON.parse(body) as { model: string }).model;
      requests.push(modelId);
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.write(`data: ${JSON.stringify({ id: 'pi-cycle', object: 'chat.completion.chunk',
        created: 1, model: modelId, choices: [{ index: 0,
          delta: { role: 'assistant', content: `CYCLED_${modelId}` }, finish_reason: null }] })}\n\n`);
      response.write(`data: ${JSON.stringify({ id: 'pi-cycle', object: 'chat.completion.chunk',
        created: 1, model: modelId, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`);
      response.end('data: [DONE]\n\n');
    });
    let service: PiNativeV4Service | undefined;
    try {
      await new Promise<void>(resolve => model.listen(0, '127.0.0.1', resolve));
      const address = model.address();
      assert.ok(address && typeof address !== 'string');
      await mkdir(profile);
      const modelsFile = join(profile, 'models.json');
      await writeFile(modelsFile, JSON.stringify({ providers: {
        'cycle-provider': { baseUrl: `http://127.0.0.1:${address.port}/v1`,
          api: 'openai-completions', apiKey: 'local-test-only',
          models: [{ id: 'first' }, { id: 'second' }] },
      } }));
      await writeFile(join(profile, 'settings.json'), JSON.stringify({
        defaultProvider: 'cycle-provider', defaultModel: 'first',
      }));
      const supervisor = new PiSessionSupervisor({
        piEntry: fileURLToPath(import.meta.resolve('@earendil-works/pi-coding-agent/rpc-entry')),
        env: { PI_CODING_AGENT_DIR: profile, PI_TELEMETRY: '0' },
        rpcArgs: ['--offline', '--no-extensions', '--no-skills', '--no-prompt-templates',
          '--no-context-files'],
      });
      service = new PiNativeV4Service(supervisor, join(root, 'catalog'));
      const created = await service.sendConversationCommandV4({ workspacePath: root, envelope: {
        commandId: randomUUID(), clientId: 'cycle-test', sessionId: null,
        issuedAt: Date.now(), type: 'createSession', payload: { workspaceId: root },
      } });
      assert.equal(created.status, 'accepted', created.message);
      assert.equal(created.result?.type, 'createSession');
      if (created.result?.type !== 'createSession') throw new Error('Missing Pi session');
      const sessionId = created.result.sessionId;
      const before = await supervisor.getState(sessionId);
      assert.equal((before.model as { id?: string } | undefined)?.id, 'first');
      const cycled = await service.sendConversationCommandV4({ workspacePath: root, envelope: {
        commandId: randomUUID(), clientId: 'cycle-test', sessionId,
        issuedAt: Date.now(), baseRevision: created.revisionAtDecision,
        type: 'cycleModelConfig' as never, payload: {},
      } });
      assert.equal(cycled.status, 'accepted', cycled.message ?? cycled.reasonCode);
      assert.equal(cycled.result?.type, 'cycleModelConfig');
      if (cycled.result?.type !== 'cycleModelConfig') throw new Error('Missing Pi cycle result');
      assert.deepEqual({ provider: cycled.result.provider, model: cycled.result.model },
        { provider: 'cycle-provider', model: 'second' });
      const after = await supervisor.getState(sessionId);
      assert.equal((after.model as { id?: string } | undefined)?.id, 'second');
      assert.equal(cycled.result.thinkingLevel, after.thinkingLevel,
        'the ACK must carry Pi effective thinking, not a local model default');
      assert.equal(cycled.result.isScoped, false);
      const settled = (async () => {
        for await (const [id, record] of on(supervisor, 'record',
          { signal: AbortSignal.timeout(20_000) })) {
          if (id === sessionId && record.type === 'agent_settled') return;
        }
      })();
      const sent = await service.sendConversationCommandV4({ workspacePath: root, envelope: {
        commandId: randomUUID(), clientId: 'cycle-test', sessionId,
        issuedAt: Date.now(), type: 'sendText', payload: { text: 'use cycled model' },
      } });
      assert.equal(sent.status, 'accepted', sent.message);
      await settled;
      assert.deepEqual(requests, ['second'], 'the model chosen by Pi must make the next request');
      await writeFile(modelsFile, JSON.stringify({ providers: {
        'cycle-provider': { baseUrl: `http://127.0.0.1:${address.port}/v1`,
          api: 'openai-completions', apiKey: 'local-test-only',
          models: [{ id: 'first' }] },
      } }));
      const single = await service.sendConversationCommandV4({ workspacePath: root, envelope: {
        commandId: randomUUID(), clientId: 'cycle-test', sessionId: null,
        issuedAt: Date.now(), type: 'createSession', payload: { workspaceId: root },
      } });
      assert.equal(single.status, 'accepted', single.message);
      assert.equal(single.result?.type, 'createSession');
      if (single.result?.type !== 'createSession') throw new Error('Missing single-model Pi session');
      const singleCycle = await service.sendConversationCommandV4({ workspacePath: root, envelope: {
        commandId: randomUUID(), clientId: 'cycle-test', sessionId: single.result.sessionId,
        issuedAt: Date.now(), baseRevision: single.revisionAtDecision,
        type: 'cycleModelConfig', payload: {},
      } });
      assert.equal(singleCycle.status, 'noop', singleCycle.message);
      assert.equal(singleCycle.reasonCode, 'pi.singleCycleModel');
      assert.equal((await supervisor.getState(single.result.sessionId)).model?.id, 'first');
    } finally {
      await service?.dispose();
      model.closeAllConnections();
      await new Promise<void>(resolve => model.close(() => resolve()));
      const canonicalRoot = await realpath(root);
      const canonicalTemp = await realpath(tmpdir());
      assert.equal(dirname(canonicalRoot).toLowerCase(), canonicalTemp.toLowerCase(),
        'cleanup target must be a direct child of temp');
      assert.match(basename(canonicalRoot), /^pi-model-cycle-fixed-/u);
      await rm(canonicalRoot, { recursive: true, force: true });
    }
  });
