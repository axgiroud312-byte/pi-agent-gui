// A real online provider probe through the production Electron -> Host -> pinned Pi path.
// The user's OAuth credential is copied into a private fixture only for this run.
import assert from 'node:assert/strict';
import { mkdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixture } from './native-smoke/fixture.mjs';
import { closeOwned, assertCleanExit } from './native-smoke/cleanup.mjs';
import { isolatePiPackage, verifyPiPackageCleanup } from './native-smoke/pi-package.mjs';

const f = await fixture();
await isolatePiPackage(f);
const sourceAuth = JSON.parse(await readFile(join(process.env.USERPROFILE, '.pi', 'agent', 'auth.json'), 'utf8'));
const credential = sourceAuth['openai-codex'];
assert(credential && typeof credential === 'object', 'openai-codex OAuth is unavailable');
const proxy = process.env.HTTPS_PROXY ?? process.env.HTTP_PROXY;
assert(proxy && ['localhost', '127.0.0.1', '[::1]'].includes(new URL(proxy).hostname),
  'online native fixture needs an existing loopback HTTP proxy');
const profile = join(f.sandbox, 'pi-profile');
const authPath = join(profile, 'auth.json');
const marker = `PI_GUI_ONLINE_OK_${Date.now()}`;
const report = { at: new Date().toISOString(), piVersion: '0.87.0',
  boundary: 'production Electron -> Host -> pinned Pi RPC -> live openai-codex/gpt-5.5',
  model: 'openai-codex/gpt-5.5', pageErrors: [], stages: {} };
const logs = [];
let app;
try {
  await mkdir(profile, { recursive: true });
  await writeFile(authPath, JSON.stringify({ 'openai-codex': credential }), { mode: 0o600 });
  await writeFile(join(profile, 'settings.json'), JSON.stringify({
    defaultProvider: 'openai-codex', defaultModel: 'gpt-5.5',
    enableInstallTelemetry: false, cacheWarming: 'off', httpProxy: proxy,
  }));
  f.env.PI_CODING_AGENT_DIR = profile;
  app = await f.playwright._electron.launch({ executablePath: f.electronPath,
    args: [fileURLToPath(new URL('./native-smoke/bootstrap.cjs', import.meta.url)), '--lang=zh-CN'],
    cwd: f.root, env: f.env, timeout: 60_000 });
  app.process().stdout?.on('data', chunk => logs.push(String(chunk)));
  app.process().stderr?.on('data', chunk => logs.push(String(chunk)));
  const page = await app.firstWindow();
  page.setDefaultTimeout(15_000);
  page.on('pageerror', error => report.pageErrors.push(error.stack || error.message));
  await page.waitForTimeout(6000);
  for (const name of [/^(使用 API key|Use API key)$/, /^(暂时跳过|Skip for now)$/,
    /^(退出引导|Exit onboarding)$/]) {
    const button = page.getByRole('button', { name, exact: true });
    if (await button.isVisible()) { await button.click(); await page.waitForTimeout(1800); }
  }
  await page.getByRole('button', { name: '添加项目', exact: true }).click();
  await page.getByRole('menuitem', { name: '打开文件夹', exact: true }).click();
  const composer = page.getByTestId('v4-composer-input').filter({ visible: true }).first();
  await composer.waitFor();
  await page.getByTestId('chat-model-select-trigger').click();
  const search = page.getByTestId('chat-model-select-search');
  await search.fill('gpt-5.5');
  const choice = page.getByRole('menuitemradio', { name: /gpt-5\.5/i }).first();
  await choice.waitFor();
  await choice.click();
  report.stages.modelSelected = true;
  await composer.click();
  await page.keyboard.type(`Reply with exactly ${marker}`);
  await page.getByTestId('v4-composer-send').filter({ visible: true }).first().click();
  await page.getByText(marker, { exact: true }).waitFor({ timeout: 90_000 });
  report.stages.onlineReplyVisible = true;
  await verifyPiPackageCleanup(f);
  assert.deepEqual(report.pageErrors, []);
  for (const secret of [credential.access, credential.refresh].filter(value => typeof value === 'string')) {
    assert(!logs.join('').includes(secret), 'OAuth token must not enter process logs');
  }
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error);
  process.exitCode = 1;
} finally {
  try {
    report.cleanup = await closeOwned(app, f);
    assertCleanExit(report.cleanup, logs, 'online Pi provider GUI');
  } catch (error) { report.cleanupError = String(error); process.exitCode = 1; }
  await unlink(authPath).catch(error => {
    report.credentialCleanupError = error instanceof Error ? error.message : String(error);
    process.exitCode = 1;
  });
  report.credentialCopyRemoved = await stat(authPath).then(() => false, error => error.code === 'ENOENT');
  if (!report.credentialCopyRemoved) process.exitCode = 1;
  await writeFile(join(f.output, 'pi-online-provider-gui-report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
