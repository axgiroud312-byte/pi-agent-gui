// Native settings -> actual Pi files / child environment / resource bridge.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { connect } from 'node:net';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { rootCertificates } from 'node:tls';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixture } from './native-smoke/fixture.mjs';
import { closeOwned, assertCleanExit } from './native-smoke/cleanup.mjs';
import { startPiModel } from './native-smoke/pi-model.mjs';
import { configurePiProfile, isolatePiPackage, verifyPiPackageCleanup } from './native-smoke/pi-package.mjs';
import { resizeNativeWindow } from './native-smoke/evidence.mjs';

const f = await fixture();
await isolatePiPackage(f);
const packaged = process.env.NATIVE_PI_PACKAGED_EXE;
if (packaged) {
  f.electronPath = packaged;
  f.workspace = join(f.home, '.zcode/workspace/default');
  await mkdir(f.workspace, { recursive: true });
  f.env.ZCODE_DESKTOP_PROFILE_HOME = f.home;
  delete f.env.NODE_OPTIONS;
}
const model = await startPiModel();
const sockets = new Set();
let tunnels = 0;
const proxy = createServer((_request, response) => { response.writeHead(405); response.end(); });
proxy.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
proxy.on('connect', (request, client, head) => {
  if (request.url !== 'pi-settings-wiring.invalid:80') { client.destroy(); return; }
  tunnels++;
  const upstream = connect(Number(new URL(model.url).port), '127.0.0.1', () => {
    client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    if (head.length) upstream.write(head);
    upstream.pipe(client); client.pipe(upstream);
  });
  upstream.on('error', () => client.destroy());
  client.on('error', () => upstream.destroy());
  client.on('close', () => upstream.destroy());
});
await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve));
await configurePiProfile(f, { url: 'http://pi-settings-wiring.invalid/v1', modelId: 'pi-native-test', apiKey: 'fixture-only' });
const profile = f.env.PI_CODING_AGENT_DIR;
const settingsPath = join(profile, 'settings.json');
const probe = join(f.sandbox, 'observed-pi-settings.json');
const extension = join(profile, 'extensions', 'settings-probe.ts');
const ca = join(f.sandbox, 'fixture-ca.pem');
await mkdir(join(profile, 'extensions'), { recursive: true });
await writeFile(ca, rootCertificates[0] ?? '');
await writeFile(extension, `import { writeFileSync } from 'node:fs';
import { SettingsManager } from '@earendil-works/pi-coding-agent';
export default function (pi) { pi.on('session_start', (_event, ctx) => {
  const settings = SettingsManager.create(process.cwd(), process.env.PI_CODING_AGENT_DIR, { projectTrusted: true });
  writeFileSync(${JSON.stringify(probe)}, JSON.stringify({ settings: settings.getGlobalSettings(),
    noProxy: process.env.NO_PROXY, ca: process.env.NODE_EXTRA_CA_CERTS, tools: pi.getActiveTools(), model: ctx.model?.id }));
}); }
`);
const initial = JSON.parse(await readFile(settingsPath, 'utf8'));
await writeFile(settingsPath, JSON.stringify({ ...initial, defaultProjectTrust: 'always',
  futureKey: { keep: 'unchanged' }, extensions: [extension], retry: { provider: { maxRetryDelayMs: 5678 } } }));
const prompt = join(f.workspace, '.pi/prompts/wiring-template.md');
const skill = join(f.workspace, '.pi/skills/wiring-skill/SKILL.md');
await Promise.all([mkdir(join(f.workspace, '.pi/prompts'), { recursive: true }),
  mkdir(join(f.workspace, '.pi/skills/wiring-skill'), { recursive: true })]);
await writeFile(prompt, '---\ndescription: Pi settings template before\n---\nPI_TEXT: before $1');
await writeFile(skill, '---\nname: wiring-skill\ndescription: A real Pi settings skill\n---\nUse real Pi resources.');
const report = { at: new Date().toISOString(), packaged: Boolean(packaged), piVersion: '0.87.0',
  boundary: 'native GUI -> Host -> actual Pi settings / environment / resources / controlled proxy inference; not online OAuth',
  pageErrors: [], stages: {}, cleanup: [] };
