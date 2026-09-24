import assert from 'node:assert/strict';
import { on } from 'node:events';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { PiRpcClient } from '../src/pi-agent/pi-rpc-client.js';
import { PiMessageRows } from '../src/pi-agent/pi-message-rows.js';
import { PiSessionCatalog } from '../src/pi-agent/pi-session-catalog.js';
import { PiSessionSupervisor } from '../src/pi-agent/pi-session-supervisor.js';
import { PiNativeV4Service } from '../src/pi-agent/pi-native-v4-service.js';

test('real Pi compaction success reports Pi facts and history remains projectable after RPC restart',
  { timeout: 30_000 }, async () => {
    const root = await mkdtemp(join(tmpdir(), 'pi-compact-'));
    const profile = join(root, 'profile');
    const piEntry = fileURLToPath(import.meta.resolve('@earendil-works/pi-coding-agent/rpc-entry'));
    const server = createServer(async (req, res) => {
      for await (const _ of req) { /* drain */ }
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      for (const [delta, finish_reason] of [[{ role: 'assistant', content: 'PI_SUMMARY_OR_REPLY' }, null], [{}, 'stop']]) {
        res.write(`data: ${JSON.stringify({ id: 'compact', object: 'chat.completion.chunk', created: 1,
          model: 'compact-contract', choices: [{ index: 0, delta, finish_reason }] })}\n\n`);
      }
      res.end('data: [DONE]\n\n');
    });
    let client: PiRpcClient | undefined;
    let service: PiNativeV4Service | undefined;
    try {
      await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
      const address = server.address();
      assert.ok(address && typeof address !== 'string');
      await mkdir(profile);
      await writeFile(join(profile, 'models.json'), JSON.stringify({ providers: {
        'compact-contract': { baseUrl: `http://127.0.0.1:${address.port}/v1`, api: 'openai-completions',
          apiKey: 'local-test-only', models: [{ id: 'compact-contract' }] },
      } }));
      await writeFile(join(profile, 'settings.json'), JSON.stringify({ compaction: { enabled: true,
        keepRecentTokens: 1, reserveTokens: 1000 }, retry: { enabled: false },
      }));
      const create = (args: string[]) => new PiRpcClient({ executable: process.execPath,
        args: [piEntry, '--offline', '--no-extensions', '--no-skills', '--no-prompt-templates', '--no-context-files',
          '--provider', 'compact-contract', '--model', 'compact-contract', ...args],
        cwd: root, env: { PI_CODING_AGENT_DIR: profile, PI_TELEMETRY: '0' },
      });
      client = create([]);
      const records: Record<string, unknown>[] = [];
      client.on('record', event => records.push(event));
      await client.start();
      for (const prompt of ['first turn before compaction', 'second turn remains']) {
        const settled = (async () => {
          for await (const [event] of on(client!, 'record', { signal: AbortSignal.timeout(10_000) })) {
            if (event.type === 'agent_settled') return;
          }
        })();
        const response = await client.request({ type: 'prompt', message: prompt });
        assert.equal(response.success, true, response.error);
        await settled;
      }
      const state = await client.request({ type: 'get_state' });
      const path = (state.data as { sessionFile: string; sessionId: string }).sessionFile;
      const sessionId = (state.data as { sessionFile: string; sessionId: string }).sessionId;
      const compact = await client.request({ type: 'compact' }, 15_000);
      assert.equal(compact.success, true, compact.error);
      assert.ok(records.some(event => event.type === 'compaction_start' && event.reason === 'manual'));
      assert.ok(records.some(event => event.type === 'compaction_end' && event.aborted === false && event.result));
      const before = await client.request({ type: 'get_messages' });
      assert.equal(before.success, true);
      const messages = (before.data as { messages: unknown[] }).messages;
      const entriesResponse = await client.request({ type: 'get_entries' });
      assert.equal(entriesResponse.success, true, entriesResponse.error);
      const entries = (entriesResponse.data as { entries: { type: string; message?: unknown }[] }).entries;
      const historical = entries.filter(entry => entry.type === 'message').map(entry => entry.message);
      assert.ok(historical.some(message => (message as { role?: string })?.role === 'user'),
        JSON.stringify(entries.map(entry => entry.type)));
      const rows = new PiMessageRows(root).restore(historical);
      await client.dispose();
      client = create(['--session', path]);
      await client.start();
      const after = await client.request({ type: 'get_messages' });
      assert.deepEqual((after.data as { messages: unknown[] }).messages, messages);
      const afterEntries = await client.request({ type: 'get_entries' });
      assert.deepEqual(new PiMessageRows(root).restore(
        (afterEntries.data as { entries: { type: string; message?: unknown }[] }).entries
          .filter(entry => entry.type === 'message').map(entry => entry.message)), rows);
      await client.dispose();
      const catalogDir = join(root, 'index');
      await new PiSessionCatalog(catalogDir).save({ sessionId, sessionFile: path,
        workspacePath: root, workspaceKey: root, workspaceId: root, createdAt: 1, lastActivityAt: 1 });
      service = new PiNativeV4Service(new PiSessionSupervisor({ piEntry,
        env: { PI_CODING_AGENT_DIR: profile, PI_TELEMETRY: '0' },
        rpcArgs: ['--offline', '--no-extensions', '--no-skills', '--no-prompt-templates', '--no-context-files',
          '--provider', 'compact-contract', '--model', 'compact-contract'],
      }), catalogDir);
      await service.subscribeConversationV4({ workspacePath: root, sessionId });
      const native = await service.conversationRowsRangeV4({ workspacePath: root, sessionId, limit: 100 });
      assert.deepEqual(native.rows, rows, 'native Pi history must retain pre-compaction user turns');
    } finally {
      await service?.dispose();
      await client?.dispose();
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
      await rm(root, { recursive: true, force: true });
    }
  });
