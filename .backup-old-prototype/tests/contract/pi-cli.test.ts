import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { test, type TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { PiRpcClient, type RpcResponse } from '../../src/runtime/pi-rpc-client.js';
import { PI_VERSION } from '../../src/shared/contracts.js';

// Use the installed package's actual `pi` bin, not an SDK or protocol fixture.
const packageDir = fileURLToPath(new URL('../', import.meta.resolve('@earendil-works/pi-coding-agent')));
const metadata = JSON.parse(await readFile(join(packageDir, 'package.json'), 'utf8')) as {
  version: string; bin: { pi: string };
};
const cli = resolve(packageDir, metadata.bin.pi);
const exec = promisify(execFile);
const options = { timeout: 60_000 };

async function sandbox(t: TestContext) {
  const output = resolve('test-results/contract');
  await mkdir(output, { recursive: true });
  const root = await mkdtemp(join(output, 'pi-'));
  const cwd = join(root, '工作区 with spaces');
  const agentDir = join(root, 'agent');
  const home = join(root, 'home');
  const env: NodeJS.ProcessEnv = {};
  // PiRpcClient merges overrides onto process.env. Explicit undefined entries
  // remove inherited credentials, Node preload hooks, and Pi path overrides.
  const inherited = new Set(['PATH', 'SYSTEMROOT', 'WINDIR', 'PATHEXT', 'COMSPEC', 'TEMP', 'TMP', 'TMPDIR']);
  for (const [key, value] of Object.entries(process.env)) {
    env[key] = inherited.has(key.toUpperCase()) ? value : undefined;
  }
  Object.assign(env, {
    HOME: home, USERPROFILE: home,
    APPDATA: join(home, 'AppData/Roaming'), LOCALAPPDATA: join(home, 'AppData/Local'),
    XDG_CONFIG_HOME: join(home, '.config'), XDG_CACHE_HOME: join(home, '.cache'),
    PI_CODING_AGENT_DIR: agentDir, PI_CODING_AGENT_SESSION_DIR: join(root, 'sessions'),
    PI_OFFLINE: '1', PI_TELEMETRY: '0',
    AWS_EC2_METADATA_DISABLED: 'true',
    AWS_CONFIG_FILE: join(home, '.aws/config'), AWS_SHARED_CREDENTIALS_FILE: join(home, '.aws/credentials'),
  });
  await Promise.all([cwd, agentDir, home, env.APPDATA!, env.LOCALAPPDATA!].map((path) => mkdir(path, { recursive: true })));
  await writeFile(join(agentDir, 'auth.json'), '{}\n');
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }));
  return { cwd, agentDir, env };
}

function data(response: RpcResponse, command: string): Record<string, unknown> {
  assert.equal(response.type, 'response');
  assert.equal(response.command, command);
  assert.equal(response.success, true, response.error ?? `${command} was rejected`);
  assert.ok(response.id, 'the real CLI must echo the request ID');
  assert.ok(response.data && typeof response.data === 'object' && !Array.isArray(response.data));
  return response.data as Record<string, unknown>;
}

test('installed Pi CLI reports the pinned version and supports the isolated RPC flags', options, async (t) => {
  const { cwd, env } = await sandbox(t);
  assert.equal(metadata.version, '0.87.0');
  assert.equal(metadata.version, PI_VERSION);
  const version = await exec(process.execPath, [cli, '--version'], { cwd, env, timeout: 30_000, windowsHide: true });
  assert.equal(version.stdout.trim(), PI_VERSION);
  const help = await exec(process.execPath, [cli, '--help'], { cwd, env, timeout: 30_000, windowsHide: true });
  for (const flag of ['--mode', '--offline', '--no-extensions', '--no-skills', '--no-prompt-templates', '--no-themes', '--no-session', '--no-context-files']) {
    assert.ok(help.stdout.includes(flag), `installed CLI help is missing ${flag}`);
  }
  t.diagnostic(`Real CLI: ${cli}; Pi ${PI_VERSION}; Node ${process.version}; ${process.platform}`);
});

