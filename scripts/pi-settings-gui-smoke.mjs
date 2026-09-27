// Isolated native desktop -> Host -> pinned Pi settings and RPC probe for #10.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ProjectTrustStore } from '@earendil-works/pi-coding-agent';
import { fixture } from './native-smoke/fixture.mjs';
import { closeOwned, assertCleanExit } from './native-smoke/cleanup.mjs';
import { startPiModel } from './native-smoke/pi-model.mjs';
import { configurePiProfile, isolatePiPackage, verifyPiPackageCleanup } from './native-smoke/pi-package.mjs';

const f = await fixture();
await isolatePiPackage(f);
const model = await startPiModel();
await configurePiProfile(f, { url: model.url, modelId: 'pi-native-test', apiKey: 'fixture-not-a-secret' });
const probeFile = join(f.sandbox, 'pi-launch-observed.json');
const extensions = join(f.env.PI_CODING_AGENT_DIR, 'extensions');
await mkdir(extensions, { recursive: true });
const extension = join(extensions, 'pi-launch-probe.ts');
await writeFile(extension, `import { writeFileSync } from 'node:fs';
export default function (pi) {
  pi.on('session_start', () => writeFileSync(${JSON.stringify(probeFile)},
    JSON.stringify({ offline: process.env.PI_OFFLINE,
      skipVersionCheck: process.env.PI_SKIP_VERSION_CHECK, cwd: process.cwd() })));
}\n`);
const settingsPath = join(f.sandbox, 'pi-profile', 'settings.json');
const initial = JSON.parse(await readFile(settingsPath, 'utf8'));
await writeFile(settingsPath, JSON.stringify({ ...initial, futureSetting: { keep: 'unchanged' },
  retry: { enabled: true }, terminal: { showImages: false }, defaultProjectTrust: 'ask',
  extensions: [extension] }));
const projectSettingsPath = join(f.workspace, '.pi', 'settings.json');
await mkdir(join(f.workspace, '.pi'));
await writeFile(projectSettingsPath, JSON.stringify({ retry: { maxRetries: 7 }, projectUnknown: 42,
  cacheWarming: 'idle', defaultProjectTrust: 'always' }));
const logs = [];
const report = { at: new Date().toISOString(), workspace: f.workspace, piVersion: '0.87.0',
  inference: 'deterministic loopback provider, not online provider', pageErrors: [] };
