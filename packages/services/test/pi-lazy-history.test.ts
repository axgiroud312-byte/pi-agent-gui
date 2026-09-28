import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { test } from 'node:test';
import { sessionsIndexTopicWireFrameSchema } from '@zcode/shared/zcode-protocol-v4';
import { PiSessionCatalog } from '../src/pi-agent/pi-session-catalog.js';
import { PiNativeV4Service } from '../src/pi-agent/pi-native-v4-service.js';
import { PiSessionSupervisor } from '../src/pi-agent/pi-session-supervisor.js';
import { PiRpcClient } from '../src/pi-agent/pi-rpc-client.js';

test('workspace index is lazy: opening one history starts only its Pi child, exit is recovered without resending', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-lazy-'));
  const directory = join(root, 'catalog');
  const ids = [randomUUID(), randomUUID()];
  // A historical bookmark may contain an absolute but non-canonical path.
  const paths = ids.map(id => `${root}${sep}.${sep}${id}.jsonl`);
  const canonicalPaths: string[] = [];
  const clients: Client[] = [];
  class Client extends EventEmitter {
    readonly pid = process.pid;
    prompts = 0;
    constructor(readonly id: string, readonly path: string) { super(); }
    async start() {}
    async dispose() {}
    async request(command: { type: string }) {
      if (command.type === 'prompt') this.prompts++;
      return { success: true, data: command.type === 'get_state'
        ? { sessionId: this.id, sessionFile: this.path, isStreaming: false, isCompacting: false, pendingMessageCount: 0 }
        : command.type === 'get_entries' ? { entries: [], leafId: null }
        : command.type === 'get_messages' ? { messages: [
          { role: 'user', content: 'before crash', timestamp: 1000 },
          { role: 'assistant', content: [{ type: 'text', text: 'retained by Pi' }], timestamp: 1001 },
        ] } : {} };
    }
  }
  const supervisor = new PiSessionSupervisor({ piEntry: join(root, 'unused'), clientFactory: options => {
    const path = options.args[options.args.indexOf('--session') + 1]!;
    // The supervisor passes realpath(sessionFile) to Pi. Match the same
    // canonical identity, not a bookmark's spelling (which varies on Windows).
    const index = canonicalPaths.indexOf(path);
    assert.notEqual(index, -1, 'Pi must resume one of the fixture session files');
    const client = new Client(ids[index]!, path);
    clients.push(client);
    return client as unknown as PiRpcClient;
  } });
  const service = new PiNativeV4Service(supervisor, directory);
  try {
    const catalog = new PiSessionCatalog(directory);
    for (let i = 0; i < ids.length; i++) {
      await writeFile(paths[i]!, '{}\n');
      canonicalPaths[i] = await realpath(paths[i]!);
      assert.notEqual(canonicalPaths[i], paths[i], 'fixture must exercise a non-canonical bookmark path');
      await catalog.save({ sessionId: ids[i]!, sessionFile: paths[i]!, workspacePath: root,
        workspaceKey: root, workspaceId: root, createdAt: i + 1, lastActivityAt: i + 1,
        ...(i === 0 ? { title: 'before crash', titleSource: 'generated' as const,
          phase: 'completedInterrupted' as const, sessionEnded: true } : {}),
      });
    }
    const indexFrames: unknown[] = [];
    service.onDynamicSessionsIndexFrame({ workspacePath: root })(frame => indexFrames.push(frame));
    const index = await service.subscribeSessionsIndexV4({ workspacePath: root });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(clients.length, 0, 'listing must not spawn historical sessions');
    const frame = sessionsIndexTopicWireFrameSchema.parse(indexFrames[0]);
    assert.equal(frame.kind, 'complete');
    if (frame.kind !== 'complete' || frame.frame.payload.kind !== 'snapshot') throw Error('missing index snapshot');
    const indexed = frame.frame.payload.snapshot.sessions;
    assert.equal(indexed.find(entry => entry.sessionId === ids[0])?.title, 'before crash');
    assert.equal(indexed.find(entry => entry.sessionId === ids[0])?.phase, 'completedInterrupted');
    assert.equal(indexed.find(entry => entry.sessionId === ids[1])?.title, 'Pi session',
      'older bookmarks remain readable without inventing an indexed title');
    await service.subscribeConversationV4({ workspacePath: root, sessionId: ids[0]! });
    assert.equal(clients.length, 1);
    assert.equal(clients[0]!.id, ids[0]);
    assert.equal(clients[0]!.prompts, 0);
    clients[0]!.emit('exit', { code: 1, signal: null });
    await new Promise(resolve => setTimeout(resolve, 30));
    await service.subscribeConversationV4({ workspacePath: root, sessionId: ids[0]! });
    assert.equal(clients.length, 2, 'opening an exited history reclaims its lease and starts only that Pi child');
    assert.equal(clients[1]!.id, ids[0]);
    assert.equal(clients[1]!.prompts, 0, 'recovery must never replay an input');
    const rows = await service.conversationRowsRangeV4({ workspacePath: root, sessionId: ids[0]!, limit: 100 });
    assert.equal(rows.rows.find(row => row.kind === 'assistantText')?.kind, 'assistantText');
    await service.unsubscribeSessionsIndexV4({ workspacePath: root, subscriptionId: index.ack.subscriptionId });
  } finally { await service.dispose(); await rm(root, { recursive: true, force: true }); }
});
