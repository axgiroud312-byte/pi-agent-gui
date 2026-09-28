import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { PiRpcClient, PI_TREE_CLEANUP_MS } from '../src/pi-agent/pi-rpc-client.js';
import { PiSessionLease } from '../src/pi-agent/pi-session-lease.js';
import { settlePiSessionBeforeClose } from '../src/pi-agent/pi-session-teardown.js';
import { runHostShutdownPhases } from '../../desktop/src/host/hostShutdownPhases.js';
import { resolveAppShutdownPolicy } from '../../desktop/src/main/appShutdownPolicy.js';
import { waitForHostOwnerExit } from '../../desktop/src/main/hostShutdownBarrier.js';

const fixture = fileURLToPath(new URL('./fixtures/pi-host-shutdown-hung.mjs', import.meta.url));
function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

async function waitForFile(file: string): Promise<void> {
  for (let i = 0; i < 150 && !existsSync(file); i++)
    await new Promise(resolve => setTimeout(resolve, 20));
  assert.ok(existsSync(file), 'Agent bash child must have started');
}

for (const hang of ['clear', 'abort']) test(`Host owner waits past phase alarm: hung ${hang} cannot strand Agent bash or release lease early`,
  { timeout: 45_000 }, async () => {
    const root = await mkdtemp(join(tmpdir(), 'pi-host-shutdown-'));
    const pidFile = join(root, 'agent-bash.pid');
    const sessionFile = join(root, 'session.jsonl');
    const client = new PiRpcClient({ executable: process.execPath, args: [fixture], cwd: root,
      env: { PI_HOST_TEST_PID_FILE: pidFile, PI_HOST_TEST_HANG: hang } });
    let childPid: number | undefined;
    let lease: PiSessionLease | undefined;
    try {
      lease = await PiSessionLease.acquire(sessionFile);
      await lease.markRuntimeUncertain(); // durable gate precedes spawn
      await client.start();
      assert.equal((await client.request({ type: 'prompt', message: 'start agent bash' })).success, true);
      await waitForFile(pidFile);
      childPid = Number(await readFile(pidFile, 'utf8'));
      assert.ok(alive(childPid));
      let settled = false;
      const host = new EventEmitter();
      let mainSettled = false;
      let mainAlarms = 0;
      const mainWait = waitForHostOwnerExit(host, 'pi-host', 5, () => { mainAlarms++; })
        .then(() => { mainSettled = true; });
      const phases = runHostShutdownPhases([{ name: 'service-dispose', timeoutMs: 5, mustComplete: true,
        run: async () => {
          try { await settlePiSessionBeforeClose(client, true); }
          catch { /* fault-injected Pi never ACKs cancellation; force tree cleanup */ }
          await client.dispose();
          await lease!.release();
        },
      }], { phaseTimeoutMs: 5, log() {} }).then(result => { settled = true; return result; });
      await new Promise(resolve => setTimeout(resolve, 40));
      assert.equal(settled, false, 'phase timeout must not let Host process.exit while tree is owned');
      assert.equal(mainSettled, false, 'Main budget must not release app quit before Host exits');
      assert.equal(mainAlarms, 1);
      assert.ok(alive(childPid));
      await assert.rejects(PiSessionLease.acquire(sessionFile), /quarantined|already owned/);
      const result = await phases;
      assert.deepEqual(result.timedOutPhases, ['service-dispose']);
      assert.equal(alive(childPid), false, 'OS child tree must be gone when Host barrier resolves');
      assert.equal(mainSettled, false, 'Main must still await actual Host exit');
      host.emit('exit');
      await mainWait;
      assert.equal(mainSettled, true);
      const successor = await PiSessionLease.acquire(sessionFile);
      await successor.release();
      const main = resolveAppShutdownPolicy('normal', process.platform);
      assert.ok(main.forceKillDelayMs > 21_000 + PI_TREE_CLEANUP_MS && main.waitTimeoutMs > main.forceKillDelayMs);
    } finally {
      await client.dispose().catch(() => {});
      await lease?.release().catch(() => {});
      if (childPid && alive(childPid)) { try { process.kill(childPid, 'SIGKILL'); } catch {} }
      await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  });

test('concurrent dispose calls share a flight; failed verification retries instead of caching rejection', async () => {
  const client = new PiRpcClient({ executable: process.execPath, args: [], cwd: process.cwd() });
  let attempts = 0;
  const target = client as unknown as { cleanupOwnedTree: () => Promise<void> };
  target.cleanupOwnedTree = async () => {
    attempts++;
    if (attempts === 1) throw new Error('identity unavailable');
  };
  const a = client.dispose();
  assert.equal(client.dispose(), a);
  await assert.rejects(a, /identity unavailable/);
  await client.dispose();
  assert.equal(attempts, 2);
});
