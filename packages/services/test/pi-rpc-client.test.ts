import assert from 'node:assert/strict';
import { once } from 'node:events';
import { resolve } from 'node:path';
import { test, type TestContext } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { PiRpcClient, PiRpcError, RPC_LIMITS, type PiRpcClientOptions, type RpcDiagnostic, type RpcExit } from '../src/pi-agent/pi-rpc-client.js';

// Keep the caller's cwd under test, but resolve the executable fixture from this module.
const cwd = process.cwd();
const fixture = fileURLToPath(new URL('./fixtures/pi-rpc-child.mjs', import.meta.url));
const testOptions = { timeout: 15_000 };

function recordOnce(client: PiRpcClient, type: string): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const cleanup = (): void => {
      client.off('record', onRecord);
      client.off('exit', onExit);
      clearTimeout(timer);
    };
    const onRecord = (record: Record<string, unknown>): void => {
      if (record.type === type) { cleanup(); resolve(record); }
    };
    const onExit = (): void => { cleanup(); reject(new Error(`Child exited before ${type}`)); };
    const timer = setTimeout(() => { cleanup(); reject(new Error(`Timed out waiting for ${type}`)); }, 5_000);
    client.on('record', onRecord);
    client.on('exit', onExit);
  });
}

function createClient(t: TestContext, overrides: Partial<PiRpcClientOptions> = {}): {
  client: PiRpcClient; records: Record<string, unknown>[]; diagnostics: RpcDiagnostic[]; exits: RpcExit[];
} {
  const client = new PiRpcClient({ executable: process.execPath, args: [fixture], cwd, requestTimeoutMs: 5_000, ...overrides });
  const records: Record<string, unknown>[] = [];
  const diagnostics: RpcDiagnostic[] = [];
  const exits: RpcExit[] = [];
  client.on('record', (record) => records.push(record));
  client.on('diagnostic', (diagnostic) => diagnostics.push(diagnostic));
  client.on('exit', (exit) => exits.push(exit));
  t.after(() => client.dispose());
  return { client, records, diagnostics, exits };
}

async function running(t: TestContext, overrides: Partial<PiRpcClientOptions> = {}): Promise<ReturnType<typeof createClient>> {
  const result = createClient(t, overrides);
  const ready = recordOnce(result.client, 'fixture_ready');
  await result.client.start();
  await ready;
  return result;
}

function rpcError(code: PiRpcError['code'], delivery?: PiRpcError['delivery']): (error: unknown) => boolean {
  return (error) => {
    assert.ok(error instanceof PiRpcError);
    assert.equal(error.code, code, error.message);
    if (delivery) assert.equal(error.delivery, delivery, error.message);
    return true;
  };
}

test('spawn readiness sends no command, carries cwd/env/literal args, and start is idempotent', testOptions, async (t) => {
  const { client } = await running(t, {
    args: [fixture, 'argument with spaces & shell syntax'], env: { PI_RPC_TEST_VALUE: '中文 value' },
  });
  const pid = client.pid;
  assert.ok(pid);
  await Promise.all([client.start(), client.start()]);
  assert.equal(client.pid, pid);
  assert.deepEqual((await client.request({ type: 'test_stats' })).data, []);
  const response = await client.request({ type: 'test_environment' });
  assert.deepEqual(response.data, { cwd, value: '中文 value', args: ['argument with spaces & shell syntax'] });
});

test('request before start and start after disposal fail without launching a child', testOptions, async (t) => {
  const { client, exits } = createClient(t);
  await assert.rejects(client.request({ type: 'prompt', message: 'do not send' }), rpcError('NOT_RUNNING', 'not-sent'));
  await assert.rejects(client.notify({ type: 'extension_ui_response', id: 'x' }), rpcError('NOT_RUNNING'));
  await client.dispose();
  await assert.rejects(client.start(), rpcError('DISPOSED'));
  assert.equal(client.pid, undefined);
  assert.deepEqual(exits, []);
});

