// Separate Host process for the real supervisor lease race regression.
import { appendFileSync } from 'node:fs';
import { PiRpcClient } from '../../src/pi-agent/pi-rpc-client.ts';
import { PiSessionSupervisor } from '../../src/pi-agent/pi-session-supervisor.ts';

const [workspace, sessionFile, sessionId, marker, piEntry] = process.argv.slice(2);
const supervisor = new PiSessionSupervisor({
  piEntry,
  env: { PI_CODING_AGENT_DIR: `${workspace}/profile`, PI_OFFLINE: '1' },
  rpcArgs: ['--offline', '--no-extensions', '--no-skills', '--no-prompt-templates', '--no-context-files'],
  clientFactory: options => {
    appendFileSync(marker, `${process.pid}\n`);
    return new PiRpcClient(options);
  },
});
const closed = new Promise(resolve => {
  process.on('message', async message => {
    if (message !== 'close') return;
    await supervisor.dispose();
    process.disconnect();
    resolve();
  });
  process.on('disconnect', () => { void supervisor.dispose().then(resolve); });
});
try {
  const view = await supervisor.resumeSession(workspace, sessionFile, sessionId);
  process.send({ status: 'ready', piPid: view.pid });
} catch (error) {
  process.send({ status: 'rejected', error: String(error) });
}
await closed;
