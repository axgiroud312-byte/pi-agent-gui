import assert from 'node:assert/strict';
import { cp, mkdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Pi 0.87.0 cleans Windows self-update quarantine at startup, even offline.
// Keep that real operation inside the fixture instead of allowing writes to the
// shared installation. PI_PACKAGE_DIR is a documented, upstream-supported path.
export async function isolatePiPackage(f) {
  const installed = dirname(dirname(dirname(fileURLToPath(
    import.meta.resolve('@earendil-works/pi-coding-agent/rpc-entry')))));
  const modules = join(f.sandbox, 'pi-runtime', 'node_modules');
  const staged = join(modules, '@earendil-works', 'pi-coding-agent');
  await cp(installed, staged, { recursive: true });
  f.env.PI_PACKAGE_DIR = staged;
  f.piQuarantineProbe = join(modules, '.pi-native-quarantine', 'probe');
  await mkdir(dirname(f.piQuarantineProbe), { recursive: true });
  await writeFile(f.piQuarantineProbe, 'Only this isolated quarantine may be removed by Pi.');
}

export async function configurePiProfile(f, { url, modelId, apiKey }) {
  const profile = join(f.sandbox, 'pi-profile');
  await mkdir(profile, { recursive: true });
  f.env.PI_CODING_AGENT_DIR = profile;
  f.env.PI_OFFLINE = '1';
  await writeFile(join(profile, 'models.json'), JSON.stringify({ providers: {
    'new-provider': { baseUrl: url, api: 'openai-completions', apiKey,
      models: [{ id: modelId, name: modelId, reasoning: false,
        input: ['text'], contextWindow: 32000, maxTokens: 1024,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }] },
  } }));
  await writeFile(join(profile, 'settings.json'), JSON.stringify({
    defaultProvider: 'new-provider', defaultModel: modelId,
    enableInstallTelemetry: false, cacheWarming: 'off',
  }));
}

export async function verifyPiPackageCleanup(f) {
  await assert.rejects(stat(f.piQuarantineProbe), { code: 'ENOENT' },
    'Real Pi must perform its quarantine cleanup inside the private package directory');
}