test('UTF-8 byte chunks, CRLF, LF, multiple records and Unicode separators survive the child boundary', testOptions, async (t) => {
  const { client, records, diagnostics } = await running(t);
  await client.request({ type: 'test_framing' });
  assert.deepEqual(records.slice(1), [
    { type: 'unicode', text: '中文😀\u2028line\u2029paragraph' }, { type: 'first' }, { type: 'second' },
  ]);
  assert.deepEqual(diagnostics, []);
  const value = 'outbound 中文😀\u2028\u2029\nCR\rLF';
  const response = await client.request({ type: 'test_echo', value });
  assert.equal((response.data as { value: string }).value, value);
});

test('stderr has its own incremental decoder and never becomes a protocol record', testOptions, async (t) => {
  const { client, records, diagnostics } = await running(t);
  await client.request({ type: 'test_stderr' });
  await client.dispose();
  assert.equal(diagnostics.filter((item) => item.kind === 'stderr').map((item) => item.message).join(''), '诊断😀\n{"type":"not_stdout"}\n');
  assert.deepEqual(records, [{ type: 'fixture_ready' }]);
  assert.ok(diagnostics.every((item) => item.kind === 'stderr'));
});

test('malformed stdout is diagnosed, primitives are rejected, and unknown object events are preserved', testOptions, async (t) => {
  const { client, records, diagnostics } = await running(t);
  const response = await client.request({ type: 'test_malformed' });
  assert.equal(diagnostics.filter((item) => item.kind === 'protocol').length, 7);
  assert.deepEqual(records.slice(1), [
    { type: 'future_event', payload: { unknown: true }, id: response.id },
    { opaque: 'object without a type is preserved' },
  ]);
});

test('invalid and truncated UTF-8 are diagnosed and the next LF resynchronizes framing', testOptions, async (t) => {
  const { client, records, diagnostics } = await running(t);
  await client.request({ type: 'test_invalid_utf8' });
  assert.deepEqual(records.slice(1), [{ type: 'recovered' }]);
  assert.equal(diagnostics.length, 2);
  assert.ok(diagnostics.every((item) => item.kind === 'protocol' && /UTF-8/.test(item.message)));
});

test('oversized unterminated stdout is bounded, diagnosed once and discarded until LF', testOptions, async (t) => {
  const { client, records, diagnostics } = await running(t);
  await client.request({ type: 'test_oversized', bytes: RPC_LIMITS.maxRecordBytes + 131072 });
  assert.deepEqual(records.slice(1), [{ type: 'recovered' }]);
  assert.equal(diagnostics.length, 1);
  assert.match(diagnostics[0]!.message, /exceeds .* bytes/);
  assert.ok(diagnostics[0]!.message.length < 1024);
  assert.equal((await client.request({ type: 'get_state' })).success, true);
});

test('responses correlate unique generated IDs even for simultaneous same-command requests', testOptions, async (t) => {
  const { client } = await running(t);
  const replies = await Promise.all(Array.from({ length: 40 }, (_, index) => client.request({
    type: 'test_echo', id: 'caller-id-must-not-be-reused', index, delay: (39 - index) % 7,
  })));
  assert.equal(new Set(replies.map((response) => response.id)).size, replies.length);
  replies.forEach((response, index) => {
    assert.notEqual(response.id, 'caller-id-must-not-be-reused');
    assert.deepEqual(response.data, { id: response.id, index });
  });
});

test('stdin preserves queue command order while responses may arrive in reverse order', testOptions, async (t) => {
  const { client, records } = await running(t);
  const completionOrder: number[] = [];
  const commands = [
    { type: 'steer', message: 'first', index: 0, fixtureAction: 'reverse' },
    { type: 'follow_up', message: 'second', index: 1, fixtureAction: 'reverse' },
    { type: 'steer', message: 'third', index: 2, fixtureAction: 'reverse' },
  ];
  await Promise.all(commands.map(async (command) => {
    const reply = await client.request(command);
    assert.deepEqual(reply.data, { index: command.index });
    completionOrder.push(command.index);
  }));
  assert.deepEqual(completionOrder, [2, 1, 0]);
  assert.deepEqual(records.filter((item) => item.type === 'queue_update'), [
    { type: 'queue_update', steering: ['first'], followUp: [] },
    { type: 'queue_update', steering: ['first'], followUp: ['second'] },
    { type: 'queue_update', steering: ['first', 'third'], followUp: ['second'] },
  ]);
});

