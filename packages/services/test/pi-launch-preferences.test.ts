import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { appSettingsPatchSchema, appSettingsSchema } from '@zcode/shared';
import { PiSessionSupervisor } from '../src/pi-agent/pi-session-supervisor.js';

test('desktop Pi startup preferences survive app settings validation', () => {
  const saved = appSettingsSchema.parse({ piOfflineMode: 'offline', piVersionCheckMode: 'skip' });
  const patch = appSettingsPatchSchema.parse({ piOfflineMode: 'online', piVersionCheckMode: 'check' });
  assert.equal((saved as Record<string, unknown>).piOfflineMode, 'offline');
  assert.equal((saved as Record<string, unknown>).piVersionCheckMode, 'skip');
  assert.equal((patch as Record<string, unknown>).piOfflineMode, 'online');
  assert.equal((patch as Record<string, unknown>).piVersionCheckMode, 'check');
});

test('explicit online and check choices remove inherited Pi env flags', async () => {
  const supervisor = new PiSessionSupervisor({
    piEntry: fileURLToPath(import.meta.resolve('@earendil-works/pi-coding-agent/rpc-entry')),
    env: { PI_OFFLINE: '1', PI_SKIP_VERSION_CHECK: '1' },
    launchPreferences: async () => ({ offline: 'online', versionCheck: 'check' }),
  });
  try {
    const { env } = await supervisor.settingsEnvironment();
    assert.equal(env.PI_OFFLINE, undefined);
    assert.equal(env.PI_SKIP_VERSION_CHECK, undefined);
  } finally {
    await supervisor.dispose();
  }
});

test('a new desktop session passes selected offline and update flags to the same fixed Pi child',
  { timeout: 40_000 }, async () => {
    const root = await mkdtemp(join(tmpdir(), 'pi-launch-preferences-'));
    const workspace = join(root, 'workspace');
    const profile = join(root, 'profile');
    const extension = join(profile, 'extensions', 'launch-probe.ts');
    const observedFile = join(root, 'observed.json');
    const piEntry = fileURLToPath(import.meta.resolve('@earendil-works/pi-coding-agent/rpc-entry'));
    const supervisor = new PiSessionSupervisor({ piEntry,
      env: { PI_CODING_AGENT_DIR: profile, PI_OFFLINE: '0', PI_SKIP_VERSION_CHECK: '0',
        PI_SETTINGS_PROBE_FILE: observedFile },
      rpcArgs: ['--no-skills', '--no-prompt-templates', '--no-context-files'],
      launchPreferences: async () => ({ offline: 'offline', versionCheck: 'skip' }),
    } as ConstructorParameters<typeof PiSessionSupervisor>[0]);
    try {
      await Promise.all([workspace, join(profile, 'extensions')].map(path => mkdir(path, { recursive: true })));
      await writeFile(join(profile, 'settings.json'), JSON.stringify({
        enableInstallTelemetry: false, extensions: [extension],
      }));
      await writeFile(extension, `import { writeFileSync } from 'node:fs';
export default function (pi) {
  pi.on('session_start', () => writeFileSync(process.env.PI_SETTINGS_PROBE_FILE,
    JSON.stringify({ offline: process.env.PI_OFFLINE,
      skipVersionCheck: process.env.PI_SKIP_VERSION_CHECK,
      cwd: process.cwd() })));
}\n`);
      const created = await supervisor.createSession(workspace);
      assert.equal(created.workspacePath, workspace);
      const observed = JSON.parse(await readFile(observedFile, 'utf8')) as {
        offline: string; skipVersionCheck: string; cwd: string;
      };
      assert.equal(observed.offline, '1');
      assert.equal(observed.skipVersionCheck, '1');
      assert.equal(resolve(observed.cwd), resolve(workspace));
    } finally {
      await supervisor.dispose();
      const target = resolve(root);
      assert(target.toLowerCase().startsWith(`${resolve(tmpdir()).toLowerCase()}${sep}`));
      assert(basename(target).startsWith('pi-launch-preferences-'));
      await rm(target, { recursive: true, force: true });
    }
  });
