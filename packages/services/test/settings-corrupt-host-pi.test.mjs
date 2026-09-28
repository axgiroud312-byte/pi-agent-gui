import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

test('desktop Host injection rejects Pi createSession when saved network policy cannot be read',
  { timeout: 60_000 }, async () => {
    const root = await mkdtemp(join(tmpdir(), 'pi-corrupt-host-'));
    const prior = Object.fromEntries(['ZCODE_DESKTOP_PROFILE_HOME', 'PI_CODING_AGENT_DIR',
      'PI_OFFLINE', 'PI_TELEMETRY'].map(key => [key, process.env[key]]));
    const piProfile = join(root, 'pi');
    const workspacePath = join(root, 'workspace');
    const settingsPath = join(root, '.zcode', 'v2', 'setting.json');
    let modelRequests = 0;
    const model = createServer(async (request, response) => {
      modelRequests++;
      for await (const _ of request) { /* drain */ }
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.end('data: [DONE]\n\n');
    });
    let services;
    try {
      await new Promise(resolve => model.listen(0, '127.0.0.1', resolve));
      const address = model.address();
      assert(address && typeof address !== 'string');
      await Promise.all([dirname(settingsPath), piProfile, workspacePath].map(path =>
        mkdir(path, { recursive: true })));
      process.env.ZCODE_DESKTOP_PROFILE_HOME = root;
      process.env.PI_CODING_AGENT_DIR = piProfile;
      process.env.PI_OFFLINE = '0';
      process.env.PI_TELEMETRY = '0';
      await writeFile(join(piProfile, 'models.json'), JSON.stringify({ providers: {
        'guard-provider': { baseUrl: `http://127.0.0.1:${address.port}/v1`,
          api: 'openai-completions', apiKey: 'loopback-only', models: [{ id: 'local' }] },
      } }));
      await writeFile(join(piProfile, 'settings.json'), JSON.stringify({
        defaultProvider: 'guard-provider', defaultModel: 'local',
      }));
      const original = JSON.stringify({ piOfflineMode: 'offline',
        lastWorkspaceSession: 'invalid-single-field', recentProjects: [workspacePath] });
      await writeFile(settingsPath, original);
      const { createSettingServiceWithMigrations } = await import('../src/setting/settingService.ts');
      const { service: settingService, readStrictSettings } = createSettingServiceWithMigrations();
      const { createLocalServices, disposeServiceResourcesAndWait } = await import('../src/node.ts');
      const { IZCodeAgentService } = await import('../src/zcode-agent/zcodeAgent.ts');
      services = createLocalServices({ settingService, readStrictSettings,
        piAgentRpcEntry: fileURLToPath(import.meta.resolve('@earendil-works/pi-coding-agent/rpc-entry')),
        zcodeBuiltinProviderConfigFilePath: join(root, 'zcode-provider.json') });
      const agent = services.get(IZCodeAgentService);
      const ack = await agent.sendConversationCommandV4({ workspacePath, envelope: {
        commandId: randomUUID(), clientId: 'corrupt-host-test', sessionId: null,
        issuedAt: Date.now(), type: 'createSession', payload: { workspaceId: workspacePath,
          firstInput: { text: 'must not reach local model', modelSelection: {
            providerId: 'guard-provider', modelId: 'local' } } },
      } });
      assert.equal(ack.status, 'failed', JSON.stringify(ack));
      assert.match(`${ack.reasonCode} ${ack.message}`, /setting\.json|invalid settings|cannot safely read/i);
      assert.equal(modelRequests, 0, 'a corrupt offline choice must not reach even a loopback model');
      assert.equal(await readFile(settingsPath, 'utf8'), original);
      await disposeServiceResourcesAndWait(services);
      services = undefined;
      await writeFile(settingsPath, '{"piOfflineMode":"offline", broken');
      await settingService.get();
      const backupPath = (await settingService.getReadStatus()).backupPath;
      assert(backupPath?.includes('setting.json.corrupt-'));
      assert.match(await readFile(backupPath, 'utf8'), /piOfflineMode/);
      await assert.rejects(readFile(settingsPath), { code: 'ENOENT' });
      const restarted = createSettingServiceWithMigrations();
      services = createLocalServices({ settingService: restarted.service,
        readStrictSettings: restarted.readStrictSettings,
        piAgentRpcEntry: fileURLToPath(import.meta.resolve('@earendil-works/pi-coding-agent/rpc-entry')),
        zcodeBuiltinProviderConfigFilePath: join(root, 'zcode-provider.json') });
      const afterRestart = await services.get(IZCodeAgentService).sendConversationCommandV4({
        workspacePath, envelope: { commandId: randomUUID(), clientId: 'corrupt-host-restart-test',
          sessionId: null, issuedAt: Date.now(), type: 'createSession',
          payload: { workspaceId: workspacePath, firstInput: { text: 'backup-only must stay offline' } },
        },
      });
      assert.equal(afterRestart.status, 'failed', JSON.stringify(afterRestart));
      assert.equal(modelRequests, 0, 'a restarted Host must not infer online defaults from backup-only state');
      await disposeServiceResourcesAndWait(services);
      services = undefined;
    } finally {
      if (services) {
        const { disposeServiceResourcesAndWait } = await import('../src/node.ts');
        await disposeServiceResourcesAndWait(services);
      }
      model.closeAllConnections();
      await new Promise(resolve => model.close(resolve));
      for (const [key, value] of Object.entries(prior)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      assert.equal(dirname(resolve(root)).toLowerCase(), resolve(tmpdir()).toLowerCase());
      await rm(root, { recursive: true, force: true });
    }
  });

test('desktop Host API transport never falls back to direct network on corrupt proxy settings',
  { timeout: 20_000 }, async () => {
    const root = await mkdtemp(join(tmpdir(), 'pi-corrupt-host-network-'));
    const previous = process.env.ZCODE_DESKTOP_PROFILE_HOME;
    process.env.ZCODE_DESKTOP_PROFILE_HOME = root;
    const settingsPath = join(root, '.zcode', 'v2', 'setting.json');
    await mkdir(dirname(settingsPath), { recursive: true });
    const original = JSON.stringify({ httpProxy: 'http://127.0.0.1:39999',
      lastWorkspaceSession: 'invalid-single-field' });
    await writeFile(settingsPath, original);
    let requests = 0;
    const endpoint = createServer((_request, response) => { requests++; response.end('ok'); });
    let transport;
    try {
      await new Promise(resolve => endpoint.listen(0, '127.0.0.1', resolve));
      const address = endpoint.address();
      assert(address && typeof address !== 'string');
      const { createSettingServiceWithMigrations } = await import('../src/setting/settingService.ts');
      const { readStrictSettings } = createSettingServiceWithMigrations();
      const { createHostApiNetworkTransportForSettings } = await import('../src/node.ts');
      transport = createHostApiNetworkTransportForSettings(readStrictSettings);
      const url = `http://127.0.0.1:${address.port}/guard`;
      await assert.rejects(transport.fetch(url), /setting\.json|invalid settings|cannot safely read/i);
      assert.equal(requests, 0, 'no direct request may escape when proxy settings are unreadable');
      assert.equal(await readFile(settingsPath, 'utf8'), original);
      await writeFile(settingsPath, JSON.stringify({ httpProxy: undefined,
        lastWorkspaceSession: [] }));
      assert.equal((await transport.fetch(url)).status, 200,
        'the same transport should retry after explicit external repair');
      assert.equal(requests, 1);
      await writeFile(settingsPath, original);
      await assert.rejects(transport.fetch(url), /setting\.json|invalid settings|cannot safely read/i);
      assert.equal(requests, 1,
        'an already cached direct route must not bypass a later corrupt settings file');
      await writeFile(settingsPath, '{"httpProxy":"http://127.0.0.1:39999", broken');
      await assert.rejects(transport.fetch(url), /setting\.json|repair|backed up/i);
      await transport.disposeAndWait();
      transport = undefined;
      const restarted = createSettingServiceWithMigrations();
      transport = createHostApiNetworkTransportForSettings(restarted.readStrictSettings);
      await assert.rejects(transport.fetch(url), /setting\.json|repair|backed up/i);
      assert.equal(requests, 1, 'a backup-only restart must still block Host API network');
    } finally {
      await transport?.disposeAndWait();
      endpoint.closeAllConnections();
      await new Promise(resolve => endpoint.close(resolve));
      if (previous === undefined) delete process.env.ZCODE_DESKTOP_PROFILE_HOME;
      else process.env.ZCODE_DESKTOP_PROFILE_HOME = previous;
      assert.equal(dirname(resolve(root)).toLowerCase(), resolve(tmpdir()).toLowerCase());
      await rm(root, { recursive: true, force: true });
    }
  });