test('prompt acceptance and agent_end do not manufacture agent_settled', testOptions, async (t) => {
  const { client, records } = await running(t);
  const ended = recordOnce(client, 'agent_end');
  const response = await client.request({ type: 'prompt', message: 'hello', fixtureAction: 'manual-run' });
  assert.equal(response.success, true);
  assert.equal(records.some((record) => record.type === 'agent_settled'), false);
  await ended;
  assert.equal(records.some((record) => record.type === 'agent_settled'), false);
  assert.ok(records.some((record) => record.type === 'message_update'));
  const settled = recordOnce(client, 'agent_settled');
  await client.request({ type: 'test_settle' });
  assert.deepEqual(await settled, { type: 'agent_settled' });
});

test('events with request IDs remain events and do not settle the request', testOptions, async (t) => {
  const { client, records } = await running(t);
  const response = await client.request({ type: 'test_bash_event' });
  assert.deepEqual(response.data, { output: 'first\n', exitCode: 0 });
  assert.deepEqual(records[1], { type: 'bash_execution_update', id: response.id, delta: 'first\n' });
});

test('notify preserves extension response IDs and needs no command response', testOptions, async (t) => {
  const { client } = await running(t);
  const extension = recordOnce(client, 'extension_ui_request');
  await client.request({ type: 'test_extension' });
  assert.equal((await extension).id, 'dialog-1');
  const received = recordOnce(client, 'fixture_notification');
  await client.notify({ type: 'extension_ui_response', id: 'dialog-1', cancelled: true });
  assert.deepEqual(await received, { type: 'fixture_notification', record: { type: 'extension_ui_response', id: 'dialog-1', cancelled: true } });
});

test('Pi rejection and cancelled session operations are responses, not transport failures', testOptions, async (t) => {
  const { client, diagnostics } = await running(t);
  const rejected = await client.request({ type: 'test_rejected' });
  assert.equal(rejected.success, false);
  assert.equal(rejected.error, 'Fixture rejection');
  assert.deepEqual((await client.request({ type: 'switch_session', sessionPath: '/unused' })).data, { cancelled: true });
  assert.deepEqual(diagnostics, []);
});

test('command mismatch and malformed response envelopes reject only the correlated request', testOptions, async (t) => {
  const { client, diagnostics, records } = await running(t);
  await Promise.all([
    assert.rejects(client.request({ type: 'test_mismatch' }), rpcError('PROTOCOL_ERROR', 'unknown')),
    assert.rejects(client.request({ type: 'test_bad_response' }), rpcError('PROTOCOL_ERROR')),
    assert.rejects(client.request({ type: 'test_bad_error' }), rpcError('PROTOCOL_ERROR')),
    client.request({ type: 'get_state' }),
  ]);
  assert.equal(diagnostics.length, 3);
  assert.match(diagnostics[0]!.message, /command mismatch/);
  assert.equal(records.some((record) => record.type === 'response'), false);
});

test('missing, foreign, invalid and duplicate response IDs are diagnostics, never events', testOptions, async (t) => {
  const { client, diagnostics, records } = await running(t);
  await client.request({ type: 'test_unsolicited' });
  await client.request({ type: 'get_state' });
  assert.equal(diagnostics.length, 4);
  assert.ok(diagnostics.every((item) => item.kind === 'protocol'));
  assert.deepEqual(records, [{ type: 'fixture_ready' }]);
});