test('real Pi RPC: correlated state, empty history, commands, and recovery after an unknown command', options, async (t) => {
  const { cwd, agentDir, env } = await sandbox(t);
  const client = new PiRpcClient({
    executable: process.execPath,
    args: [cli, '--mode', 'rpc', '--offline', '--no-extensions', '--no-skills', '--no-prompt-templates', '--no-themes', '--no-session', '--no-context-files'],
    cwd, env, requestTimeoutMs: 30_000,
  });
  const diagnostics: unknown[] = [];
  const records: unknown[] = [];
  const exchanges: { command: string; response: RpcResponse }[] = [];
  let passed = false;
  const request = async (type: string): Promise<RpcResponse> => {
    const response = await client.request({ type });
    exchanges.push({ command: type, response });
    return response;
  };
  client.on('diagnostic', (entry) => diagnostics.push(entry));
  client.on('record', (entry) => records.push(entry));
  // Dispose before sandbox cleanup, even when a startup or assertion fails.
  try {
    await client.start();
    assert.ok(client.pid);
    const replies = await Promise.all([
      request('get_state'),
      request('get_messages'),
      request('get_commands'),
    ]);
    assert.equal(new Set(replies.map((reply) => reply.id)).size, 3);
    const state = data(replies[0]!, 'get_state');
    assert.equal(typeof state.sessionId, 'string');
    assert.ok((state.sessionId as string).length > 0);
    assert.equal(state.sessionFile, undefined, '--no-session must be ephemeral');
    assert.equal(state.isStreaming, false);
    assert.equal(state.isCompacting, false);
    assert.equal(state.messageCount, 0);
    assert.equal(state.pendingMessageCount, 0);
    assert.equal(typeof state.autoCompactionEnabled, 'boolean');
    assert.ok(['all', 'one-at-a-time'].includes(String(state.steeringMode)));
    assert.ok(['all', 'one-at-a-time'].includes(String(state.followUpMode)));
    // No credentials are provisioned; Pi may legitimately have no selected model.
    if (state.model !== undefined) {
      const model = state.model as Record<string, unknown>;
      assert.equal(typeof model.id, 'string');
      assert.equal(typeof model.provider, 'string');
    }
    assert.deepEqual(data(replies[1]!, 'get_messages').messages, []);
    const commands = data(replies[2]!, 'get_commands').commands;
    assert.ok(Array.isArray(commands));
    // --no-extensions disables discovery, but 0.87.0 still registers its
    // bundled inline llama.cpp command. Check the real sourceInfo contract.
    assert.ok(commands.some((command) => command.name === 'llama'));
    for (const command of commands) {
      assert.equal(typeof command.name, 'string');
      assert.ok(['extension', 'prompt', 'skill'].includes(command.source));
      assert.equal(typeof command.sourceInfo, 'object');
      assert.equal(typeof command.sourceInfo.source, 'string');
      assert.equal(typeof command.sourceInfo.path, 'string');
    }

    const unknownCommand = 'ide_contract_unknown_中文🙂\u2028行\u2029段';
    const unknown = await request(unknownCommand);
    assert.ok(unknown.id);
    assert.equal(unknown.command, unknownCommand);
    assert.equal(unknown.success, false);
    assert.equal(unknown.error, `Unknown command: ${unknownCommand}`);
    const recovered = await request('get_state');
    assert.equal(data(recovered, 'get_state').sessionId, state.sessionId);
    assert.equal(new Set([...replies, unknown, recovered].map((reply) => reply.id)).size, 5);
    assert.deepEqual(diagnostics, [], 'read-only RPC must not produce protocol/process diagnostics');
    assert.deepEqual(JSON.parse(await readFile(join(agentDir, 'auth.json'), 'utf8')), {});
    passed = true;
    t.diagnostic('Real Pi protocol smoke passed without prompt/model calls or provider credentials.');
  } finally {
    const evidence = resolve('test-results/contract/real-pi-rpc.json');
    await client.dispose();
    await mkdir(dirname(evidence), { recursive: true });
    await writeFile(evidence, JSON.stringify({ passed, piVersion: PI_VERSION, cli, nodeVersion: process.version, exchanges, records, diagnostics }, null, 2));
  }
});
