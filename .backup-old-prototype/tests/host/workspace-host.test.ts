import { test } from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { WorkspaceHost } from '../../src/host/workspace-host.js';
import { acquireSessionLease } from '../../src/host/session-lease.js';

const fixture = fileURLToPath(new URL('../fixtures/workspace-pi.mjs', import.meta.url));
async function setup() {
  const directory = await mkdtemp(join(tmpdir(), 'pi-host-中文 '));
  const options = { settingsPath: join(directory, 'workbench.json'), profile: { executable: process.execPath, args: [fixture], agentDir: directory }, version: 'test' };
  const host = new WorkspaceHost(options);
  await host.initialize();
  return { host, directory, options, cleanup: async () => { await host.dispose(); await rm(directory, { recursive: true, force: true }); } };
}
async function waitFor(predicate: () => boolean) {
  const end = Date.now() + 10_000;
  while (!predicate()) { if (Date.now() > end) throw new Error('Host condition timed out'); await delay(20); }
}

test('workspace/profile persistence reopens ordinary Unicode directories without spawning or replaying sessions', async () => {
  const context = await setup();
  try {
    const opened = await context.host.openWorkspace(context.directory);
    assert.equal(opened.target, 'local');
    assert.equal(opened.branch, null);
    assert.equal((await context.host.openWorkspace(context.directory)).id, opened.id);
    await context.host.saveProfile(context.options.profile);
    const restored = new WorkspaceHost(context.options);
    await restored.initialize();
    assert.deepEqual(restored.snapshot().workspaces, [opened]);
    assert.deepEqual(restored.snapshot().profile, context.options.profile);
    assert.deepEqual(restored.snapshot().sessions, []);
    await restored.dispose();
  } finally { await context.cleanup(); }
});

test('host prevents duplicate submission and a crashed session does not affect another Pi process', async () => {
  const context = await setup();
  try {
    const workspace = await context.host.openWorkspace(context.directory);
    const first = await context.host.createSession(workspace.id);
    const second = await context.host.createSession(workspace.id);
    assert.notEqual(first.pid, second.pid);
    assert.notEqual(first.generation, second.generation);
    await context.host.sendPrompt(first.id, '你好');
    await assert.rejects(context.host.sendPrompt(first.id, 'duplicate'), /正在运行/);
    await assert.rejects(context.host.sendPrompt(second.id, 'crash'), /exit/i);
    await waitFor(() => context.host.snapshot().sessions.find(item => item.id === first.id)?.phase === 'settled');
    const snapshot = context.host.snapshot();
    assert.equal(snapshot.sessions.find(item => item.id === second.id)?.phase, 'exited');
    const healthy = snapshot.sessions.find(item => item.id === first.id)!;
    assert.equal(healthy.messages.filter(message => message.role === 'user').length, 1);
    assert.match(healthy.messages[1]!.content[0]!.text!, /权威回复：你好/);
  } finally { await context.cleanup(); }
});

test('successful automatic retry clears transient errors but only settles on agent_settled', async () => {
  const context = await setup();
  try {
    const workspace = await context.host.openWorkspace(context.directory);
    const session = await context.host.createSession(workspace.id);
    await context.host.sendPrompt(session.id, 'retry');
    await waitFor(() => context.host.snapshot().sessions[0]!.phase === 'retrying');
    await waitFor(() => context.host.snapshot().sessions[0]!.phase === 'settled');
    assert.equal(context.host.snapshot().sessions[0]!.error, undefined);
  } finally { await context.cleanup(); }
});

test('invalid workspace/profile and corrupt settings are rejected without overwriting source data', async () => {
  const context = await setup();
  try {
    await assert.rejects(context.host.openWorkspace('relative'), /绝对目录/);
    await assert.rejects(context.host.openWorkspace(join(context.directory, 'missing')), /ENOENT/);
    await assert.rejects(context.host.saveProfile({ executable: 'node', args: 'not an array' }), /字符串数组/);
    assert.equal(context.host.snapshot().workspaces.length, 0);
    await writeFile(context.options.settingsPath, '{broken', 'utf8');
    const restored = new WorkspaceHost(context.options);
    await assert.rejects(restored.initialize(), SyntaxError);
    assert.equal(await readFile(context.options.settingsPath, 'utf8'), '{broken');
    await restored.dispose();
  } finally { await context.cleanup(); }
});

