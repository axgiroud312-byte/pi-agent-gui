import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { on } from 'node:events';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import { sessionsIndexTopicWireFrameSchema } from '@zcode/shared/zcode-protocol-v4';
import { PiNativeV4Service } from '../src/pi-agent/pi-native-v4-service.js';
import { PiSessionCatalog } from '../src/pi-agent/pi-session-catalog.js';
import { PiSessionSupervisor } from '../src/pi-agent/pi-session-supervisor.js';

test('native index discovers pinned Pi CLI sessions in a custom shared directory without claiming other workspaces',
  async () => {
    const root = await mkdtemp(join(tmpdir(), 'pi-cli-index-'));
    const firstWorkspace = join(root, 'first');
    const secondWorkspace = join(root, 'second');
    const sessionDir = join(root, 'shared-pi-sessions');
    const catalogDir = join(root, 'app-catalog');
    await mkdir(firstWorkspace);
    await mkdir(secondWorkspace);
    const cli = SessionManager.create(firstWorkspace, sessionDir);
    cli.appendMessage({ role: 'user', content: 'CLI session to continue', timestamp: Date.now() });
    cli.appendMessage({ role: 'assistant', content: [{ type: 'text', text: 'Pi CLI answer' }],
      timestamp: Date.now() } as Parameters<typeof cli.appendMessage>[0]);
    cli.appendSessionInfo('Named in Pi CLI');
    const sessionFile = cli.getSessionFile();
    assert.ok(sessionFile);
    assert.equal((await SessionManager.list(firstWorkspace, sessionDir))[0]?.id, cli.getSessionId(),
      'fixture is visible through the pinned Pi 0.87.0 listing API');
    const supervisor = new PiSessionSupervisor({ piEntry: join(root, 'unused'),
      env: { PI_CODING_AGENT_SESSION_DIR: sessionDir } });
    const service = new PiNativeV4Service(supervisor, catalogDir);
    try {
      const list = async (workspacePath: string) => {
        const frames: unknown[] = [];
        service.onDynamicSessionsIndexFrame({ workspacePath })(frame => frames.push(frame));
        await service.subscribeSessionsIndexV4({ workspacePath });
        await new Promise(resolve => setImmediate(resolve));
        const frame = sessionsIndexTopicWireFrameSchema.parse(frames[0]);
        assert.equal(frame.kind, 'complete');
        if (frame.kind !== 'complete' || frame.frame.payload.kind !== 'snapshot') throw Error('missing index');
        return frame.frame.payload.snapshot.sessions;
      };
      assert.deepEqual((await list(firstWorkspace)).map(item => [item.sessionId, item.title]),
        [[cli.getSessionId(), 'Named in Pi CLI']]);
      assert.deepEqual(await list(secondWorkspace), [], 'a shared --session-dir must still isolate by Pi cwd');
      assert.deepEqual(await readdir(catalogDir).catch(() => []), [],
        'discovering CLI history must not create a second copy of Pi history');
    } finally {
      await service.dispose();
      await rm(root, { recursive: true, force: true });
    }
  });

