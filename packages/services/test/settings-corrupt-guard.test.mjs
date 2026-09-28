import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

async function withProfile(run) {
  const root = await fsp.mkdtemp(join(tmpdir(), 'pi-corrupt-settings-'));
  const previous = process.env.ZCODE_DESKTOP_PROFILE_HOME;
  process.env.ZCODE_DESKTOP_PROFILE_HOME = root;
  const settingsPath = join(root, '.zcode', 'v2', 'setting.json');
  await fsp.mkdir(dirname(settingsPath), { recursive: true });
  try { await run({ root, settingsPath }); }
  finally {
    if (previous === undefined) delete process.env.ZCODE_DESKTOP_PROFILE_HOME;
    else process.env.ZCODE_DESKTOP_PROFILE_HOME = previous;
    assert.equal(dirname(resolve(root)).toLowerCase(), resolve(tmpdir()).toLowerCase());
    await fsp.rm(root, { recursive: true, force: true });
  }
}

test('schema-invalid setting.json refuses ordinary reads/writes without losing other original fields',
  async () => withProfile(async ({ root, settingsPath }) => {
    const original = JSON.stringify({ recentProjects: ['D:/retained-project'],
      lastWorkspaceSession: 'damaged-field', receivePreviewUpdates: true,
      piOfflineMode: 'offline' });
    await fsp.writeFile(settingsPath, original);
    const { createSettingServiceWithMigrations } = await import('../src/setting/settingService.ts');
    const { service: settings, readStrictSettings } = createSettingServiceWithMigrations();
    assert.deepEqual((await settings.get()).recentProjects, []);
    const readStatus = await settings.getReadStatus();
    const writeError = await settings.update({ receivePreviewUpdates: false }).then(() => null, error => error);
    assert.equal(readStatus.kind, 'degraded');
    assert(readStatus.message.includes(settingsPath));
    assert.match(String(writeError), /setting\.json|invalid settings|corrupt/i);
    assert(String(writeError).includes(settingsPath));
    const migrationTarget = join(root, 'new-data-root');
    await assert.rejects(settings.updateDataBaseDir(migrationTarget), /setting\.json|invalid settings/i);
    await assert.rejects(fsp.stat(migrationTarget), { code: 'ENOENT' });
    const { PiSessionSupervisor } = await import('../src/pi-agent/pi-session-supervisor.ts');
    const supervisor = new PiSessionSupervisor({
      piEntry: fileURLToPath(import.meta.resolve('@earendil-works/pi-coding-agent/rpc-entry')),
      env: { PI_OFFLINE: '0' },
      launchPreferences: async () => {
        const value = await readStrictSettings();
        return { offline: value.piOfflineMode ?? 'inherit',
          versionCheck: value.piVersionCheckMode ?? 'inherit' };
      },
    });
    try { await assert.rejects(supervisor.settingsEnvironment(), /setting\.json|invalid settings/i); }
    finally { await supervisor.dispose(); }
    assert.equal(await fsp.readFile(settingsPath, 'utf8'), original);
  }));

test('non-ENOENT read fault refuses update and preserves valid setting.json bytes',
  async () => withProfile(async ({ settingsPath }) => {
    const original = JSON.stringify({ recentProjects: ['D:/retained-project'], receivePreviewUpdates: true });
    await fsp.writeFile(settingsPath, original);
    const { createSettingService } = await import('../src/setting/settingService.ts');
    const settings = createSettingService();
    const readFile = fsp.readFile;
    let hits = 0;
    fsp.readFile = async (path, ...args) => {
      if (String(path) === settingsPath && hits < 2) {
        hits++;
        const failure = new Error('injected transient read failure');
        failure.code = 'EACCES';
        throw failure;
      }
      return readFile(path, ...args);
    };
    syncBuiltinESMExports();
    try {
      assert.deepEqual((await settings.get()).recentProjects, []);
      const readStatus = await settings.getReadStatus();
      const writeError = await settings.update({ receivePreviewUpdates: false }).then(() => null, error => error);
      assert.equal(hits, 2, 'both reads must encounter the injected filesystem error');
      assert.equal(readStatus.kind, 'degraded');
      assert(readStatus.message.includes(settingsPath));
      assert.match(String(writeError), /setting\.json|read|EACCES/i);
      assert(String(writeError).includes(settingsPath));
    } finally {
      fsp.readFile = readFile;
      syncBuiltinESMExports();
    }
    assert.equal(await fsp.readFile(settingsPath, 'utf8'), original);
  }));