async function waitForSettings(predicate) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const value = JSON.parse(await readFile(settingsPath, 'utf8'));
    if (predicate(value)) return value;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Pi settings did not reach the expected disk value');
}
let app;
try {
  app = await f.playwright._electron.launch({ executablePath: f.electronPath,
    args: [fileURLToPath(new URL('./native-smoke/bootstrap.cjs', import.meta.url)), '--lang=zh-CN'],
    cwd: f.root, env: f.env, timeout: 60_000 });
  app.process().stdout?.on('data', chunk => logs.push(String(chunk)));
  app.process().stderr?.on('data', chunk => logs.push(String(chunk)));
  const page = await app.firstWindow();
  page.setDefaultTimeout(15_000);
  page.on('pageerror', error => report.pageErrors.push(error.stack || error.message));
  await page.waitForTimeout(6000);
  for (const name of [/^(使用 API key|Use API key)$/, /^(暂时跳过|Skip for now)$/, /^(退出引导|Exit onboarding)$/]) {
    const button = page.getByRole('button', { name, exact: true });
    if (await button.isVisible()) { await button.click(); await page.waitForTimeout(1800); }
  }
  await page.getByRole('button', { name: '添加项目', exact: true }).click();
  await page.getByRole('menuitem', { name: '打开文件夹', exact: true }).click();
  await page.getByTestId('composer-workspace-trigger').filter({ hasText: 'parity-workspace' }).waitFor();
  await page.getByTestId('sidebar').getByTestId('task-settings-button').click();
  await page.getByRole('button', { name: '模型设置', exact: true }).click();
  const settings = page.getByTestId('pi-settings-section');
  await settings.waitFor();
  const editor = settings.getByTestId('pi-settings-json');
  await editor.waitFor();
  await page.waitForFunction(() => document.querySelector('[data-testid="pi-settings-json"]')?.value.includes('futureSetting'));
  await settings.getByTestId('pi-offline-mode').selectOption('offline');
  await page.waitForFunction(() => document.querySelector('[data-testid="pi-offline-mode"]')?.value === 'offline');
  await settings.getByTestId('pi-version-check-mode').selectOption('skip');
  await page.waitForFunction(() => document.querySelector('[data-testid="pi-version-check-mode"]')?.value === 'skip');
  const appSettings = JSON.parse(await readFile(join(f.home, '.zcode', 'v2', 'setting.json'), 'utf8'));
  assert.equal(appSettings.piOfflineMode, 'offline');
  assert.equal(appSettings.piVersionCheckMode, 'skip');
  assert.match(await settings.innerText(), /下一条 Pi RPC 子进程：离线；跳过 Pi 版本检查/u);
  report.launchPreferencesSaved = true;
  const originalText = await editor.inputValue();
  assert.equal(JSON.parse(originalText).futureSetting.keep, 'unchanged');
  report.userPathVisible = (await settings.innerText()).includes(settingsPath);
  assert.equal(report.userPathVisible, true);
  const edited = { ...JSON.parse(originalText), defaultThinkingLevel: 'medium' };
  await editor.fill(JSON.stringify(edited, null, 2));
  await settings.getByRole('button', { name: '保存 Pi 设置' }).click();
  await page.waitForFunction(() => {
    const editor = document.querySelector('[data-testid="pi-settings-json"]');
    return editor?.value.includes('"defaultThinkingLevel": "medium"');
  });
  const persisted = await waitForSettings(value => value.defaultThinkingLevel === 'medium');
  assert.equal(persisted.defaultThinkingLevel, 'medium');
  assert.deepEqual(persisted.futureSetting, { keep: 'unchanged' });
  report.saved = true;
  const beforeInvalid = await readFile(settingsPath, 'utf8');
  await editor.fill(JSON.stringify({ ...persisted, compaction: { reserveTokens: -1 } }, null, 2));
  await settings.getByRole('button', { name: '保存 Pi 设置' }).click();
  await settings.getByText(/Invalid compaction\.reserveTokens/u).waitFor();
  assert.equal(await readFile(settingsPath, 'utf8'), beforeInvalid,
    'a Pi-rejected value must not replace the only settings document');
  report.invalidPiValueRejected = true;
  await settings.getByRole('button', { name: '放弃修改并重新读取' }).click();
  await page.waitForFunction(() => document.querySelector('[data-testid="pi-settings-json"]')
    ?.value.includes('"defaultThinkingLevel": "medium"'));
  const external = { ...persisted, cacheWarming: 'off' };
  await writeFile(settingsPath, JSON.stringify(external));
  await editor.fill(JSON.stringify({ ...edited, defaultThinkingLevel: 'high' }, null, 2));
  await settings.getByRole('button', { name: '保存 Pi 设置' }).click();
  await settings.getByText(/Pi settings conflict/).waitFor();
  assert.equal(JSON.parse(await readFile(settingsPath, 'utf8')).cacheWarming, 'off');
  assert((await editor.inputValue()).includes('"high"'));
  report.externalEditConflict = true;
  await page.screenshot({ path: join(f.output, 'pi-settings-conflict.png') });
  await settings.getByRole('button', { name: '放弃修改并重新读取' }).click();
  await page.waitForFunction(() => document.querySelector('[data-testid="pi-settings-json"]')?.value.includes('"cacheWarming":"off"'));
  await settings.getByRole('button', { name: '项目设置' }).click();
  await page.waitForFunction(() => document.querySelector('[data-testid="pi-settings-json"]')?.value.includes('"projectUnknown":42'));
  assert((await settings.innerText()).includes('未获 Pi 信任'));
  report.projectUntrusted = true;
  await page.screenshot({ path: join(f.output, 'pi-settings-project.png') });
  new ProjectTrustStore(join(f.sandbox, 'pi-profile')).set(f.workspace, true);
  await settings.getByRole('button', { name: '读取最新' }).click();
  await settings.getByText(/只从用户设置读取.*cacheWarming/u).waitFor();
  await settings.getByText('查看已配置的 Pi 值与来源').click();
  assert.match(await settings.locator('tr').filter({ hasText: '/retry/enabled' }).innerText(), /用户/u);
  assert.match(await settings.locator('tr').filter({ hasText: '/retry/maxRetries' }).innerText(), /项目/u);
  assert.match(await settings.locator('tr').filter({ hasText: '/cacheWarming' }).innerText(), /"off".*用户/u);
  assert.match(await settings.locator('tr').filter({ hasText: '/terminal/showImages' }).innerText(), /Pi CLI TUI/u);
  assert.match(await settings.innerText(), /不含 Pi 内建默认值.*不是正在运行会话的 get_state/u);
  report.trustedNestedSources = true;
  report.globalOnlyProjectOverrideIgnored = true;
  await page.screenshot({ path: join(f.output, 'pi-settings-sources.png') });
  // The same native Host also starts and observes the pinned Pi RPC process.
  if (!await page.getByRole('button', { name: '创建自定义供应商', exact: true }).isVisible()) {
    await page.getByRole('button', { name: '模型设置', exact: true }).click();
    await page.getByTestId('model-provider-add-provider-button').click();
  }
  await page.getByRole('button', { name: '创建自定义供应商', exact: true }).click();
  await page.getByTestId('model-provider-base-url-input').fill(model.url);
  await page.getByTestId('model-provider-api-key-input').fill('fixture-not-a-secret');
  await page.getByTestId('model-provider-api-format-trigger').click();
  await page.getByRole('option', { name: /Chat Completions/ }).click();
  await page.getByTestId('model-provider-add-model-button').click();
  await page.getByPlaceholder('模型 ID', { exact: true }).fill('pi-native-test');
  await page.getByRole('dialog').getByRole('button', { name: '保存', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  await page.getByTestId('settings-back-button').click();
  await page.getByTestId('settings-page').waitFor({ state: 'hidden' });
  await page.getByTestId('chat-model-select-trigger').click();
  await page.getByTestId('chat-model-select-search').fill('pi-native-test');
  await page.getByRole('menuitemradio', { name: /pi-native-test/ }).first().click();
  const composer = page.getByTestId('v4-composer-input').filter({ visible: true }).first();
  await composer.click();
  await page.keyboard.type('PI_TEXT: settings GUI smoke');
  model.releaseText();
  await page.getByTestId('v4-composer-send').filter({ visible: true }).first().click();
  await page.getByText('PI_TEXT_COMPLETE', { exact: true }).waitFor({ timeout: 30_000 });
  assert(model.requests.some(request => request.scenario === 'PI_TEXT'));
  report.pinnedPiRpcObserved = true;
  const launched = JSON.parse(await readFile(probeFile, 'utf8'));
  assert.equal(launched.offline, '1', 'same Pi child must receive selected offline mode');
  assert.equal(launched.skipVersionCheck, '1', 'same Pi child must skip Pi version check');
  assert.equal(launched.cwd, f.workspace, 'same Pi child must run in the selected local workspace');
  report.pinnedPiLaunchObserved = launched;
  await verifyPiPackageCleanup(f);
  assert.deepEqual(report.pageErrors, []);
} catch (error) {
  report.error = error.stack || String(error);
  report.body = (await app?.windows()[0]?.locator('body').innerText().catch(() => ''))?.slice(0, 7000);
  process.exitCode = 1;
  console.error(error);
  await app?.windows()[0]?.screenshot({ path: join(f.output, 'pi-settings-failure.png') }).catch(() => {});
} finally {
  try { report.cleanup = await closeOwned(app, f); assertCleanExit(report.cleanup, logs, 'Pi settings GUI'); }
  catch (error) { report.cleanupError = String(error); process.exitCode = 1; }
  await model.close();
  await writeFile(join(f.output, 'pi-settings-gui-report.json'), JSON.stringify(report, null, 2));
  await writeFile(join(f.output, 'pi-settings-gui.log'), logs.join(''));
  console.log(JSON.stringify(report, null, 2));
}
