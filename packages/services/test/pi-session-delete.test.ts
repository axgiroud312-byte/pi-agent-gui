import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import { PiNativeV4Service } from '../src/pi-agent/pi-native-v4-service.js';
import { PiQueueMediaStore } from '../src/pi-agent/pi-queue-media-store.js';
import { PiSessionCatalog } from '../src/pi-agent/pi-session-catalog.js';
import { PiSessionSupervisor } from '../src/pi-agent/pi-session-supervisor.js';
import { createZCodeTaskServiceAdapter } from '../src/zcode-agent/zcodeTaskServiceAdapter.js';
import type { TaskIndexRepo } from '../src/session/taskIndexRepo.js';

test('Pi task deletion refuses an unconfirmed or rejected JSONL deletion without task-index tombstones', async () => {
  type Options = Parameters<typeof createZCodeTaskServiceAdapter>[0];
  const calls: string[] = [];
  let rejectDeletion = true;
  const service = createZCodeTaskServiceAdapter({
    piHistoryAuthoritative: true,
    piSessionDeletionPreview: async () => ({ sessionFile: 'C:/pi/sessions/actual.jsonl', revision: 'actual-revision',
      title: 'Actual Pi title' }),
    piSessionDelete: async () => {
      calls.push('pi-delete');
      if (rejectDeletion) throw new Error('Pi history changed');
    },
    zcodeAgentService: { disposeAll() {} } as unknown as Options['zcodeAgentService'],
    taskIndexRepo: { async updateTaskState() { calls.push('legacy-tombstone'); }, close() {} } as unknown as TaskIndexRepo,
    taskIndexSyncer: {
      onSessionTerminalEvent: () => ({ dispose() {} }),
      onSessionReadyEvent: () => ({ dispose() {} }),
      emitWorkspaceTaskListChanged() { calls.push('task-event'); },
      disposeAll() {},
    } as unknown as Options['taskIndexSyncer'],
  } as Options);
  const target = { taskId: 'e73f89ef-4350-4742-8f94-b24724ea0f98', workspacePath: 'C:/pi' };
  try {
    assert.deepEqual(await service.getTaskSessionFilePath(target), {
      path: 'C:/pi/sessions/actual.jsonl', exists: true, revision: 'actual-revision', title: 'Actual Pi title',
    });
    await assert.rejects(service.deleteTask(target), /confirmed file and revision/i);
    assert.deepEqual(calls, []);
    const confirmed = { ...target, expectedSessionFile: 'C:/pi/sessions/actual.jsonl',
      expectedRevision: 'actual-revision' };
    await assert.rejects(service.deleteTask(confirmed), /history changed/i);
    assert.deepEqual(calls, ['pi-delete']);
    rejectDeletion = false;
    await service.deleteTask(confirmed);
    assert.deepEqual(calls, ['pi-delete', 'pi-delete'], 'no legacy index mutation can masquerade as Pi deletion');
  } finally { service.disposeAll(); }
});

test('Pi session path reports only its explicit not-found code as absent', async () => {
  type Options = Parameters<typeof createZCodeTaskServiceAdapter>[0];
  let previewError: Error = Object.assign(new Error('Pi session is absent'),
    { code: 'PI_SESSION_NOT_FOUND' });
  const service = createZCodeTaskServiceAdapter({
    piHistoryAuthoritative: true,
    piSessionDeletionPreview: async () => { throw previewError; },
    zcodeAgentService: { disposeAll() {} } as unknown as Options['zcodeAgentService'],
    taskIndexSyncer: {
      onSessionTerminalEvent: () => ({ dispose() {} }),
      onSessionReadyEvent: () => ({ dispose() {} }),
      emitWorkspaceTaskListChanged() {},
      disposeAll() {},
    } as unknown as Options['taskIndexSyncer'],
  } as Options);
  const target = { taskId: 'missing-pi-session', workspacePath: 'C:/pi' };
  try {
    assert.deepEqual(await service.getTaskSessionFilePath(target), { path: '', exists: false });
    previewError = Object.assign(new Error('Pi session history is ambiguous'), { code: 'PI_SESSION_AMBIGUOUS' });
    await assert.rejects(service.getTaskSessionFilePath(target), /ambiguous/);
    previewError = Object.assign(new Error('Session directory is unavailable'), { code: 'ENOENT' });
    await assert.rejects(service.getTaskSessionFilePath(target), /directory is unavailable/);
    previewError = new Error('Pi session not found while reading its directory');
    await assert.rejects(service.getTaskSessionFilePath(target), /not found while reading/);
  } finally { service.disposeAll(); }
});

