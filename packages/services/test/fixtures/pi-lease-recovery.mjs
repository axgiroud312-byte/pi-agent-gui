import { createHash, randomUUID } from 'node:crypto';
import { link, open, readFile, unlink } from 'node:fs/promises';
import { PiSessionLease } from '../../src/pi-agent/pi-session-lease.ts';

const [mode, sessionFile] = process.argv.slice(2);
const lock = `${sessionFile}.pi-agent-ide.lock`;
if (mode === 'mark-and-crash') {
  const lease = await PiSessionLease.acquire(sessionFile);
  await lease.markRuntimeUncertain();
  process.stdout.write('marked\n');
} else if (mode === 'claim-and-crash') {
  const { token } = JSON.parse(await readFile(lock, 'utf8'));
  const path = `${lock}.recover-${createHash('sha256').update(token).digest('hex')}`;
  const temp = `${path}.${randomUUID()}.tmp`;
  const handle = await open(temp, 'wx');
  try {
    await handle.writeFile(JSON.stringify({ pid: process.pid, token: randomUUID() }));
  } finally {
    await handle.close();
  }
  await link(temp, path);
  await unlink(temp);
  process.stdout.write('claimed\n');
} else if (mode === 'legacy-pause') {
  const handle = await open(lock, 'wx');
  process.stdout.write('opened\n');
  process.stdin.resume();
  process.stdin.once('end', async () => {
    await handle.writeFile(JSON.stringify({ pid: process.pid, token: randomUUID() }));
    await handle.close();
    process.stdout.write('written\n');
  });
} else if (mode === 'hold') {
  try {
    const lease = await PiSessionLease.acquire(sessionFile);
    process.stdout.write('locked\n');
    process.stdin.resume();
    process.stdin.once('end', async () => { await lease.release(); process.exit(0); });
  } catch (error) {
    process.stdout.write(`rejected: ${error.message}\n`);
  }
} else {
  throw new Error(`Unknown lease fixture mode: ${mode}`);
}
