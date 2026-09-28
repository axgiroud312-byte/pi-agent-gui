import { PiSessionLease } from '../../src/pi-agent/pi-session-lease.ts';

const lease = await PiSessionLease.acquire(process.argv[2]);
process.stdout.write('locked\n');
process.stdin.resume();
process.stdin.once('end', async () => { await lease.release(); process.exit(0); });