test('handled input with no Run returns to idle, and rejected errors are sanitized at both public boundaries', async () => {
  const context = await setup();
  try {
    const workspace = await context.host.openWorkspace(context.directory);
    const session = await context.host.createSession(workspace.id);
    await context.host.sendPrompt(session.id, '/handled');
    assert.equal(context.host.snapshot().sessions[0]!.phase, 'idle');
    assert.equal(context.host.snapshot().sessions[0]!.canSubmit, true);
    await context.host.sendPrompt(session.id, 'timed-dialog');
    assert.equal(context.host.snapshot().sessions[0]!.phase, 'idle');
    assert.equal(context.host.snapshot().sessions[0]!.canSubmit, true);
    await context.host.sendPrompt(session.id, 'secret-notify');
    assert.doesNotMatch(JSON.stringify(context.host.snapshot()), /SYNTHETIC_/);
    await assert.rejects(context.host.sendPrompt(session.id, 'secret-error'), error => {
      assert.doesNotMatch(String(error), /SYNTHETIC_/);
      assert.match(String(error), /\[redacted\]/);
      return true;
    });
    assert.doesNotMatch(JSON.stringify(context.host.snapshot()), /SYNTHETIC_/);
    assert.equal(context.host.snapshot().sessions[0]!.canSubmit, true);
  } finally { await context.cleanup(); }
});

test('overlapping lease-release callers both wait until the lock has been removed', async () => {
  const context = await setup();
  try {
    const file = join(context.directory, 'concurrent-release.jsonl');
    const release = await acquireSessionLease(file);
    const first = release();
    await release();
    await assert.rejects(access(`${file}.pi-agent-ide.lock`), { code: 'ENOENT' });
    await first;
  } finally { await context.cleanup(); }
});

test('pinned compaction events expose failures and recover overflow without retaining the prior error', async () => {
  const context = await setup();
  try {
    const workspace = await context.host.openWorkspace(context.directory);
    const session = await context.host.createSession(workspace.id);
    await context.host.sendPrompt(session.id, 'compact-fail');
    assert.equal(context.host.snapshot().sessions[0]!.phase, 'compacting');
    await waitFor(() => context.host.snapshot().sessions[0]!.phase === 'error');
    assert.match(context.host.snapshot().sessions[0]!.error!, /summary failed/);
    await context.host.sendPrompt(session.id, 'compact-recover');
    assert.equal(context.host.snapshot().sessions[0]!.phase, 'compacting');
    await waitFor(() => context.host.snapshot().sessions[0]!.phase === 'settled');
    assert.equal(context.host.snapshot().sessions[0]!.error, undefined);
  } finally { await context.cleanup(); }
});

test('two hosts cannot write the same canonical native session file; leases release on close', async () => {
  const context = await setup();
  const other = new WorkspaceHost({ ...context.options, settingsPath: join(context.directory, 'other-workbench.json') });
  try {
    const profile = { ...context.options.profile, args: [fixture, `--fixture-session-file=${join(context.directory, 'native.jsonl')}`] };
    await context.host.saveProfile(profile);
    await other.initialize(profile);
    const firstWorkspace = await context.host.openWorkspace(context.directory);
    const otherWorkspace = await other.openWorkspace(context.directory);
    const first = await context.host.createSession(firstWorkspace.id);
    assert.equal(first.canSubmit, true);
    const refused = await other.createSession(otherWorkspace.id);
    assert.equal(refused.phase, 'error');
    assert.equal(refused.canSubmit, false);
    assert.match(refused.error!, /占用/);
    await context.host.closeSession(first.id);
    const acquired = await other.createSession(otherWorkspace.id);
    assert.equal(acquired.phase, 'idle');
    assert.equal(acquired.canSubmit, true);
    for (const flag of ['--session', '--session-id', '--continue', '-c', '--resume', '-r', '--fork', '--mode']) {
      await assert.rejects(context.host.saveProfile({ ...profile, args: [fixture, flag] }), /宿主独占/);
    }
  } finally { await other.dispose(); await context.cleanup(); }
});