test('malformed JSON still retains recoverable backup before saving defaults',
  async () => withProfile(async ({ root, settingsPath }) => {
    const original = '{"recentProjects":["D:/retained-project"],oops';
    await fsp.writeFile(settingsPath, original);
    const { createSettingService } = await import('../src/setting/settingService.ts');
    const settings = createSettingService();
    assert.deepEqual((await settings.get()).recentProjects, []);
    const backups = (await fsp.readdir(dirname(settingsPath)))
      .filter(name => name.startsWith('setting.json.corrupt-'));
    assert.equal(backups.length, 1);
    assert.equal(await fsp.readFile(join(dirname(settingsPath), backups[0]), 'utf8'), original);
    const status = await settings.getReadStatus();
    assert.equal(status.kind, 'degraded');
    assert.equal(status.backupPath, join(dirname(settingsPath), backups[0]));
    await assert.rejects(settings.update({ receivePreviewUpdates: false }), /backed up|repair/i);
    const restarted = createSettingService();
    assert.deepEqual((await restarted.get()).recentProjects, []);
    assert.equal((await restarted.getReadStatus()).backupPath, status.backupPath);
    await assert.rejects(restarted.update({ receivePreviewUpdates: false }), /backed up|repair/i);
    await fsp.writeFile(settingsPath, JSON.stringify({ recentProjects: ['D:/retained-project'] }));
    await restarted.get();
    assert.equal((await restarted.getReadStatus()).kind, 'ready');
    await restarted.update({ receivePreviewUpdates: false });
    assert.deepEqual(JSON.parse(await fsp.readFile(settingsPath, 'utf8')).recentProjects,
      ['D:/retained-project']);
    assert.equal(root.startsWith(tmpdir()), true);
  }));

test('malformed JSON refuses defaults if its backup cannot be created',
  async () => withProfile(async ({ settingsPath }) => {
    const original = '{"recentProjects":["D:/retained-project"],oops';
    await fsp.writeFile(settingsPath, original);
    const { createSettingService } = await import('../src/setting/settingService.ts');
    const settings = createSettingService();
    const rename = fsp.rename;
    let hits = 0;
    fsp.rename = async (source, ...args) => {
      if (String(source) === settingsPath) {
        hits++;
        const failure = new Error('injected backup denial');
        failure.code = 'EACCES';
        throw failure;
      }
      return rename(source, ...args);
    };
    syncBuiltinESMExports();
    try {
      assert.deepEqual((await settings.get()).recentProjects, []);
      await assert.rejects(settings.update({ receivePreviewUpdates: false }),
        /backup|backed up|preserved|repair/i);
      assert.equal(hits >= 2, true);
    } finally {
      fsp.rename = rename;
      syncBuiltinESMExports();
    }
    assert.equal(await fsp.readFile(settingsPath, 'utf8'), original);
  }));

test('valid older settings migrate while keeping real project values',
  async () => withProfile(async ({ settingsPath }) => {
    await fsp.writeFile(settingsPath, JSON.stringify({ recentProjects: ['D:/retained-project'],
      lastWorkspaceSession: [], receivePreviewUpdates: true }));
    const { createSettingService } = await import('../src/setting/settingService.ts');
    const settings = createSettingService();
    const loaded = await settings.get();
    assert.deepEqual(loaded.recentProjects, ['D:/retained-project']);
    await settings.update({ receivePreviewUpdates: false });
    const saved = JSON.parse(await fsp.readFile(settingsPath, 'utf8'));
    assert.deepEqual(saved.recentProjects, ['D:/retained-project']);
    assert.equal(saved.receivePreviewUpdates, false);
    assert.equal(saved.closeToTrayOnWindowsMigrationInitialized, true);
    assert.equal(saved.messageStreamShowReasoningMigrationInitialized, true);
    assert.equal((await settings.getReadStatus()).kind, 'ready');
  }));

test('first installation without setting.json or recovery backup accepts its initial defaults',
  async () => withProfile(async ({ settingsPath }) => {
    const { createSettingServiceWithMigrations } = await import('../src/setting/settingService.ts');
    const { service: settings, readStrictSettings } = createSettingServiceWithMigrations();
    assert.deepEqual((await settings.get()).recentProjects, []);
    assert.equal((await settings.getReadStatus()).kind, 'ready');
    assert.equal((await readStrictSettings()).piOfflineMode, 'inherit');
    await settings.update({ receivePreviewUpdates: false });
    assert.equal(JSON.parse(await fsp.readFile(settingsPath, 'utf8')).receivePreviewUpdates, false);
  }));