test('final response without LF resolves before exit, including CR and multibyte characters', testOptions, async (t) => {
  const { client, exits, records } = await running(t);
  const exited = once(client, 'exit');
  const response = await client.request({ type: 'test_tail' });
  assert.equal(response.data, '尾😀');
  await exited;
  assert.deepEqual(exits, [{ code: 0, signal: null }]);
  assert.deepEqual(records.slice(1), [{ type: 'before_tail' }]);
});

test('final event without LF is emitted before exit and incomplete tail UTF-8 is diagnosed', testOptions, async (t) => {
  const first = await running(t);
  const order: string[] = [];
  first.client.on('record', () => order.push('record'));
  first.client.on('exit', () => order.push('exit'));
  const exited = once(first.client, 'exit');
  await first.client.request({ type: 'test_tail_event' });
  await exited;
  assert.deepEqual(first.records[1], { type: 'tail_event', text: '最后😀\u2028\u2029' });
  assert.deepEqual(order, ['record', 'exit']);
  const second = await running(t);
  const otherExit = once(second.client, 'exit');
  await second.client.request({ type: 'test_bad_tail' });
  await otherExit;
  assert.ok(second.diagnostics.some((item) => item.kind === 'protocol' && /UTF-8/.test(item.message)));
});

test('timeout settles a sent request; a late response is not replayed or misrouted', testOptions, async (t) => {
  const { client, diagnostics } = await running(t);
  await assert.rejects(client.request({ type: 'test_echo', delay: 150, index: 0 }, 30), rpcError('TIMEOUT', 'unknown'));
  const response = await client.request({ type: 'test_echo', delay: 200, index: 1 });
  assert.equal((response.data as { index: number }).index, 1);
  assert.ok(diagnostics.some((item) => /late ID/.test(item.message)));
  const received = (await client.request({ type: 'test_stats' })).data as { type: string; index?: number }[];
  assert.deepEqual(received.filter((item) => item.type === 'test_echo').map((item) => item.index), [0, 1]);
});

test('backpressure waits for the child; timed-out queued commands are removed before they can execute', testOptions, async (t) => {
  const { client } = await running(t);
  await client.request({ type: 'test_pause', delay: 500 });
  let flushed = false;
  const first = client.notify({ type: 'extension_ui_response', id: 'large', payload: 'x'.repeat(8 * 1024 * 1024) }).then(() => { flushed = true; });
  const expired = assert.rejects(client.request({ type: 'test_blob', index: 1 }, 40), rpcError('TIMEOUT', 'not-sent'));
  const last = client.request({ type: 'test_blob', index: 2, payload: 'last' });
  await delay(100);
  assert.equal(flushed, false, 'a paused child must exert real pipe backpressure');
  await expired;
  await first;
  assert.deepEqual((await last).data, { index: 2, length: 4 });
  const received = (await client.request({ type: 'test_stats' })).data as { type: string; index?: number }[];
  assert.deepEqual(received.map((item) => item.type), ['test_pause', 'extension_ui_response', 'test_blob']);
  assert.equal(received[2]!.index, 2);
});

test('outbound byte limit and queue bound reject overload without killing an otherwise live client', testOptions, async (t) => {
  const { client } = await running(t);
  await assert.rejects(client.notify({ payload: 'x'.repeat(RPC_LIMITS.maxRecordBytes) }), rpcError('LIMIT_EXCEEDED', 'not-sent'));
  await client.request({ type: 'test_pause', delay: 500 });
  const payload = 'x'.repeat(12 * 1024 * 1024);
  const first = client.request({ type: 'test_blob', payload, index: 0 });
  const second = client.request({ type: 'test_blob', payload, index: 1 });
  await assert.rejects(client.request({ type: 'test_blob', payload, index: 2 }), rpcError('LIMIT_EXCEEDED', 'not-sent'));
  assert.deepEqual((await first).data, { index: 0, length: payload.length });
  assert.deepEqual((await second).data, { index: 1, length: payload.length });
  assert.equal((await client.request({ type: 'get_state' })).success, true);
});

