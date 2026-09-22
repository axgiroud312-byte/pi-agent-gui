import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const exec = promisify(execFile);
async function processes(f) {
  const systemRoot = f.env.SystemRoot ?? f.env.SYSTEMROOT ?? 'C:\\Windows';
  const { stdout } = await exec(join(systemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
    ['-NoProfile', '-NonInteractive', '-Command',
      'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,CreationDate | ConvertTo-Json -Compress'],
    { env: f.env, windowsHide: true, timeout: 15_000, maxBuffer: 4 * 1024 * 1024 });
  return JSON.parse(stdout || '[]');
}

export async function closeOwned(application, f) {
  if (!application) return { owned: [], survivors: [] };
  const mainPid = await application.evaluate(() => process.pid).catch(() => null);
  const entries = (await readFile(f.env.NATIVE_SMOKE_BOUNDARY_LOG, 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);
  const roots = new Set([application.process().pid, mainPid].filter(Boolean));
  const before = await processes(f);
  // Only identify current processes descended from our launch, not other Electron/Node apps.
  let changed = true;
  while (changed) {
    changed = false;
    for (const p of before) if (roots.has(p.ParentProcessId) && !roots.has(p.ProcessId)) {
      roots.add(p.ProcessId); changed = true;
    }
  }
  for (const p of before) {
    const at = Number(/\d+/.exec(p.CreationDate)?.[0]);
    const recorded = entries.some(entry => (entry.type === 'guard-active' ? entry.pid : entry.detail?.pid) === p.ProcessId
      && Math.abs(Date.parse(entry.at) - at) < 5000);
    if (recorded) roots.add(p.ProcessId);
  }
  const owned = before.filter(p => roots.has(p.ProcessId));
  let timer;
  await Promise.race([application.close().catch(() => {}), new Promise(resolve => { timer = setTimeout(resolve, 12_000); })]);
  clearTimeout(timer);
  const after = await processes(f);
  const remaining = after.filter(p => owned.some(o => o.ProcessId === p.ProcessId && o.CreationDate === p.CreationDate));
  for (const p of remaining) {
    await exec('taskkill.exe', ['/PID', String(p.ProcessId), '/T', '/F'], { env: f.env, windowsHide: true, timeout: 10_000 }).catch(() => {});
  }
  const final = remaining.length ? await processes(f) : [];
  return { owned, forced: remaining.map(p => p.ProcessId),
    survivors: final.filter(p => owned.some(o => o.ProcessId === p.ProcessId && o.CreationDate === p.CreationDate)) };
}