let app;
let page;
let logs = [];
async function open() {
  logs = [];
  app = await f.playwright._electron.launch({ executablePath: f.electronPath,
    args: packaged ? ['--lang=zh-CN'] : [fileURLToPath(new URL('./native-smoke/bootstrap.cjs', import.meta.url)), '--lang=zh-CN'],
    cwd: packaged ? f.sandbox : f.root, env: f.env, timeout: 60_000 });
  app.process().stdout?.on('data', data => logs.push(String(data)));
  app.process().stderr?.on('data', data => logs.push(String(data)));
  page = await app.firstWindow();
  page.setDefaultTimeout(20_000);
  page.on('pageerror', error => report.pageErrors.push(error.message));
  await page.waitForTimeout(6000);
  for (let attempt = 0; attempt < 30; attempt++) {
    if (await page.getByTestId('sidebar').isVisible()) return;
    for (const name of [/^(跳过|Skip)$/, /^(使用 API key|Use API key)$/, /^(暂时跳过|Skip for now)$/, /^(退出引导|Exit onboarding)$/]) {
      const button = page.getByRole('button', { name, exact: true }).first();
      if (await button.isVisible()) { await button.click(); break; }
    }
    await page.waitForTimeout(1000);
  }
  throw new Error('Native workbench did not appear');
}
async function close() {
  const cleanup = await closeOwned(app, f);
  report.cleanup.push(cleanup);
  assertCleanExit(cleanup, logs, 'Pi settings wiring GUI');
  app = undefined;
}
try {
  await open();
  if (!packaged) {
    await page.getByRole('button', { name: '添加项目', exact: true }).click();
    await page.getByRole('menuitem', { name: '打开文件夹', exact: true }).click();
  }
  assert.equal(await page.locator('[data-v4-draft-suggested-prompts]').count(), 0);
  report.stages.noLegacyDraftRecommendations = true;
  await page.getByTestId('sidebar').getByTestId('task-settings-button').click();
  await page.getByTestId('settings-section-nav-general').click();
  const settings = page.getByTestId('pi-settings-section');
  await settings.waitFor();
  await settings.getByText('常用 Pi 配置', { exact: true }).click();
  const field = key => settings.getByTestId(`pi-runtime-${key}`);
  const selectField = async (key, value) => {
    await field(key).click();
    await page.getByRole('option', { name: value === 'false' ? '关闭' : value === 'true' ? '开启' : value, exact: true }).click();
  };
  await field('httpProxy').fill(`http://127.0.0.1:${proxy.address().port}`);
  await selectField('retry.enabled', 'false');
  await field('retry.maxRetries').fill('1');
  await selectField('compaction.enabled', 'false');
  await selectField('images.autoResize', 'false');
  await selectField('enableInstallTelemetry', 'false');
  await settings.getByRole('button', { name: '保存 Pi 设置', exact: true }).click();
  await settings.getByText(/已写入 Pi 实际配置/u).waitFor();
  const saved = JSON.parse(await readFile(settingsPath, 'utf8'));
  assert.equal(saved.httpProxy, `http://127.0.0.1:${proxy.address().port}`);
  assert.equal(saved.retry.enabled, false);
  assert.equal(saved.retry.provider.maxRetryDelayMs, 5678);
  assert.equal(saved.compaction.enabled, false);
  assert.deepEqual(saved.futureKey, { keep: 'unchanged' });
  const noProxy = page.getByTestId('pi-launch-no-proxy');
  await noProxy.fill('localhost,127.0.0.1'); await noProxy.press('Enter');
  const certificate = page.getByTestId('pi-launch-ca-cert');
  await certificate.fill(ca); await certificate.press('Enter');
  await page.waitForTimeout(1000);
  assert.equal(await page.getByTestId('settings-ask-user-question-auto-resolution-switch').count(), 0);
  await page.screenshot({ path: join(f.output, 'pi-general-config.png') });
  report.stages.generalSavesRealPiDocument = true;
  for (const section of ['mcp', 'subagents', 'hooks']) {
    await page.getByTestId(`settings-section-nav-${section}`).click();
    await page.getByTestId('pi-unsupported-settings').waitFor();
  }
  await page.getByTestId('settings-section-nav-browser').click();
  assert.equal(await page.getByRole('switch', { name: '开启内置浏览器控制' }).count(), 0);
  report.stages.noWritableUnsupportedLegacyControls = true;
  await close();
  await open();
  await page.getByTestId('chat-model-select-trigger').click();
  await page.getByTestId('chat-model-select-search').fill('pi-native-test');
  await page.getByRole('menuitemradio', { name: /pi-native-test/ }).first().click();
  const composer = page.getByTestId('v4-composer-input').filter({ visible: true }).first();
  await composer.fill('PI_TEXT: actual settings and proxy wiring');
  model.releaseText();
  await page.getByTestId('v4-composer-send').filter({ visible: true }).first().click();
  await page.getByText('PI_TEXT_COMPLETE', { exact: true }).waitFor({ timeout: 40_000 });
  assert(tunnels > 0, 'Pi must use the proxy saved in actual Pi settings, with no proxy in inherited env');
  const observed = JSON.parse(await readFile(probe, 'utf8'));
  assert.equal(observed.settings.retry.enabled, false);
  assert.equal(observed.settings.compaction.enabled, false);
  assert.equal(observed.noProxy, 'localhost,127.0.0.1');
  assert.equal(observed.ca, ca);
  report.stages.actualChildAndProxyInference = { tunnels, observed };
  await page.getByTestId('sidebar').getByTestId('task-settings-button').click();
  for (const section of ['skill', 'commands', 'plugin', 'memory']) {
    await page.getByTestId(`settings-section-nav-${section}`).click();
    await page.getByTestId('settings-page').getByTestId('pi-resource-settings').waitFor();
    await page.getByTestId('settings-page').getByTestId('pi-resource-command-row').filter({ hasText: '/wiring-template' }).waitFor();
    assert((await page.getByTestId('settings-page').getByTestId('pi-resource-skills').innerText()).includes('wiring-skill'));
  }
  const resources = page.getByTestId('settings-page').getByTestId('pi-resource-settings');
  const command = resources.getByTestId('pi-resource-command-row').filter({ hasText: '/wiring-template' });
  await command.getByRole('button', { name: '编辑', exact: true }).click();
  await resources.getByLabel('Pi 资源内容', { exact: true }).fill('---\ndescription: Edited from actual Pi settings\n---\nPI_TEXT: edited $1');
  await resources.getByRole('button', { name: '保存并重载', exact: true }).click();
  await command.getByText('Edited from actual Pi settings').waitFor();
  assert((await readFile(prompt, 'utf8')).includes('Edited from actual Pi settings'));
  await page.screenshot({ path: join(f.output, 'pi-settings-resources.png') });
  report.stages.settingsResourcesActuallyReload = true;
  await page.getByTestId('settings-back-button').click();
  await composer.fill('/wiring-template configured-from-settings');
  await page.getByTestId('v4-composer-send').filter({ visible: true }).first().click();
  await page.waitForFunction(() => [...document.querySelectorAll('[data-testid="v4-composer-input"]')]
    .filter(element => element.offsetParent !== null).every(element => element.textContent === ''));
  for (let attempt = 0; attempt < 100 && model.requests.length < 2; attempt++) await page.waitForTimeout(100);
  assert(model.requests.some(request => request.promptText.includes('PI_TEXT: edited configured-from-settings')));
  report.stages.editedTemplateUsedByPiRequest = true;
  await page.getByTestId('automations-open').click();
  await page.getByTestId('pi-unsupported-settings').waitFor();
  assert.equal(await page.getByRole('button', { name: /创建定时任务|创建自动化|新建自动化/ }).count(), 0);
  report.stages.sidebarAutomationsCannotWriteLegacyConfig = true;
  await page.screenshot({ path: join(f.output, 'pi-sidebar-automations-unavailable.png') });
  await page.getByTestId('plugin-store-sidebar-open').click();
  await page.getByTestId('pi-resource-settings').waitFor();
  assert.equal(await page.getByTestId('pi-resource-settings').getByLabel('Pi 包来源', { exact: true }).count(), 1);
  report.stages.sidebarPluginStoreUsesPiPackages = true;
  await page.screenshot({ path: join(f.output, 'pi-sidebar-resources.png') });
  // Capture only the changed setting surfaces, preserving the native navigation,
  // frame and form controls at both accepted sizes/themes. No original-side claim.
  await page.getByTestId('sidebar').getByTestId('task-settings-button').click();
  for (const size of [{ width: 1280, height: 800 }, { width: 1920, height: 1080 }]) {
    await resizeNativeWindow(app, page, size);
    for (const theme of ['浅色', '深色']) {
      await page.getByTestId('settings-section-nav-appearance').click();
      await page.getByTestId('settings-page').getByRole('combobox').first().click();
      await page.getByRole('option', { name: theme, exact: true }).click();
      await page.getByTestId('settings-section-nav-general').click();
      await page.getByTestId('pi-settings-section').waitFor();
      await page.screenshot({ path: join(f.output, `pi-general-${size.width}-${theme === '浅色' ? 'light' : 'dark'}.png`) });
      await page.getByTestId('pi-runtime-fields').getByText('常用 Pi 配置', { exact: true }).click();
      await page.getByTestId('pi-runtime-defaultProvider').scrollIntoViewIfNeeded();
      await page.screenshot({ path: join(f.output, `pi-fields-${size.width}-${theme === '浅色' ? 'light' : 'dark'}.png`) });
      await page.getByTestId('settings-section-nav-plugin').click();
      await page.getByTestId('settings-page').getByTestId('pi-resource-settings').waitFor();
      await page.getByTestId('settings-page').getByTestId('pi-resource-command-row').filter({ hasText: '/wiring-template' }).waitFor();
      await page.screenshot({ path: join(f.output, `pi-resources-${size.width}-${theme === '浅色' ? 'light' : 'dark'}.png`) });
    }
  }
  report.stages.nativeSettingsSizeThemeMatrix = true;
  await page.getByTestId('settings-section-nav-general').click();
  await page.getByTestId('pi-settings-section').getByRole('button', { name: '项目设置', exact: true }).click();
  await page.getByTestId('pi-runtime-fields').getByText('常用 Pi 配置', { exact: true }).click();
  for (const key of ['httpProxy', 'cacheWarming', 'defaultProjectTrust']) {
    assert(await page.getByTestId(`pi-runtime-${key}`).isDisabled(), key);
  }
  report.stages.projectFormGlobalOnlyGuard = true;
  await verifyPiPackageCleanup(f);
  assert.deepEqual(report.pageErrors, []);
} catch (error) {
  report.error = error.stack || String(error);
  report.body = await page?.locator('body').innerText().catch(() => '');
  process.exitCode = 1;
  console.error(error);
  await page?.screenshot({ path: join(f.output, 'pi-settings-wiring-failure.png') }).catch(() => {});
} finally {
  try { if (app) await close(); } catch (error) { report.cleanupError = String(error); process.exitCode = 1; }
  for (const socket of sockets) socket.destroy();
  await new Promise(resolve => proxy.close(resolve));
  await model.close();
  await writeFile(join(f.output, 'pi-settings-wiring-gui-report.json'), JSON.stringify(report, null, 2));
  await writeFile(join(f.output, 'pi-settings-wiring-gui.log'), logs.join(''));
  console.log(JSON.stringify(report, null, 2));
}
