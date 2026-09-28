import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import type { ZCodeTaskMeta } from '@zcode/shared';
import type { IZCodeAgentService, IZCodeTaskService } from '@zcode/services';
import { PiNativeV4Service } from '../../../services/src/pi-agent/pi-native-v4-service.js';
import { PiSessionSupervisor } from '../../../services/src/pi-agent/pi-session-supervisor.js';
import { createWindowHostControllerRuntime } from './windowHostControllerService.js';

test('native conversation search finds a Pi CLI JSONL session without a legacy task row', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-controller-search-'));
  const workspacePath = join(root, 'project');
  const sessionDir = join(root, 'pi-sessions');
  await mkdir(workspacePath);
  const cli = SessionManager.create(workspacePath, sessionDir);
  cli.appendMessage({ role: 'user', content: 'CLI_ORIGINAL', timestamp: Date.now() });
  cli.appendMessage({ role: 'assistant', content: [{ type: 'text', text: 'CLI_ANSWER' }],
    timestamp: Date.now() } as Parameters<typeof cli.appendMessage>[0]);
  cli.appendSessionInfo('Find Pi CLI session');
  assert.equal((await SessionManager.list(workspacePath, sessionDir))[0]?.id, cli.getSessionId());
  const pi = new PiNativeV4Service(new PiSessionSupervisor({
    piEntry: join(root, 'unused-pi-entry'), env: { PI_CODING_AGENT_SESSION_DIR: sessionDir },
  }), join(root, 'app-bookmarks'));
  const indexed = { taskId: '13ff92b8-d805-4234-95cb-85112877687b',
    traceId: 'legacy-task', workspacePath, title: 'Old pi cli task with matching body',
    createdAt: 1, updatedAt: 1, mode: 'build' } as ZCodeTaskMeta;
  const taskService = {
    listTasks: async () => [indexed],
    listPinnedTasks: async () => [],
    listArchivedTasks: async () => [],
    listTaskList: async () => ({ items: [{ ...indexed, searchSnippets: ['Body mentions pi cli'] }],
      total: 1, hasMore: false }),
  } as unknown as IZCodeTaskService;
  const runtime = createWindowHostControllerRuntime({
    createId: () => 'test-id',
    resolveSource: scope => scope.workspacePath === workspacePath ? {
      scope: { kind: 'local', workspacePath }, taskService,
      agentService: pi as unknown as IZCodeAgentService, sourceAvailability: 'online',
    } : null,
  });
  try {
    const indexDeadline = Date.now() + 2000;
    for (;;) {
      const visible = await runtime.service.listTaskList({
        kind: 'timeline', workspaceScopes: [{ workspacePath }], sortBy: 'updated', limit: 10,
      });
      if (visible.items.some(item => item.taskId === cli.getSessionId())) break;
      if (Date.now() > indexDeadline) throw new Error('Pi sessions-index did not reach native controller');
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    const result = await runtime.service.listTaskList({
      kind: 'timeline', workspaceScopes: [{ workspacePath }], sortBy: 'updated',
      search: 'pi cli', limit: 10,
    });
    assert.deepEqual(result.items.map(item => [item.taskId, item.title]), [
      [cli.getSessionId(), 'Find Pi CLI session'],
      [indexed.taskId, indexed.title],
    ]);
    assert.deepEqual(result.items[1]?.searchSnippets, ['Body mentions pi cli'],
      'legacy body search keeps its snippet');
    assert.equal(result.total, 2);
    assert.equal(result.hasMore, false);

    const lateCli = SessionManager.create(workspacePath, sessionDir);
    lateCli.appendMessage({ role: 'user', content: 'LATE_CLI_HISTORY', timestamp: Date.now() });
    lateCli.appendMessage({ role: 'assistant', content: [{ type: 'text', text: 'Late answer' }],
      timestamp: Date.now() } as Parameters<typeof lateCli.appendMessage>[0]);
    lateCli.appendSessionInfo('Late CLI while GUI open');
    const lateSearch = await runtime.service.listTaskList({
      kind: 'timeline', workspaceScopes: [{ workspacePath }], sortBy: 'updated',
      search: 'Late CLI', limit: 10,
    });
    assert.ok(lateSearch.items.some(item => item.taskId === lateCli.getSessionId()),
      'search must rescan Pi JSONL created after the native controller subscribed');

    const refreshedCli = SessionManager.create(workspacePath, sessionDir);
    refreshedCli.appendMessage({ role: 'user', content: 'EXPLICIT_REFRESH', timestamp: Date.now() });
    refreshedCli.appendMessage({ role: 'assistant', content: [{ type: 'text', text: 'Refresh answer' }],
      timestamp: Date.now() } as Parameters<typeof refreshedCli.appendMessage>[0]);
    refreshedCli.appendSessionInfo('Found by explicit refresh');
    const refreshedList = await runtime.service.listTaskList({
      kind: 'timeline', workspaceScopes: [{ workspacePath }], sortBy: 'updated',
      refreshSessions: true, limit: 10,
    });
    assert.ok(refreshedList.items.some(item => item.taskId === refreshedCli.getSessionId()),
      'manual refresh must discover Pi JSONL without a search query');
  } finally {
    runtime.dispose();
    await pi.dispose();
    await rm(root, { recursive: true, force: true });
  }
});
