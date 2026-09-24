import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const exec = promisify(execFile);
async function bounded(promise, timeoutMs, fallback) {
  let timer;
  try {
    return await Promise.race([
      promise.catch(() => fallback),
      new Promise(resolve => { timer = setTimeout(() => resolve(fallback), timeoutMs); }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
function creationTime(value) {
  const wrapped = /^\/Date\((\d+)(?:[+-]\d+)?\)\/$/.exec(value);
  return wrapped ? Number(wrapped[1]) : Date.parse(value);
}
export async function processes(f) {
  const systemRoot = f.env.SystemRoot ?? f.env.SYSTEMROOT ?? 'C:\\Windows';
  const psHome = join(systemRoot, 'System32/WindowsPowerShell/v1.0');
  // The runner uses a deliberately empty HOME. Resolve the system CIM module
  // explicitly and allow its cold start without widening access to user modules.
  const command = "$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'; "
    + "[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false); "
    + 'Get-CimInstance -ClassName Win32_Process -Property ProcessId,ParentProcessId,CreationDate -OperationTimeoutSec 30 '
    + '| Select-Object ProcessId,ParentProcessId,CreationDate | ConvertTo-Json -Compress';
  try {
    const { stdout } = await exec(join(psHome, 'powershell.exe'),
      ['-NoProfile', '-NonInteractive', '-Command', command],
      { env: { ...f.env, PSModulePath: join(psHome, 'Modules') }, windowsHide: true, timeout: 60_000, maxBuffer: 4 * 1024 * 1024 });
    const parsed = JSON.parse(stdout.trim() || '[]');
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch (error) {
    throw new Error(`Process inventory failed: ${JSON.stringify({
      code: error.code, signal: error.signal, killed: error.killed,
      stdout: error.stdout, stderr: error.stderr, message: error.message,
    })}`, { cause: error });
  }
}

export async function closeOwned(application, f) {
  if (!application) return { owned: [], survivors: [] };
  const mainPid = await bounded(application.evaluate(() => process.pid), 10_000, null);
  const entries = (await readFile(f.env.NATIVE_SMOKE_BOUNDARY_LOG, 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);
  const roots = new Set([application.process().pid, mainPid].filter(Boolean));
  const before = await processes(f);
  // A Windows parent PID survives in CIM after that parent exits. Reject older
  // processes attached to a reused PID, including at each descendant level.
  for (const p of before) {
    const at = creationTime(p.CreationDate);
    const recorded = entries.some(entry => (entry.type === 'guard-active' ? entry.pid : entry.detail?.pid) === p.ProcessId
      && Math.abs(Date.parse(entry.at) - at) < 5000);
    if (recorded) roots.add(p.ProcessId);
  }
  const created = new Map(before.filter(p => roots.has(p.ProcessId))
    .map(p => [p.ProcessId, creationTime(p.CreationDate)]));
  let changed = true;
  while (changed) {
    changed = false;
    for (const p of before) {
      const parentAt = created.get(p.ParentProcessId);
      const at = creationTime(p.CreationDate);
      if (parentAt !== undefined && Number.isFinite(at) && at >= parentAt && !created.has(p.ProcessId)) {
        created.set(p.ProcessId, at); changed = true;
      }
    }
  }
  const owned = before.filter(p => created.has(p.ProcessId));
  const child = application.process();
  let exitTimer;
  const exited = child.exitCode !== null || child.signalCode !== null
    ? Promise.resolve(true)
    : new Promise(resolve => {
      child.once('exit', () => resolve(true));
      // Main's 80s Host-owner wait is part of a normal quit. A 12s Playwright
      // close could kill Main first and leave a quarantined Pi lease behind.
      exitTimer = setTimeout(() => resolve(false), 95_000);
    });
  await bounded(application.evaluate(({ app }) => { setImmediate(() => app.quit()); }), 10_000, null);
  const graceful = await exited;
  if (exitTimer) clearTimeout(exitTimer);
  if (!graceful) await bounded(application.close(), 10_000, null);
  const after = await processes(f);
  const remaining = after.filter(p => owned.some(o => o.ProcessId === p.ProcessId && o.CreationDate === p.CreationDate));
  for (const p of remaining) {
    await exec('taskkill.exe', ['/PID', String(p.ProcessId), '/T', '/F'], { env: f.env, windowsHide: true, timeout: 10_000 }).catch(() => {});
  }
  const final = remaining.length ? await processes(f) : [];
  return { graceful, owned, forced: remaining.map(p => p.ProcessId),
    survivors: final.filter(p => owned.some(o => o.ProcessId === p.ProcessId && o.CreationDate === p.CreationDate)) };
}

export function assertCleanExit(cleanup, logs, stage) {
  assert(cleanup.owned.length >= 3, `${stage} process inventory must include Electron/Pi descendants`);
  assert.equal(cleanup.graceful, true, `${stage} app quit must wait for Host-owned cleanup`);
  assert.deepEqual(cleanup.forced, [], `${stage} app quit must not force-kill a Pi owner`);
  assert.deepEqual(cleanup.survivors, [], `${stage} Host and Pi process must exit`);
  assert(!logs.join('').includes('host shutdown phase failed'), `${stage} Host service disposal must succeed`);
}
