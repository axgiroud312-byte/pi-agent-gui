import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ServiceCollection } from '../src/collection.js';
import { disposeServiceResourcesAndWait } from '../src/node.js';
import { ITerminalService } from '../src/terminal/terminal.js';
import { IZCodeAgentService } from '../src/zcode-agent/zcodeAgent.js';
import { IFileWatcherService } from '../src/fileWatcher/fileWatcher.js';

test('Host cleanup still waits for Pi and later services when an earlier owner fails', async () => {
  const services = new ServiceCollection();
  const failure = new Error('terminal cleanup failed');
  const events: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  services.register(ITerminalService, {
    disposeAllAndWait: async () => { events.push('terminal'); throw failure; },
  } as unknown as ITerminalService);
  services.register(IZCodeAgentService, {
    disposeAllAndWait: async () => { events.push('pi-start'); await gate; events.push('pi-finished'); },
  } as unknown as IZCodeAgentService);
  services.register(IFileWatcherService, {
    disposeAll: () => { events.push('watcher'); },
  } as unknown as IFileWatcherService);
  let settled = false;
  const result = disposeServiceResourcesAndWait(services).then(
    () => { settled = true; return undefined; },
    error => { settled = true; return error; },
  );
  // Drain promise microtasks, without a timing sleep that can conceal a race.
  for (let i = 0; i < 8; i++) await Promise.resolve();
  try {
    assert.deepEqual(events, ['terminal', 'pi-start']);
    assert.equal(settled, false, 'Host cleanup cannot return before Pi cleanup');
  } finally { release(); }
  const error = await result;
  assert.ok(error instanceof AggregateError);
  assert.ok(error.errors.includes(failure));
  assert.deepEqual(events, ['terminal', 'pi-start', 'pi-finished', 'watcher']);
});