test('a post-unlink bookmark cleanup error cannot turn a real Pi deletion into a failed result', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-session-delete-cleanup-'));
  const workspacePath = join(root, 'workspace');
  const sessionDir = join(root, 'sessions');
  await mkdir(workspacePath);
  const cli = SessionManager.create(workspacePath, sessionDir);
  cli.appendMessage({ role: 'user', content: 'delete after cleanup fault', timestamp: Date.now() });
  cli.appendMessage({ role: 'assistant', content: [{ type: 'text', text: 'reply' }],
    timestamp: Date.now() } as Parameters<typeof cli.appendMessage>[0]);
  const sessionFile = cli.getSessionFile();
  assert.ok(sessionFile);
  const service = new PiNativeV4Service(new PiSessionSupervisor({ piEntry: join(root, 'unused'),
    env: { PI_CODING_AGENT_SESSION_DIR: sessionDir } }), join(root, 'catalog'));
  try {
    const target = { workspacePath, sessionId: cli.getSessionId() };
    const preview = await service.inspectSessionDeletion(target);
    (service as unknown as { catalog: PiSessionCatalog }).catalog.remove = async () => {
      throw new Error('simulated bookmark cleanup failure');
    };
    await service.deletePersistedSession({ ...target, expectedSessionFile: preview.sessionFile,
      expectedRevision: preview.revision });
    await assert.rejects(readFile(sessionFile), { code: 'ENOENT' });
  } finally {
    await service.dispose();
    await rm(root, { recursive: true, force: true });
  }
});

