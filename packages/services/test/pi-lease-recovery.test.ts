import assert from 'node:assert/strict';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { PiSessionLease } from '../src/pi-agent/pi-session-lease.js';

const fixture = fileURLToPath(new URL('./fixtures/pi-lease-recovery.mjs', import.meta.url));
const spawnFixture = (mode: string, file: string) => spawn(process.execPath,
  ['--import', import.meta.resolve('tsx'), fixture, mode, file],
  { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, windowsHide: true });

function result(child: ChildProcessWithoutNullStreams): Promise<string> {
  return new Promise((resolve, reject) => {
    let output = '';
    let errors = '';
    child.stdout.on('data', chunk => { output += String(chunk); });
    child.stderr.on('data', chunk => { errors += String(chunk); });
    child.once('error', reject);
    child.once('close', code => code === 0 ? resolve(output.trim()) : reject(new Error(`${code}: ${output} ${errors}`)));
  });
}

function firstMessage(child: ChildProcessWithoutNullStreams): Promise<string> {
  return new Promise((resolve, reject) => {
    child.stdout.once('data', chunk => resolve(String(chunk).trim()));
    child.once('error', reject);
    child.once('close', code => reject(new Error(`Contender exited without a result: ${code}`)));
  });
}

async function withSession(run: (file: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'pi-lease-recovery-'));
  try { await run(join(root, 'session.jsonl')); }
  finally { await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
}

const lockPath = (file: string) => `${file}.pi-agent-ide.lock`;
const deadOwner = () => ({ pid: 999999, token: randomUUID() });

test('legacy empty and partial main locks fail closed; new owners publish a complete record', async () => {
  await withSession(async file => {
    const path = lockPath(file);
    for (const value of ['', '{"pid":999999,"token":']) {
      await writeFile(path, value);
      await assert.rejects(PiSessionLease.acquire(file), /already owned|incomplete|ambiguous/);
      assert.equal(await readFile(path, 'utf8'), value);
    }
    await rm(path);
    const lease = await PiSessionLease.acquire(file);
    const value = JSON.parse(await readFile(path, 'utf8'));
    assert.equal(value.pid, process.pid);
    assert.equal(typeof value.token, 'string');
    assert.ok(value.token.length > 0);
    await lease.release();
  });
});

test('an ownerless legacy recovery file fails closed even with a stale main owner', async () => {
  await withSession(async file => {
    await writeFile(lockPath(file), JSON.stringify(deadOwner()));
    await writeFile(`${lockPath(file)}.recover`, '');
    await assert.rejects(PiSessionLease.acquire(file), /incomplete|ambiguous/);
    assert.equal(await readFile(`${lockPath(file)}.recover`, 'utf8'), '');
  });
});

test('a live legacy writer paused between wx and owner write cannot lose its lock', { timeout: 20_000 }, async () => {
  await withSession(async file => {
    const writer = spawnFixture('legacy-pause', file);
    try {
      assert.equal(await firstMessage(writer), 'opened');
      await assert.rejects(PiSessionLease.acquire(file), /already owned|incomplete|ambiguous/);
      assert.equal(await readFile(lockPath(file), 'utf8'), '');
      writer.stdin.end();
      assert.equal(await result(writer), 'written');
      assert.equal(JSON.parse(await readFile(lockPath(file), 'utf8')).pid, writer.pid);
    } finally { writer.kill(); }
  });
});

test('stale recovery claim from a crashed process can be passed without reusing its pathname', { timeout: 20_000 }, async () => {
  await withSession(async file => {
    await writeFile(lockPath(file), JSON.stringify(deadOwner()));
    // A previous recovery process crashed after publishing its owner-bearing claim.
    await writeFile(`${lockPath(file)}.recover`, JSON.stringify(deadOwner()));
    const crash = spawnFixture('claim-and-crash', file);
    assert.equal(await result(crash), 'claimed');
    const recovered = await PiSessionLease.acquire(file);
    assert.equal(JSON.parse(await readFile(lockPath(file), 'utf8')).pid, process.pid);
    assert.ok((await readdir(join(file, '..'))).some(name => name.includes('.recover-')));
    await recovered.release();
  });
});

test('multiple processes racing over stale owner have exactly one live winner', { timeout: 40_000 }, async () => {
  await withSession(async file => {
    await writeFile(lockPath(file), JSON.stringify(deadOwner()));
    await writeFile(`${lockPath(file)}.recover`, JSON.stringify(deadOwner()));
    const contenders = Array.from({ length: 6 }, () => spawnFixture('hold', file));
    try {
      const outputs = await Promise.all(contenders.map(firstMessage));
      assert.equal(outputs.filter(output => output === 'locked').length, 1, outputs.join(', '));
      assert.equal(outputs.filter(output => output.startsWith('rejected:')).length, 5, outputs.join(', '));
      const winner = contenders[outputs.indexOf('locked')];
      assert.equal(JSON.parse(await readFile(lockPath(file), 'utf8')).pid, winner.pid);
      winner.stdin.end();
      await new Promise<void>(resolve => winner.once('close', () => resolve()));
      const next = await PiSessionLease.acquire(file);
      await next.release();
    } finally {
      for (const child of contenders) { child.stdin.end(); child.kill(); }
    }
  });
});