test('an explicit index resync discovers Pi CLI JSONL created after the GUI subscribed', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-cli-live-discovery-'));
  const workspace = join(root, 'workspace');
  const otherWorkspace = join(root, 'other-workspace');
  const sessionDir = join(root, 'sessions');
  await mkdir(workspace);
  await mkdir(otherWorkspace);
  const supervisor = new PiSessionSupervisor({ piEntry: join(root, 'unused'),
    env: { PI_CODING_AGENT_SESSION_DIR: sessionDir } });
  const service = new PiNativeV4Service(supervisor, join(root, 'catalog'));
  const target = { workspacePath: workspace };
  const frames: unknown[] = [];
  const listener = service.onDynamicSessionsIndexFrame(target)(frame => frames.push(frame));
  try {
    const subscription = await service.subscribeSessionsIndexV4(target);
    await new Promise(resolve => setImmediate(resolve));
    const initial = sessionsIndexTopicWireFrameSchema.parse(frames.at(-1));
    assert.equal(initial.kind, 'complete');
    if (initial.kind !== 'complete' || initial.frame.payload.kind !== 'snapshot') throw Error('missing initial snapshot');
    assert.deepEqual(initial.frame.payload.snapshot.sessions, []);

    const cli = SessionManager.create(workspace, sessionDir);
    cli.appendMessage({ role: 'user', content: 'CREATED_WHILE_GUI_OPEN', timestamp: Date.now() });
    cli.appendMessage({ role: 'assistant', content: [{ type: 'text', text: 'CLI answer' }],
      timestamp: Date.now() } as Parameters<typeof cli.appendMessage>[0]);
    cli.appendSessionInfo('CLI created while GUI open');
    const file = cli.getSessionFile();
    assert.ok(file);
    const lines = (await readFile(file, 'utf8')).trimEnd().split('\n');
    lines[0] = JSON.stringify({ ...JSON.parse(lines[0]!), futureCliMetadata: { retained: true } });
    await writeFile(file, `${lines.join('\n')}\n`);
    const original = await readFile(file);
    const other = SessionManager.create(otherWorkspace, sessionDir);
    other.appendMessage({ role: 'user', content: 'ANOTHER_WORKSPACE', timestamp: Date.now() });
    other.appendMessage({ role: 'assistant', content: [{ type: 'text', text: 'Other answer' }],
      timestamp: Date.now() } as Parameters<typeof other.appendMessage>[0]);

    await service.resyncSessionsIndexV4({ ...target, subscriptionId: subscription.ack.subscriptionId });
    await new Promise(resolve => setImmediate(resolve));
    const snapshots = frames.map(frame => sessionsIndexTopicWireFrameSchema.parse(frame))
      .filter(frame => frame.kind === 'complete' && frame.frame.payload.kind === 'snapshot');
    const last = snapshots.at(-1);
    assert.ok(last && last.kind === 'complete' && last.frame.payload.kind === 'snapshot');
    assert.deepEqual(last.frame.payload.snapshot.sessions.map(item => [item.sessionId, item.title]),
      [[cli.getSessionId(), 'CLI created while GUI open']]);
    const countNewSessionUpserts = () => frames.map(frame => sessionsIndexTopicWireFrameSchema.parse(frame))
      .filter(frame => frame.kind === 'complete' && frame.frame.payload.kind === 'deltas')
      .flatMap(frame => frame.kind === 'complete' && frame.frame.payload.kind === 'deltas'
        ? frame.frame.payload.deltas : [])
      .filter(delta => delta.op === 'session.upserted' && delta.session.sessionId === cli.getSessionId()).length;
    assert.equal(countNewSessionUpserts(), 1, 'new CLI session gets one live index delta');
    await service.resyncSessionsIndexV4({ ...target, subscriptionId: subscription.ack.subscriptionId });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(countNewSessionUpserts(), 1, 'unchanged CLI JSONL must not churn index deltas');
    assert.deepEqual(await readFile(file), original, 'refresh must not rewrite Pi JSONL or unknown fields');
    assert.equal((await SessionManager.list(otherWorkspace, sessionDir)).length, 1);
  } finally {
    listener.dispose();
    await service.dispose();
    await rm(root, { recursive: true, force: true });
  }
});