test('confirmed Pi deletion removes only the exact cold JSONL and cannot silently lose a changed or active session',
  { timeout: 40_000 }, async () => {
    const root = await mkdtemp(join(tmpdir(), 'pi-session-delete-'));
    const firstWorkspace = join(root, 'first');
    const secondWorkspace = join(root, 'second');
    const sessionDir = join(root, 'shared-sessions');
    const catalogDir = join(root, 'catalog');
    await mkdir(firstWorkspace);
    await mkdir(secondWorkspace);
    const first = SessionManager.create(firstWorkspace, sessionDir);
    first.appendMessage({ role: 'user', content: 'Delete exactly this Pi history', timestamp: Date.now() });
    first.appendMessage({ role: 'assistant', content: [{ type: 'text', text: 'First reply' }],
      timestamp: Date.now() } as Parameters<typeof first.appendMessage>[0]);
    first.appendSessionInfo('Pi delete target');
    const other = SessionManager.create(secondWorkspace, sessionDir);
    other.appendMessage({ role: 'user', content: 'Another workspace must survive', timestamp: Date.now() });
    other.appendMessage({ role: 'assistant', content: [{ type: 'text', text: 'Other reply' }],
      timestamp: Date.now() } as Parameters<typeof other.appendMessage>[0]);
    const firstFile = first.getSessionFile();
    const otherFile = other.getSessionFile();
    assert.ok(firstFile && otherFile);
    const originalOther = await readFile(otherFile);
    const media = new PiQueueMediaStore(join(catalogDir, 'queue-media'));
    const image = { type: 'image' as const, data: Buffer.from('session image').toString('base64'),
      mimeType: 'image/png' };
    const firstMedia = (await media.materialize(first.getSessionId(),
      { id: 'first-queue-image', text: 'former queue input', images: [image] }))[0]!.ref;
    const otherMedia = (await media.materialize(other.getSessionId(),
      { id: 'other-queue-image', text: 'other input', images: [image] }))[0]!.ref;
    const supervisor = new PiSessionSupervisor({
      piEntry: fileURLToPath(import.meta.resolve('@earendil-works/pi-coding-agent/rpc-entry')),
      env: { PI_CODING_AGENT_SESSION_DIR: sessionDir, PI_CODING_AGENT_DIR: join(root, 'profile'), PI_TELEMETRY: '0' },
      rpcArgs: ['--offline', '--no-extensions', '--no-skills', '--no-prompt-templates', '--no-context-files'],
    });
    let service: PiNativeV4Service | undefined = new PiNativeV4Service(supervisor, catalogDir);
    try {
      const target = { workspacePath: firstWorkspace, sessionId: first.getSessionId() };
      const preview = await service.inspectSessionDeletion(target);
      assert.equal(preview.sessionFile, firstFile);
      assert.equal(preview.title, 'Pi delete target');
      assert.equal(preview.sessionId, first.getSessionId());
      await assert.rejects(service.inspectSessionDeletion({ workspacePath: secondWorkspace,
        sessionId: first.getSessionId() }), /another workspace/i);
      await assert.rejects(service.deletePersistedSession({ ...target, expectedSessionFile: otherFile,
        expectedRevision: preview.revision }), /changed|match/i);
      assert.equal(SessionManager.open(firstFile).getSessionId(), first.getSessionId());
      assert.deepEqual(await readFile(firstMedia), Buffer.from('session image'));

      // A Pi CLI write after confirmation preview invalidates that confirmation.
      first.appendSessionInfo('Externally changed after preview');
      await assert.rejects(service.deletePersistedSession({ ...target,
        expectedSessionFile: preview.sessionFile, expectedRevision: preview.revision }), /changed/i);
      const current = await service.inspectSessionDeletion(target);
      await service.subscribeConversationV4(target);
      await assert.rejects(service.deletePersistedSession({ ...target,
        expectedSessionFile: current.sessionFile, expectedRevision: current.revision }), /active/i);
      assert.equal(SessionManager.open(firstFile).getSessionId(), first.getSessionId());
      await assert.rejects(readFile(firstMedia), { code: 'ENOENT' },
        'an image absent from both the Pi queue and its JSONL is reclaimed after readback');

      await service.dispose();
      // Recreate this exact cache entry while the session is cold so deletion
      // still proves that it removes its own cache and leaves the other one.
      assert.equal((await media.materialize(first.getSessionId(),
        { id: 'first-queue-image', text: 'former queue input', images: [image] }))[0]!.ref, firstMedia);
      service = new PiNativeV4Service(new PiSessionSupervisor({
        piEntry: fileURLToPath(import.meta.resolve('@earendil-works/pi-coding-agent/rpc-entry')),
        env: { PI_CODING_AGENT_SESSION_DIR: sessionDir, PI_CODING_AGENT_DIR: join(root, 'profile'), PI_TELEMETRY: '0' },
        rpcArgs: ['--offline', '--no-extensions', '--no-skills', '--no-prompt-templates', '--no-context-files'],
      }), catalogDir);
      const confirmed = await service.inspectSessionDeletion(target);
      await service.deletePersistedSession({ ...target, expectedSessionFile: confirmed.sessionFile,
        expectedRevision: confirmed.revision });
      await assert.rejects(readFile(firstFile), { code: 'ENOENT' });
      await assert.rejects(readFile(firstMedia), { code: 'ENOENT' },
        'confirmed Pi history deletion must remove its private queue-image cache');
      assert.deepEqual(await readFile(otherMedia), Buffer.from('session image'),
        'another Pi session must keep its own recovery image');
      assert.equal((await SessionManager.list(firstWorkspace, sessionDir)).length, 0);
      assert.deepEqual(await readFile(otherFile), originalOther);
      assert.equal((await SessionManager.list(secondWorkspace, sessionDir))[0]?.id, other.getSessionId());
      assert.deepEqual(await new PiSessionCatalog(catalogDir).list(firstWorkspace), []);
      await service.dispose();
      service = new PiNativeV4Service(new PiSessionSupervisor({ piEntry: join(root, 'unused'),
        env: { PI_CODING_AGENT_SESSION_DIR: sessionDir } }), catalogDir);
      const unreadable = join(sessionDir, 'unreadable.jsonl');
      await writeFile(unreadable, '{not a Pi JSONL header}\n');
      await assert.rejects(service.inspectSessionDeletion(target), /discovery is incomplete/i,
        'Pi 0.87.0 silently skips invalid JSONL; do not purge a recovery copy on that basis');
      await unlink(unreadable);
      await assert.rejects(service.inspectSessionDeletion(target), error =>
        error instanceof Error && (error as Error & { code?: string }).code === 'PI_SESSION_NOT_FOUND',
        'a deleted Pi JSONL must not reappear from an app bookmark after restart');
    } finally {
      await service?.dispose();
      await rm(root, { recursive: true, force: true });
    }
  });
