import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

for await (const line of createInterface({ input: process.stdin })) {
  const request = JSON.parse(line);
  if (request.type === 'clear_queue' && process.env.PI_HOST_TEST_HANG === 'abort') {
    process.stdout.write(JSON.stringify({ type: 'response', id: request.id, command: request.type, success: true }) + '\n');
    continue;
  }
  if (request.type !== 'prompt') continue;
  // Mimic an Agent-owned bash child, not a direct RPC bash request. Detached
  // stdio makes a root-only kill incapable of waiting for its exit.
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    stdio: 'ignore', windowsHide: true,
  });
  writeFileSync(process.env.PI_HOST_TEST_PID_FILE, String(child.pid));
  process.stdout.write(JSON.stringify({ type: 'response', id: request.id, command: 'prompt', success: true }) + '\n');
  // The selected clear_queue or abort and abort_bash intentionally never ACK.
}
