import { mkdir, open, realpath, unlink } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { object } from './validation.js';

/** Cooperative single-writer lock. Existing/abandoned locks are never silently stolen. */
export async function acquireSessionLease(sessionFile: string): Promise<() => Promise<void>> {
  await mkdir(dirname(sessionFile), { recursive: true });
  const canonical = await realpath(sessionFile).catch(async error => {
    if (object(error).code !== 'ENOENT') throw error;
    return join(await realpath(dirname(sessionFile)), basename(sessionFile));
  });
  const lockPath = `${canonical}.pi-agent-ide.lock`;
  let handle;
  try { handle = await open(lockPath, 'wx', 0o600); }
  catch (error) {
    if (object(error).code === 'EEXIST') throw new Error(`原生会话已由其他宿主占用或存在未释放锁：${lockPath}。请新建会话；确认原宿主已退出后方可移除遗留锁。`);
    throw error;
  }
  try { await handle.writeFile(JSON.stringify({ pid: process.pid, nonce: randomUUID(), sessionFile: canonical })); }
  catch (error) { await handle.close(); await unlink(lockPath); throw error; }
  let releasePromise: Promise<void> | undefined;
  return () => releasePromise ??= (async () => {
    await handle.close();
    await unlink(lockPath).catch(error => { if (object(error).code !== 'ENOENT') throw error; });
  })();
}
