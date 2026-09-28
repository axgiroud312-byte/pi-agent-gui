import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { on } from 'node:events';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import { sessionsIndexTopicWireFrameSchema } from '@zcode/shared/zcode-protocol-v4';
import { PiNativeV4Service } from '../src/pi-agent/pi-native-v4-service.js';
import { PiSessionSupervisor } from '../src/pi-agent/pi-session-supervisor.js';

test('pinned Pi new-session JSONL and cold CLI index follow settings, env and flag storage precedence',
  { timeout: 90_000 }, async () => {
    const root = await mkdtemp(join(tmpdir(), 'pi-custom-session-directory-'));
    const workspace = join(root, 'workspace');
    const otherWorkspace = join(root, 'other-workspace');
    const profile = join(root, 'profile');
    const projectSettings = join(workspace, '.pi', 'settings.json');
    const piEntry = fileURLToPath(import.meta.resolve('@earendil-works/pi-coding-agent/rpc-entry'));
    const privatePackage = join(root, 'private-pi-package');
    const baselineArgs = ['--offline', '--no-approve', '--no-extensions', '--no-skills',
      '--no-prompt-templates', '--no-context-files'];
    let modelCalls = 0;
    const model = createServer(async (request, response) => {
      for await (const _ of request) { /* drain request */ }
      modelCalls++;
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.write(`data: ${JSON.stringify({ id: 'session-directory', object: 'chat.completion.chunk',
        created: 1, model: 'directory-model', choices: [{ index: 0,
          delta: { role: 'assistant', content: 'DIRECTORY_MODEL_OK' }, finish_reason: null }] })}\n\n`);
      response.write(`data: ${JSON.stringify({ id: 'session-directory', object: 'chat.completion.chunk',
        created: 1, model: 'directory-model', choices: [{ index: 0,
          delta: {}, finish_reason: 'stop' }] })}\n\n`);
      response.end('data: [DONE]\n\n');
    });
    try {
      await new Promise<void>(resolve => model.listen(0, '127.0.0.1', resolve));
      const address = model.address();
      assert.ok(address && typeof address !== 'string');
      await Promise.all([workspace, otherWorkspace, profile, dirname(projectSettings)]
        .map(path => mkdir(path, { recursive: true })));
      await cp(dirname(dirname(piEntry)), privatePackage, { recursive: true });
      await writeFile(join(profile, 'models.json'), JSON.stringify({ providers: {
        'directory-provider': { baseUrl: `http://127.0.0.1:${address.port}/v1`,
          api: 'openai-completions', apiKey: 'local-test-only',
          models: [{ id: 'directory-model' }] },
      } }));
      await writeFile(join(profile, 'settings.json'), JSON.stringify({
        sessionDir: 'user-sessions', defaultProvider: 'directory-provider',
        defaultModel: 'directory-model',
      }));
      const scenarios = [
        { name: 'user setting', project: '{}', envDir: undefined, flagDir: undefined,
          expected: join(workspace, 'user-sessions') },
        { name: 'project setting before trust gate', project: '{"sessionDir":"project-sessions"}',
          envDir: undefined, flagDir: undefined, expected: join(workspace, 'project-sessions') },
        { name: 'environment override', project: '{"sessionDir":"project-sessions"}',
          envDir: 'env-sessions', flagDir: undefined, expected: join(workspace, 'env-sessions') },
        { name: 'CLI flag override', project: '{"sessionDir":"project-sessions"}',
          envDir: 'env-sessions', flagDir: 'flag-sessions', expected: join(workspace, 'flag-sessions') },
      ] as const;
      for (const scenario of scenarios) {
        await writeFile(projectSettings, scenario.project);
        const env = { PI_CODING_AGENT_DIR: profile, PI_PACKAGE_DIR: privatePackage,
          PI_TELEMETRY: '0', ...(scenario.envDir
            ? { PI_CODING_AGENT_SESSION_DIR: scenario.envDir } : {}) };
        const rpcArgs = [...baselineArgs, ...(scenario.flagDir
          ? ['--session-dir', scenario.flagDir] : [])];
        const supervisor = new PiSessionSupervisor({ piEntry, env, rpcArgs });
        let sessionFile: string;
        let sessionId: string;
        try {
          assert.equal(await supervisor.sessionDirectory(workspace), scenario.expected,
            `${scenario.name}: Host resolution`);
          const created = await supervisor.createSession(workspace);
          sessionFile = created.sessionFile;
          sessionId = created.sessionId;
          assert.equal(dirname(sessionFile), scenario.expected,
            `${scenario.name}: actual fixed Pi JSONL must be under the selected directory`);
          const settled = (async () => {
            for await (const [id, record] of on(supervisor, 'record',
              { signal: AbortSignal.timeout(20_000) })) {
              if (id === sessionId && record.type === 'agent_settled') return;
            }
          })();
          assert.equal(await supervisor.sendText(sessionId, `DIRECTORY_${scenario.name}`), 'run');
          await settled;
          const opened = SessionManager.open(sessionFile);
          assert.equal(opened.getSessionId(), sessionId,
            `${scenario.name}: CLI can read the exact fixed Pi JSONL`);
          assert.ok(opened.getEntries().some(entry => entry.type === 'message' &&
            entry.message.role === 'assistant' &&
            JSON.stringify(entry.message.content).includes('DIRECTORY_MODEL_OK')),
          `${scenario.name}: fixed Pi wrote the actual model response`);
        } finally {
          await supervisor.dispose();
        }
        const cli = SessionManager.open(sessionFile!);
        cli.appendMessage({ role: 'user', content: `CLI_${scenario.name}`, timestamp: Date.now() });
        cli.appendSessionInfo(`Session in ${scenario.name}`);
        const original = await readFile(sessionFile!);
        assert.equal((await SessionManager.list(workspace, scenario.expected))[0]?.id, sessionId!,
          `${scenario.name}: CLI discovers the real Pi session`);
        assert.deepEqual(await SessionManager.list(otherWorkspace, scenario.expected), [],
          `${scenario.name}: shared storage does not disclose a different cwd`);
        const coldSupervisor = new PiSessionSupervisor({ piEntry, env, rpcArgs });
        const service = new PiNativeV4Service(coldSupervisor, join(root, `catalog-${scenario.name}`));
        const frames: unknown[] = [];
        try {
          service.onDynamicSessionsIndexFrame({ workspacePath: workspace })(frame => frames.push(frame));
          await service.subscribeSessionsIndexV4({ workspacePath: workspace });
          await new Promise(resolve => setImmediate(resolve));
          const frame = sessionsIndexTopicWireFrameSchema.parse(frames.at(-1));
          assert.equal(frame.kind, 'complete');
          if (frame.kind !== 'complete' || frame.frame.payload.kind !== 'snapshot') {
            throw new Error('Missing cold Pi session index snapshot');
          }
          assert.ok(frame.frame.payload.snapshot.sessions.some(item => item.sessionId === sessionId),
            `${scenario.name}: native cold index discovers the CLI-updated JSONL`);
          assert.deepEqual(await readFile(sessionFile!), original,
            `${scenario.name}: discovery does not rewrite Pi history`);
          if (scenario.name === 'project setting before trust gate') {
            const resumed = await coldSupervisor.resumeSession(workspace, sessionFile!, sessionId!);
            assert.equal(resumed.sessionId, sessionId, 'restart retains the fixed Pi session identity');
            assert.equal(resumed.sessionFile, sessionFile, 'restart resumes the exact custom JSONL');
            const settled = (async () => {
              for await (const [id, record] of on(coldSupervisor, 'record',
                { signal: AbortSignal.timeout(20_000) })) {
                if (id === sessionId && record.type === 'agent_settled') return;
              }
            })();
            assert.equal(await coldSupervisor.sendText(sessionId!, 'DIRECTORY_RESTART_CONTINUATION'), 'run');
            await settled;
            assert.ok((await readFile(sessionFile!)).subarray(0, original.length).equals(original),
              'restart appends to the Pi-owned JSONL without replacing its original bytes');
            assert.equal(SessionManager.open(sessionFile!).getSessionId(), sessionId,
              'Pi CLI opens the same session after restart continuation');
          }
        } finally {
          await service.dispose();
        }
      }
      assert.equal(modelCalls, scenarios.length + 1,
        'one real fixed Pi inference per storage source plus one restart continuation');
    } finally {
      model.closeAllConnections();
      await new Promise<void>(resolve => model.close(() => resolve()));
      const canonicalRoot = await realpath(root);
      const canonicalTemp = await realpath(tmpdir());
      assert.equal(dirname(canonicalRoot).toLowerCase(), canonicalTemp.toLowerCase(),
        'test cleanup target must remain a direct child of the system temp directory');
      assert.match(basename(canonicalRoot), /^pi-custom-session-directory-/u,
        'test cleanup target must retain its dedicated prefix');
      await rm(canonicalRoot, { recursive: true, force: true });
    }
  });