test('pending request count is bounded even when stdin has room and no responses arrive', testOptions, async (t) => {
  const { client } = await running(t);
  const pending = Array.from({ length: RPC_LIMITS.maxPendingRequests }, () =>
    assert.rejects(client.request({ type: 'test_ignore' }), rpcError('DISPOSED')));
  await assert.rejects(client.request({ type: 'test_ignore' }), rpcError('LIMIT_EXCEEDED', 'not-sent'));
  await client.dispose();
  await Promise.all(pending);
});

test('notification count is bounded behind a backpressured write and disposal settles every write', testOptions, async (t) => {
  const { client, exits } = await running(t);
  await client.request({ type: 'test_pause', delay: null });
  const active = assert.rejects(client.notify({ payload: 'x'.repeat(8 * 1024 * 1024) }), rpcError('DISPOSED', 'unknown'));
  const queued = Array.from({ length: RPC_LIMITS.maxQueuedRecords - 1 }, () =>
    assert.rejects(client.notify({ type: 'extension_ui_response', id: 'unsent' }), rpcError('DISPOSED', 'not-sent')));
  await assert.rejects(client.notify({ id: 'over-limit' }), rpcError('LIMIT_EXCEEDED', 'not-sent'));
  await Promise.all([client.dispose(), client.dispose(), active, ...queued]);
  assert.equal(exits.length, 1);
  assert.equal(client.pid, undefined);
});

test('notification write deadlines remove unsent notifications and report uncertain active delivery', testOptions, async (t) => {
  const { client } = await running(t, { requestTimeoutMs: 150 });
  await client.request({ type: 'test_pause', delay: 400 });
  const active = assert.rejects(client.notify({ payload: 'x'.repeat(8 * 1024 * 1024), type: 'extension_ui_response', id: 'active' }), rpcError('TIMEOUT', 'unknown'));
  const queued = assert.rejects(client.notify({ type: 'extension_ui_response', id: 'must-not-send' }), rpcError('TIMEOUT', 'not-sent'));
  await Promise.all([active, queued]);
  await delay(350);
  const received = (await client.request({ type: 'test_stats' }, 1000)).data as { id?: string }[];
  assert.ok(received.some((item) => item.id === 'active'));
  assert.ok(received.every((item) => item.id !== 'must-not-send'));
});

test('crash settles all in-flight requests and other client processes remain isolated', testOptions, async (t) => {
  const failing = await running(t);
  const healthy = await running(t);
  const exited = once(failing.client, 'exit');
  const pending = Array.from({ length: 4 }, () => assert.rejects(failing.client.request({ type: 'test_ignore' }), rpcError('PROCESS_EXITED', 'unknown')));
  const crash = assert.rejects(failing.client.request({ type: 'test_crash' }), rpcError('PROCESS_EXITED'));
  await Promise.all([...pending, crash, exited]);
  assert.deepEqual(failing.exits, [{ code: 43, signal: null }]);
  assert.equal(failing.diagnostics.filter((item) => item.kind === 'stderr').map((item) => item.message).join(''), 'fixture crashed\n');
  await assert.rejects(failing.client.start(), rpcError('PROCESS_EXITED'));
  await assert.rejects(failing.client.request({ type: 'prompt', message: 'never replay' }), rpcError('PROCESS_EXITED', 'not-sent'));
  assert.equal((await healthy.client.request({ type: 'get_state' })).success, true);
  assert.deepEqual(healthy.exits, []);
});

test('a child dying during a backpressured write settles notifications without unhandled pipe errors', testOptions, async (t) => {
  const { client, exits } = await running(t);
  await client.request({ type: 'test_pause', delay: null, crashAfter: 150 });
  await assert.rejects(client.notify({ payload: 'x'.repeat(8 * 1024 * 1024) }), (error: unknown) => {
    assert.ok(error instanceof PiRpcError);
    // The OS may report the broken pipe before, or after, child exit.
    assert.ok(error.code === 'IO_ERROR' || error.code === 'PROCESS_EXITED', error.message);
    assert.equal(error.delivery, 'unknown');
    return true;
  });
  await client.dispose();
  assert.equal(exits.length, 1);
});

