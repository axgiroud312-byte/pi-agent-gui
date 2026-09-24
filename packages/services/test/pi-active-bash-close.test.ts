import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { PiSessionSupervisor } from '../src/pi-agent/pi-session-supervisor.js';
import { PiRpcClient } from '../src/pi-agent/pi-rpc-client.js';

test('closing a live Pi session reaps its active bash descendant without harness cleanup',
  { timeout: 25_000 }, async () => {
    const root = await mkdtemp(join(tmpdir(), 'pi-live-bash-'));
    const marker = join(root, 'bash-child-pid');
    const piEntry = fileURLToPath(import.meta.resolve('@earendil-works/pi-coding-agent/rpc-entry'));
    const supervisor = new PiSessionSupervisor({ piEntry,
      env: { PI_CODING_AGENT_DIR: join(root, 'profile'), PI_TELEMETRY: '0' },
      rpcArgs: ['--offline', '--no-extensions', '--no-skills', '--no-prompt-templates', '--no-context-files'],
    });
    let childPid: number | undefined;
    try {
      const view = await supervisor.createSession(root);
      const runtime = (supervisor as unknown as { sessions: Map<string, { client: PiRpcClient }> }).sessions.get(view.sessionId)!;
      const script = "require('fs').writeFileSync('bash-child-pid', String(process.pid));setInterval(()=>{},1000)";
      const cmd = `"${process.execPath.replaceAll('\\', '/')}" -e "${script.replaceAll('"', '\\"')}"`;
      const pending = runtime.client.request({ type: 'bash', command: cmd }, 15_000)
        .catch(error => ({ error: String(error) }));
      for (let attempt = 0; attempt < 100 && !existsSync(marker); attempt++) {
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      assert.ok(existsSync(marker), `Pi bash must start a real long-lived child: ${JSON.stringify(await Promise.race([
        pending, new Promise(resolve => setTimeout(() => resolve('still running'), 100)),
      ]))}`);
      childPid = Number(await readFile(marker, 'utf8'));
      assert.ok(Number.isSafeInteger(childPid) && childPid > 0);
      await supervisor.closeSession(view.sessionId);
      const bashResult = await pending;
      let alive = true;
      for (let attempt = 0; attempt < 60; attempt++) {
        try { process.kill(childPid, 0); }
        catch { alive = false; break; }
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      assert.equal(alive, false, `Pi close must not leave its executing bash child alive: ${JSON.stringify(bashResult)}`);
    } finally {
      await supervisor.dispose();
      // Only failure cleanup, never evidence of successful product teardown.
      if (childPid) { try { process.kill(childPid, 'SIGKILL'); } catch { /* already exited */ } }
      await rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 200 });
    }
  });
