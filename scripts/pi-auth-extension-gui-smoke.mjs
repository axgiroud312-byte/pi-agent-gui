// Isolated native GUI -> Host -> pinned Pi auth and extension-input probe.
import assert from 'node:assert/strict';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixture } from './native-smoke/fixture.mjs';
import { closeOwned, assertCleanExit } from './native-smoke/cleanup.mjs';
import { startPiModel } from './native-smoke/pi-model.mjs';
import { configurePiProfile, isolatePiPackage, verifyPiPackageCleanup } from './native-smoke/pi-package.mjs';

const f = await fixture();
await isolatePiPackage(f);
const model = await startPiModel();
await configurePiProfile(f, { url: model.url, modelId: 'pi-native-test', apiKey: 'fixture-not-a-secret' });
const profile = f.env.PI_CODING_AGENT_DIR;
const extensionDir = join(profile, 'extensions');
await mkdir(extensionDir, { recursive: true });
await copyFile(fileURLToPath(new URL('../packages/services/test/fixtures/pi-ui-sequence.ts', import.meta.url)),
  join(extensionDir, 'pi-ui-sequence.ts'));
const providerMarker = join(f.sandbox, 'runtime-provider-factory-runs.txt');
await writeFile(join(extensionDir, 'runtime-provider.js'), `
import { appendFileSync } from 'node:fs';
export default function (pi) {
  appendFileSync(${JSON.stringify(providerMarker)}, 'loaded\\n');
  pi.registerProvider('fixture-runtime-oauth', {
    name: 'Fixture runtime OAuth', baseUrl: 'http://127.0.0.1:1/v1',
    api: 'openai-completions', models: [{ id: 'fixture-runtime-model', name: 'Fixture runtime model',
      input: ['text'], contextWindow: 4096, maxTokens: 256 }],
    oauth: { name: 'Fixture OAuth', async login() { throw new Error('No live account'); },
      async refreshToken(value) { return value; }, getApiKey(value) { return value.access; } }
  });
}
`);
const resultFile = join(f.sandbox, 'pi-ui-result.json');
// bootstrap.cjs deliberately strips unknown process environment variables;
// NATIVE_SMOKE_ keys are the fixture's explicit pass-through boundary.
f.env.NATIVE_SMOKE_PI_UI_RESULT_FILE = resultFile;
const secret = 'fixture-only-anthropic-gui-key';
const logs = [];
const report = { at: new Date().toISOString(), workspace: f.workspace, piVersion: '0.87.0',
  providerBoundary: 'synthetic API key saved to fixed Pi, no online provider request',
  extensionBoundary: 'real pinned Pi extension running in the GUI-owned RPC child', pageErrors: [] };
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
  await page.getByTestId('v4-composer-input').waitFor();
  await page.getByTestId('sidebar').getByTestId('task-settings-button').click();
  await page.getByRole('button', { name: '模型设置', exact: true }).click();
  await page.getByTestId('pi-model-settings-section').waitFor();
  await page.getByTestId('settings-back-button').click();
  await page.getByTestId('settings-page').waitFor({ state: 'hidden' });
  await page.getByTestId('chat-model-select-trigger').click();
  await page.getByTestId('chat-model-select-search').fill('pi-native-test');
  await page.getByRole('menuitemradio', { name: /pi-native-test/ }).first().click();
  const composer = page.getByTestId('v4-composer-input').filter({ visible: true }).first();
  await composer.click();
  await page.keyboard.type('PI_TEXT: auth and extension smoke');
  model.releaseText();
  await page.getByTestId('v4-composer-send').filter({ visible: true }).first().click();
  await page.getByText('PI_TEXT_COMPLETE', { exact: true }).waitFor({ timeout: 30_000 });
  assert(model.requests.some(request => request.scenario === 'PI_TEXT'));

  await page.getByTestId('sidebar').getByTestId('task-settings-button').click();
  if (!await page.getByTestId('pi-auth-section').isVisible()) {
    await page.getByRole('button', { name: '模型设置', exact: true }).click();
  }
  const auth = page.getByTestId('pi-auth-section');
  await auth.waitFor();
  await auth.getByRole('button', { name: /Fixture runtime OAuth/ }).click();
  await auth.getByText(/固定 Pi 0\.87\.0 的 RPC 与扩展 ModelRegistry/).waitFor();
  assert.equal(await auth.getByRole('button', { name: /OAuth.*登录/i }).count(), 0,
    'dynamic provider must not advertise an unsupported GUI login');
  const factoryRuns = await readFile(providerMarker, 'utf8');
  await auth.getByRole('button', { name: '刷新目录', exact: true }).click();
  await auth.getByText(/固定 Pi 0\.87\.0 的 RPC 与扩展 ModelRegistry/).waitFor();
  assert.equal(await readFile(providerMarker, 'utf8'), factoryRuns,
    'auth refresh must not execute the runtime extension factory a second time');
  report.runtimeProvider = { discoveredInOwnedPiChild: true, guiLoginUnavailable: true,
    factoryRunsUnchangedByAuthRefresh: true };
  await auth.getByRole('button', { name: /Anthropic/i }).first().click();
  await auth.getByRole('button', { name: /API key.*登录/i }).click();
  await auth.getByTestId('pi-auth-answer').fill(secret);
  await auth.getByRole('button', { name: '继续', exact: true }).click();
  await auth.getByText('状态：saved', { exact: true }).waitFor({ timeout: 20_000 });
  assert((await readFile(join(profile, 'auth.json'), 'utf8')).includes(secret));
  assert(!(await page.locator('body').innerText()).includes(secret));
  await page.screenshot({ path: join(f.output, 'pi-auth-saved.png') });
  await auth.getByRole('button', { name: '登出', exact: true }).click();
  await auth.getByText('状态：logged-out', { exact: true }).waitFor({ timeout: 20_000 });
  assert(!(await readFile(join(profile, 'auth.json'), 'utf8')).includes(secret));
  const modelsPath = join(profile, 'models.json');
  const validModels = await readFile(modelsPath, 'utf8');
  await writeFile(modelsPath, '{ invalid models.json');
  await auth.getByRole('button', { name: '刷新目录', exact: true }).click();
  await auth.getByText(/Pi 模型目录或认证状态存在错误/).waitFor({ timeout: 20_000 });
  assert(!(await page.locator('body').innerText()).includes('{ invalid models.json'));
  await page.screenshot({ path: join(f.output, 'pi-auth-catalog-error.png') });
  await writeFile(modelsPath, validModels);
  const refreshCatalog = auth.getByRole('button', { name: '刷新目录', exact: true });
  await refreshCatalog.click();
  // The user can return while Pi's same-child refresh is still in flight.
  // SessionPane must recover the authoritative catalog after it regains focus.
  report.auth = { saved: true, secretHidden: true, loggedOut: true,
    catalogErrorThenRepaired: true, returnedImmediatelyAfterRefreshClick: true };
  await page.getByTestId('settings-back-button').click();
  await page.getByTestId('settings-page').waitFor({ state: 'hidden' });

  await page.getByTestId('pi-resources-open').click();
  const resources = page.getByTestId('pi-resources-dialog');
  await resources.getByTestId('pi-resource-command-row').first().waitFor();
  report.piCommandsAfterAuth = await resources.getByTestId('pi-resource-command-row')
    .evaluateAll(rows => rows.map(row => row.getAttribute('data-command-name')));
  await page.keyboard.press('Escape');
  await resources.waitFor({ state: 'hidden' });
  await composer.click();
  await page.keyboard.type('/pi-ui-sequence');
  const send = page.getByTestId('v4-composer-send').filter({ visible: true }).first();
  for (let count = 0; count < 100 && !await send.isEnabled(); count++) await page.waitForTimeout(50);
  assert(await send.isEnabled(), 'composer must recover the Pi model catalog after early settings return');
  report.auth.customProviderRestored = true;
  await page.getByTestId('v4-composer-send').filter({ visible: true }).first().click();
  const dialog = page.getByTestId('v4-user-input-dialog');
  await dialog.waitFor({ timeout: 20_000 });
  await dialog.getByTestId('v4-user-input-option-beta').click();
  await dialog.getByText('Confirm the operation', { exact: true }).waitFor();
  await dialog.getByTestId('v4-user-input-option-false').click();
  await dialog.getByText('Optional text', { exact: true }).waitFor();
  await dialog.getByRole('button', { name: '提交', exact: true }).click();
  await dialog.getByText('Edit multiple lines', { exact: true }).waitFor();
  assert.equal(await dialog.getByTestId('v4-user-input-text').inputValue(), 'original\nvalue');
  await dialog.getByTestId('v4-user-input-text').fill('changed\nsecond line');
  await page.screenshot({ path: join(f.output, 'pi-extension-editor.png') });
  await dialog.getByRole('button', { name: '提交', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  let result;
  for (let count = 0; count < 100; count++) {
    try { result = JSON.parse(await readFile(resultFile, 'utf8')); break; }
    catch { await page.waitForTimeout(100); }
  }
  assert.deepEqual(result, { selected: 'beta', confirmed: false, input: '', edited: 'changed\nsecond line' });
  report.extension = result;
  await verifyPiPackageCleanup(f);
  assert.deepEqual(report.pageErrors, []);
  assert(!logs.join('').includes(secret), 'the API key must not enter process logs');
} catch (error) {
  report.error = error.stack || String(error);
  report.body = (await app?.windows()[0]?.locator('body').innerText().catch(() => ''))?.slice(0, 7000);
  process.exitCode = 1;
  console.error(error);
  await app?.windows()[0]?.screenshot({ path: join(f.output, 'pi-auth-extension-failure.png') }).catch(() => {});
} finally {
  try { report.cleanup = await closeOwned(app, f); assertCleanExit(report.cleanup, logs, 'Pi auth/extension GUI'); }
  catch (error) { report.cleanupError = String(error); process.exitCode = 1; }
  await model.close();
  await writeFile(join(f.output, 'pi-auth-extension-gui-report.json'), JSON.stringify(report, null, 2));
  await writeFile(join(f.output, 'pi-auth-extension-gui.log'), logs.join(''));
  console.log(JSON.stringify(report, null, 2));
}
