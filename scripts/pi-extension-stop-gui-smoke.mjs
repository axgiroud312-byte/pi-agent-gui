// Native GUI -> Host -> one fixed Pi 0.87.0 RPC child: Stop at each extension dialog kind.
import assert from 'node:assert/strict';
import { copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
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
const extensionDir = join(f.env.PI_CODING_AGENT_DIR, 'extensions');
await mkdir(extensionDir, { recursive: true });
await copyFile(fileURLToPath(new URL('../packages/services/test/fixtures/pi-ui-sequence.ts', import.meta.url)),
  join(extensionDir, 'pi-ui-sequence.ts'));
const resultFile = join(f.sandbox, 'pi-ui-stop-result.json');
f.env.NATIVE_SMOKE_PI_UI_RESULT_FILE = resultFile;
const logs = [];
const report = { at: new Date().toISOString(), piVersion: '0.87.0',
  boundary: 'source Electron GUI -> Host -> fixed Pi RPC child with a controlled local model',
  pageErrors: [], stops: [] };
let app;
async function dismissOnboarding(page) {
  for (let step = 0; step < 5; step++) {
    const button = page.getByRole('button', {
      name: /^(使用 API key|Use API key|暂时跳过|跳过|Skip for now|Skip|退出引导|Exit onboarding)$/,
      exact: true,
    }).filter({ visible: true }).first();
    if (!await button.isVisible()) return;
    await button.click();
    await page.waitForTimeout(1200);
  }
}
async function bookmark() {
  const directory = join(f.home, '.zcode', 'v2', 'pi-sessions');
  const files = (await readdir(directory)).filter(name => name.endsWith('.json'));
  assert.equal(files.length, 1, 'one GUI session must bind one Pi history bookmark');
  return JSON.parse(await readFile(join(directory, files[0]), 'utf8'));
}
try {
  app = await f.playwright._electron.launch({ executablePath: f.electronPath,
    args: [fileURLToPath(new URL('./native-smoke/bootstrap.cjs', import.meta.url)), '--lang=zh-CN'],
    cwd: f.root, env: f.env, timeout: 60_000 });
  app.process().stdout?.on('data', chunk => logs.push(String(chunk)));
  app.process().stderr?.on('data', chunk => logs.push(String(chunk)));
  let page = await app.firstWindow();
  page.setDefaultTimeout(15_000);
  page.on('pageerror', error => report.pageErrors.push(error.stack || error.message));
  await page.waitForTimeout(6000);
  await dismissOnboarding(page);
  await page.getByRole('button', { name: '添加项目', exact: true }).click();
  await page.getByRole('menuitem', { name: '打开文件夹', exact: true }).click();
  const composer = page.getByTestId('v4-composer-input').filter({ visible: true }).first();
  await composer.waitFor();
  await page.getByTestId('sidebar').getByTestId('task-settings-button').click();
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
  await composer.click();
  await page.keyboard.type('PI_TEXT: establish Pi session for stop matrix');
  model.releaseText();
  await page.getByTestId('v4-composer-send').filter({ visible: true }).first().click();
  await page.getByText('PI_TEXT_COMPLETE', { exact: true }).first().waitFor({ timeout: 30_000 });

  for (const method of ['select', 'confirm', 'input', 'editor']) {
    await composer.click();
    await page.keyboard.insertText('/pi-ui-sequence');
    await page.getByTestId('v4-composer-send').filter({ visible: true }).first().click();
    const dialog = page.getByTestId('v4-user-input-dialog');
    await dialog.waitFor({ timeout: 20_000 });
    if (method !== 'select') {
      await dialog.getByTestId('v4-user-input-option-alpha').click();
      await dialog.getByText('Confirm the operation', { exact: true }).waitFor();
    }
    if (method === 'input' || method === 'editor') {
      await dialog.getByTestId('v4-user-input-option-false').click();
      await dialog.getByText('Optional text', { exact: true }).waitFor();
    }
    if (method === 'editor') {
      await dialog.getByRole('button', { name: '提交', exact: true }).click();
      await dialog.getByText('Edit multiple lines', { exact: true }).waitFor();
    }
    await page.screenshot({ path: join(f.output, `pi-extension-stop-${method}-before.png`) });
    const stop = dialog.getByTestId('pi-extension-stop');
    assert(await stop.isVisible(), `Stop must be reachable inside the ${method} modal`);
    await stop.click();
    await dialog.waitFor({ state: 'hidden', timeout: 20_000 });
    await page.waitForTimeout(500);
    assert.equal(await dialog.count(), 0, `no later dialog may revive after ${method} Stop`);
    report.stops.push({ method, stopped: true, noRevivedDialog: true });
  }
  await composer.click();
  await page.keyboard.type('PI_TEXT: follow up after stopped Pi extension dialogs');
  await page.getByTestId('v4-composer-send').filter({ visible: true }).first().click();
  await page.getByText('PI_TEXT_COMPLETE', { exact: true }).nth(1).waitFor({ timeout: 30_000 });
  assert.equal(model.requests.filter(request => request.scenario === 'PI_TEXT').length, 2);
  report.followUpModelRun = true;
  report.lastExtensionResult = JSON.parse(await readFile(resultFile, 'utf8'));
  const beforeRestart = await bookmark();
  const modelRequestsBeforeRestart = model.requests.length;
  report.firstCleanup = await closeOwned(app, f);
  assertCleanExit(report.firstCleanup, logs, 'Pi extension Stop restart');
  app = undefined;
  app = await f.playwright._electron.launch({ executablePath: f.electronPath,
    args: [fileURLToPath(new URL('./native-smoke/bootstrap.cjs', import.meta.url)), '--lang=zh-CN'],
    cwd: f.root, env: f.env, timeout: 60_000 });
  app.process().stdout?.on('data', chunk => logs.push(String(chunk)));
  app.process().stderr?.on('data', chunk => logs.push(String(chunk)));
  page = await app.firstWindow();
  page.setDefaultTimeout(15_000);
  page.on('pageerror', error => report.pageErrors.push(error.stack || error.message));
  await page.waitForTimeout(6000);
  await dismissOnboarding(page);
  const oldTurn = page.locator('section[data-turn-id]')
    .filter({ hasText: 'PI_TEXT: establish Pi session for stop matrix' }).first();
  if (!await oldTurn.isVisible()) {
    await page.locator('[data-testid^="task-item-"]')
      .filter({ hasText: 'PI_TEXT: establish Pi session for stop matrix' }).first().click();
  }
  await oldTurn.waitFor({ timeout: 30_000 });
  assert.equal(await page.getByTestId('v4-user-input-dialog').count(), 0,
    'a stopped extension dialog must not revive after app restart');
  assert.equal(model.requests.length, modelRequestsBeforeRestart,
    'restarting must not replay stopped extension or model prompts');
  const afterRestart = await bookmark();
  assert.equal(afterRestart.sessionFile, beforeRestart.sessionFile);
  report.restart = { samePiSessionFile: true, dialogRevived: false,
    modelRequestReplay: false };
  await verifyPiPackageCleanup(f);
  assert.deepEqual(report.pageErrors, []);
} catch (error) {
  report.error = error.stack || String(error);
  process.exitCode = 1;
  await app?.windows()[0]?.screenshot({ path: join(f.output, 'pi-extension-stop-failure.png') }).catch(() => {});
} finally {
  try { report.cleanup = await closeOwned(app, f); assertCleanExit(report.cleanup, logs, 'Pi extension Stop GUI'); }
  catch (error) { report.cleanupError = String(error); process.exitCode = 1; }
  await model.close();
  await writeFile(join(f.output, 'pi-extension-stop-gui-report.json'), JSON.stringify(report, null, 2));
  await writeFile(join(f.output, 'pi-extension-stop-gui.log'), logs.join(''));
  console.log(JSON.stringify(report, null, 2));
}