test('a reused live PID cannot be mistaken for a dead owner', async () => {
  await withSession(async file => {
    await writeFile(lockPath(file), JSON.stringify({ pid: process.pid, token: randomUUID() }));
    await assert.rejects(PiSessionLease.acquire(file), /already owned/);
  });
});

test('a Host dying after the pre-spawn mark cannot cause automatic stale recovery', { timeout: 20_000 }, async () => {
  await withSession(async file => {
    const child = spawnFixture('mark-and-crash', file);
    assert.equal(await result(child), 'marked');
    const path = lockPath(file);
    const owner = JSON.parse(await readFile(path, 'utf8'));
    const marker = JSON.parse(await readFile(`${path}.runtime-uncertain`, 'utf8'));
    assert.equal(marker.token, owner.token);
    assert.equal(marker.pid, child.pid);
    await assert.rejects(PiSessionLease.acquire(file), /quarantined|manual verification/);
    // Even removal of the old main lock by an outsider must not bypass quarantine.
    await rm(path);
    await assert.rejects(PiSessionLease.acquire(file), /quarantined|manual verification/);
  });
});

test('incomplete marker fails closed rather than becoming an unmarked stale recovery', async () => {
  await withSession(async file => {
    await writeFile(lockPath(file), JSON.stringify(deadOwner()));
    await writeFile(`${lockPath(file)}.runtime-uncertain`, '{"pid":');
    await assert.rejects(PiSessionLease.acquire(file), /quarantined|incomplete|ambiguous/);
  });
});

test('quarantined release retries marker unlink and does not clear another token', async () => {
  await withSession(async file => {
    const lease = await PiSessionLease.acquire(file);
    await lease.markRuntimeUncertain();
    const markerPath = `${lockPath(file)}.runtime-uncertain`;
    const seam = lease as unknown as { unlinkRuntimeMarker(): Promise<void> };
    const actual = seam.unlinkRuntimeMarker;
    let fails = 1;
    seam.unlinkRuntimeMarker = async () => {
      if (fails--) throw Object.assign(new Error('simulated marker unlink failure'), { code: 'EACCES' });
      return actual.call(lease);
    };
    await assert.rejects(lease.release(), /simulated marker unlink failure/);
    assert.equal(JSON.parse(await readFile(markerPath, 'utf8')).pid, process.pid);
    await assert.rejects(PiSessionLease.acquire(file), /quarantined|manual verification/);
    await lease.release(); // Test process has spawned no Pi or tool descendants.
    await assert.rejects(readFile(markerPath, 'utf8'), { code: 'ENOENT' });
    const next = await PiSessionLease.acquire(file);
    await next.release();
  });
});

test('release never removes a quarantine marker or main lock belonging to another token', async () => {
  await withSession(async file => {
    const lease = await PiSessionLease.acquire(file);
    await lease.markRuntimeUncertain();
    const path = lockPath(file);
    const markerPath = `${path}.runtime-uncertain`;
    const foreign = { pid: process.pid, token: randomUUID() };
    await writeFile(markerPath, JSON.stringify(foreign));
    await assert.rejects(lease.release(), /another owner/);
    assert.deepEqual(JSON.parse(await readFile(markerPath, 'utf8')), foreign);
    assert.notEqual(JSON.parse(await readFile(path, 'utf8')).token, foreign.token);
    // A foreign main lock under our old marker must not be unlinked either.
    await writeFile(markerPath, await readFile(path, 'utf8'));
    await writeFile(path, JSON.stringify(foreign));
    await assert.rejects(lease.release(), /no matching owned lock/);
    assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), foreign);
  });
});

test('marker removal succeeds but main unlink fails: retry completes without erasing a new owner', async () => {
  await withSession(async file => {
    const lease = await PiSessionLease.acquire(file);
    await lease.markRuntimeUncertain();
    const seam = lease as unknown as { unlinkOwned(): Promise<void> };
    const actual = seam.unlinkOwned;
    let fails = 1;
    seam.unlinkOwned = async () => {
      if (fails--) throw Object.assign(new Error('simulated lock unlink failure'), { code: 'EACCES' });
      return actual.call(lease);
    };
    await assert.rejects(lease.release(), /simulated lock unlink failure/);
    await assert.rejects(readFile(`${lockPath(file)}.runtime-uncertain`, 'utf8'), { code: 'ENOENT' });
    assert.equal(JSON.parse(await readFile(lockPath(file), 'utf8')).pid, process.pid);
    await lease.release(); // Safe retry after marker removal; no runtime was created.
    const next = await PiSessionLease.acquire(file);
    await next.release();
  });
});

test('release keeps ownership on unlink failure and can be retried', async () => {
  await withSession(async file => {
    const lease = await PiSessionLease.acquire(file);
    const seam = lease as unknown as { unlinkOwned(): Promise<void> };
    const actual = seam.unlinkOwned;
    let fails = 1;
    seam.unlinkOwned = async () => {
      if (fails--) throw Object.assign(new Error('simulated unlink failure'), { code: 'EACCES' });
      return actual.call(lease);
    };
    await assert.rejects(lease.release(), /simulated unlink failure/);
    await assert.rejects(PiSessionLease.acquire(file), /already owned/);
    await lease.release();
    const next = await PiSessionLease.acquire(file);
    await next.release();
  });
});