test('pinned Pi resumes CLI history in GUI service and the same JSONL can continue in CLI',
  { timeout: 40_000 }, async () => {
    const root = await mkdtemp(join(tmpdir(), 'pi-cli-gui-cli-'));
    const profile = join(root, 'profile');
    const sessionDir = join(root, 'sessions');
    const catalogDir = join(root, 'catalog');
    const server = createServer(async (req, res) => {
      for await (const _ of req) { /* drain request */ }
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      for (const [delta, finish_reason] of [[{ role: 'assistant', content: 'GUI_CONTINUATION' }, null],
        [{}, 'stop']] as const) {
        res.write(`data: ${JSON.stringify({ id: 'cli-gui-cli', object: 'chat.completion.chunk', created: 1,
          model: 'history-test', choices: [{ index: 0, delta, finish_reason }] })}\n\n`);
      }
      res.end('data: [DONE]\n\n');
    });
    let service: PiNativeV4Service | undefined;
    try {
      await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
      const address = server.address();
      assert.ok(address && typeof address !== 'string');
      await mkdir(profile);
      await writeFile(join(profile, 'models.json'), JSON.stringify({ providers: {
        'history-test': { baseUrl: `http://127.0.0.1:${address.port}/v1`, api: 'openai-completions',
          apiKey: 'local-test-only', models: [{ id: 'history-test' }] },
      } }));
      const cli = SessionManager.create(root, sessionDir);
      cli.appendMessage({ role: 'user', content: 'CLI_ORIGINAL', timestamp: Date.now() });
      cli.appendMessage({ role: 'assistant', content: [{ type: 'text', text: 'CLI_ANSWER' }],
        api: 'openai-completions', provider: 'history-test', model: 'history-test',
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
        stopReason: 'stop', timestamp: Date.now() });
      cli.appendSessionInfo('Renamed in Pi CLI');
      const sessionId = cli.getSessionId();
      const sessionFile = cli.getSessionFile();
      assert.ok(sessionFile);
      await new PiSessionCatalog(catalogDir).save({ sessionId, sessionFile,
        workspacePath: root, workspaceKey: root, workspaceId: root,
        createdAt: Date.now() - 1000, lastActivityAt: Date.now() - 1000,
        title: 'Stale app title', titleSource: 'custom' });
      const runtime = new PiSessionSupervisor({
        piEntry: fileURLToPath(import.meta.resolve('@earendil-works/pi-coding-agent/rpc-entry')),
        env: { PI_CODING_AGENT_DIR: profile, PI_CODING_AGENT_SESSION_DIR: sessionDir, PI_TELEMETRY: '0' },
        rpcArgs: ['--offline', '--no-extensions', '--no-skills', '--no-prompt-templates', '--no-context-files',
          '--provider', 'history-test', '--model', 'history-test'],
      });
      service = new PiNativeV4Service(runtime, catalogDir);
      const target = { workspacePath: root };
      const indexFrames: unknown[] = [];
      service.onDynamicSessionsIndexFrame(target)(frame => indexFrames.push(frame));
      await service.subscribeSessionsIndexV4(target);
      await new Promise(resolve => setImmediate(resolve));
      const indexFrame = sessionsIndexTopicWireFrameSchema.parse(indexFrames[0]);
      assert.equal(indexFrame.kind, 'complete');
      if (indexFrame.kind !== 'complete' || indexFrame.frame.payload.kind !== 'snapshot') throw Error('missing index');
      assert.equal(indexFrame.frame.payload.snapshot.sessions.find(item => item.sessionId === sessionId)?.title,
        'Renamed in Pi CLI', 'Pi session_info is authoritative over an older app display bookmark');
      await service.subscribeConversationV4({ ...target, sessionId });
      assert.equal(runtime.getSession(sessionId)?.sessionFile, sessionFile);
      const before = await service.conversationRowsRangeV4({ ...target, sessionId, limit: 100 });
      assert.ok(before.rows.some(row => row.kind === 'userInput' && row.text === 'CLI_ORIGINAL'));
      assert.ok(before.rows.some(row => row.kind === 'assistantText' && row.text === 'CLI_ANSWER'));
      const settled = (async () => {
        for await (const [id, record] of on(runtime, 'record', { signal: AbortSignal.timeout(20_000) })) {
          if (id === sessionId && record.type === 'agent_settled') return;
        }
      })();
      const ack = await service.sendConversationCommandV4({ ...target, envelope: {
        commandId: randomUUID(), clientId: 'cli-gui-cli-test', sessionId, type: 'sendText',
        issuedAt: Date.now(), payload: { text: 'GUI_FOLLOWUP' },
      } });
      assert.equal(ack.status, 'accepted', ack.message);
      await settled;
      await (service as unknown as { reconciliations: Map<string, Promise<void>> })
        .reconciliations.get(sessionId);
      await service.dispose();
      service = undefined;
      const continued = SessionManager.open(sessionFile);
      assert.equal(continued.getSessionId(), sessionId, 'GUI must keep the Pi session identity');
      const messages = continued.getEntries().filter(entry => entry.type === 'message');
      const text = (content: unknown): string => typeof content === 'string' ? content :
        Array.isArray(content) ? content.filter(part => part?.type === 'text')
          .map(part => part.text as string).join('') : '';
      assert.ok(messages.some(entry => entry.type === 'message' && entry.message.role === 'user' &&
        text(entry.message.content) === 'CLI_ORIGINAL'));
      assert.ok(messages.some(entry => entry.type === 'message' && entry.message.role === 'user' &&
        text(entry.message.content) === 'GUI_FOLLOWUP'));
      assert.ok(messages.some(entry => entry.type === 'message' && entry.message.role === 'assistant' &&
        text(entry.message.content).includes('GUI_CONTINUATION')));
    } finally {
      await service?.dispose();
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
      await rm(root, { recursive: true, force: true });
    }
  });
