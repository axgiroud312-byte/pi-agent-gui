import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { PiSessionSupervisor } from '../src/pi-agent/pi-session-supervisor.js';

test('closing a live Pi Agent tool bash aborts its child before releasing the session', { timeout: 30_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-agent-bash-'));
  const marker = join(root, 'agent-bash-pid');
  const script = "require('fs').writeFileSync('agent-bash-pid',String(process.pid));setInterval(()=>{},1000)";
  const command = `"${process.execPath.replaceAll('\\', '/')}" -e "${script}"`;
  let calls = 0;
  const server = createServer(async (req, res) => {
    for await (const _ of req) { /* drain model request */ }
    calls++;
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const delta = calls === 1 ? { role: 'assistant', tool_calls: [{ index: 0, id: 'call_pi_bash', type: 'function',
      function: { name: 'bash', arguments: JSON.stringify({ command }) } }] } : { role: 'assistant', content: 'finished' };
    const stream = (part: object, finish_reason: string | null) =>
      `data: ${JSON.stringify({ id: 'bash-contract', object: 'chat.completion.chunk', created: 1,
        model: 'bash-contract', choices: [{ index: 0, delta: part, finish_reason }] })}\n\n`;
    res.write(stream(delta, null));
    res.write(stream({}, calls === 1 ? 'tool_calls' : 'stop'));
    res.end('data: [DONE]\n\n');
  });
  let childPid: number | undefined;
  let supervisor: PiSessionSupervisor | undefined;
  try {
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const profile = join(root, 'profile');
    await mkdir(profile);
    await writeFile(join(profile, 'models.json'), JSON.stringify({ providers: {
      'bash-contract': { baseUrl: `http://127.0.0.1:${address.port}/v1`, api: 'openai-completions',
        apiKey: 'local-test-only', models: [{ id: 'bash-contract' }] },
    } }));
    supervisor = new PiSessionSupervisor({ piEntry: fileURLToPath(import.meta.resolve('@earendil-works/pi-coding-agent/rpc-entry')),
      env: { PI_CODING_AGENT_DIR: profile, PI_TELEMETRY: '0' },
      rpcArgs: ['--offline', '--no-extensions', '--no-skills', '--no-prompt-templates', '--no-context-files',
        '--provider', 'bash-contract', '--model', 'bash-contract'],
    });
    const view = await supervisor.createSession(root);
    assert.equal(await supervisor.sendText(view.sessionId, 'run Pi bash tool'), 'run');
    for (let attempt = 0; attempt < 120 && !existsSync(marker); attempt++) {
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.ok(existsSync(marker), 'Pi, not the test, must execute the bash tool');
    childPid = Number(await readFile(marker, 'utf8'));
    assert.ok(childPid > 0);
    await supervisor.closeSession(view.sessionId);
    let alive = true;
    for (let attempt = 0; attempt < 60; attempt++) {
      try { process.kill(childPid, 0); } catch { alive = false; break; }
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.equal(alive, false, 'Agent tool subprocess must exit as part of Pi close');
  } finally {
    await supervisor?.dispose();
    if (childPid) { try { process.kill(childPid, 'SIGKILL'); } catch { /* test-only failure cleanup */ } }
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 200 });
  }
});