test('exit settles requests even when a descendant keeps stdout and stderr open', testOptions, async (t) => {
  const { client, diagnostics, exits } = await running(t);
  const descendant = recordOnce(client, 'fixture_descendant');
  const request = assert.rejects(client.request({ type: 'test_inherited_stdio' }), rpcError('PROCESS_EXITED', 'unknown'));
  const pid = (await descendant).pid;
  assert.equal(typeof pid, 'number');
  t.after(() => {
    try { process.kill(pid as number, 'SIGKILL'); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
    }
  });
  await request;
  assert.deepEqual(exits, [{ code: 45, signal: null }]);
  // POSIX keeps the shared pipe alive. Windows may close the parent-facing
  // named pipe as soon as the direct child exits, so no drain timer is needed.
  if (process.platform !== 'win32') assert.ok(diagnostics.some((item) => /drain window/.test(item.message)));
});

test('an immediate post-spawn exit is observable and the client cannot restart itself', testOptions, async (t) => {
  const { client, exits } = createClient(t, { args: [fixture, '--fixture-mode=startup-exit'] });
  const exited = once(client, 'exit');
  await client.start();
  await exited;
  assert.deepEqual(exits, [{ code: 17, signal: null }]);
  await assert.rejects(client.start(), rpcError('PROCESS_EXITED', 'not-sent'));
});

test('missing executable and invalid cwd reject spawn, emit diagnostics, and can be disposed', testOptions, async (t) => {
  for (const options of [{ executable: resolve(cwd, 'definitely-missing-node.exe') }, { cwd: resolve(cwd, 'definitely-missing-cwd') }]) {
    const { client, diagnostics } = createClient(t, options);
    await assert.rejects(client.start(), rpcError('SPAWN_FAILED', 'not-sent'));
    await client.dispose();
    assert.ok(diagnostics.some((item) => item.kind === 'process'));
    assert.equal(client.pid, undefined);
  }
});

test('disposal during spawn is cancellation-safe and cannot resurrect the client', testOptions, async (t) => {
  const { client, records } = createClient(t);
  const started = assert.rejects(client.start(), rpcError('DISPOSED'));
  await Promise.all([started, client.dispose()]);
  assert.equal(client.pid, undefined);
  assert.deepEqual(records, []);
  await assert.rejects(client.start(), rpcError('DISPOSED'));
});

test('disposal rejects pending requests, suppresses later records, and reaps a stubborn child', testOptions, async (t) => {
  const { client, records, exits } = await running(t, { args: [fixture, '--fixture-mode=stubborn'] });
  const pid = client.pid;
  assert.ok(pid);
  const pending = assert.rejects(client.request({ type: 'test_echo', delay: 1000 }), rpcError('DISPOSED', 'unknown'));
  const count = records.length;
  await Promise.all([client.dispose(), pending]);
  assert.equal(records.length, count);
  assert.equal(exits.length, 1);
  assert.throws(() => process.kill(pid, 0), /ESRCH/);
  await assert.rejects(client.notify({ type: 'extension_ui_response', id: 'late' }), rpcError('DISPOSED', 'not-sent'));
});

test('serialization failures and invalid deadlines do not poison the transport or leak requests', testOptions, async (t) => {
  const { client } = await running(t);
  const circular: Record<string, unknown> = {};
  circular.self = circular;
  for (const value of [circular, { bigint: 1n }, { toJSON: () => [] }]) {
    await assert.rejects(client.notify(value), rpcError('INVALID_RECORD', 'not-sent'));
  }
  for (const timeout of [0, -1, NaN, Infinity, 1.5, 2_147_483_648]) {
    await assert.rejects(client.request({ type: 'test_echo' }, timeout), rpcError('INVALID_RECORD'));
  }
  assert.deepEqual((await client.request({ type: 'test_stats' })).data, []);
});
