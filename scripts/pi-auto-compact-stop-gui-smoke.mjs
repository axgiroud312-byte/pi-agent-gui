// Native GUI -> Host -> fixed Pi overflow recovery compaction -> Stop.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixture } from './native-smoke/fixture.mjs';
import { closeOwned, assertCleanExit } from './native-smoke/cleanup.mjs';
import { startPiModel } from './native-smoke/pi-model.mjs';
import { configurePiProfile, isolatePiPackage, verifyPiPackageCleanup } from './native-smoke/pi-package.mjs';

const f = await fixture();
await isolatePiPackage(f);
const model = await startPiModel({ holdAfterRequests: 3, overflowAtRequest: 3 });
await configurePiProfile(f, { url: model.url, modelId: 'pi-native-test', apiKey: 'fixture-not-a-secret' });
const settingsPath = join(f.sandbox, 'pi-profile', 'settings.json');
const settings = JSON.parse(await readFile(settingsPath, 'utf8'));
settings.compaction = { enabled: true, keepRecentTokens: 1, reserveTokens: 1000 };
settings.retry = { enabled: false };
await writeFile(settingsPath, JSON.stringify(settings));
const report = { at: new Date().toISOString(), workspace: f.workspace, piVersion: '0.87.0',
  inference: 'deterministic loopback provider, not online provider', pageErrors: [] };
const logs = [];
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
  await page.getByTestId('v4-composer-input').waitFor();
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
  const composer = page.getByTestId('v4-composer-input').filter({ visible: true }).first();
  await composer.click();
  for (const [index, prompt] of ['first turn before overflow', 'second turn before overflow'].entries()) {
    await composer.click();
    await page.keyboard.type(prompt);
    await page.getByTestId('v4-composer-send').filter({ visible: true }).first().click();
    for (let attempt = 0; attempt < 100 && model.requests.length < index + 1; attempt++) {
      await page.waitForTimeout(100);
    }
    assert.equal(model.requests.length, index + 1);
    await page.getByText('PI_TEXT_COMPLETE', { exact: true }).nth(index).waitFor({ timeout: 30_000 });
    await page.getByTestId('v4-stop').filter({ visible: true }).first().waitFor({ state: 'hidden' });
  }
  assert.equal(model.requests.length, 2);
  await composer.click();
  await page.keyboard.type('third turn triggers overflow');
  await page.getByTestId('v4-composer-send').filter({ visible: true }).first().click();
  await page.getByTestId('v4-stop').filter({ visible: true }).first().waitFor({ timeout: 15_000 });
  for (let attempt = 0; attempt < 100 && model.held === 0; attempt++) await page.waitForTimeout(50);
  assert.equal(model.requests.length, 4, 'fixed Pi must request a summary after the controlled context error');
  assert.equal(model.held, 1, 'fixed Pi must be waiting on its automatic overflow summary');
  assert.match(model.requests[2]?.promptText ?? '', /third turn triggers overflow/);
  assert.notEqual(model.requests[3]?.promptText.trim(), 'third turn triggers overflow',
    'the held request must be Pi compaction, not a duplicate user prompt');
  await page.getByTestId('v4-stop').filter({ visible: true }).first().click();
  await page.getByTestId('v4-stop').filter({ visible: true }).first().waitFor({ state: 'hidden', timeout: 15_000 });
  assert.equal(model.requests.length, 4, 'Stop must not start a post-compaction model retry');
  for (let attempt = 0; attempt < 100 && model.held > 0; attempt++) await page.waitForTimeout(50);
  assert.equal(model.held, 0, 'Pi must close the aborted summary request');
  assert.match(await page.locator('body').innerText(), /first turn before overflow/);
  assert.match(await page.locator('body').innerText(), /second turn before overflow/);
  assert.match(await page.locator('body').innerText(), /third turn triggers overflow/);
  report.autoCompaction = { overflowReachedFixedPi: true, summaryRequestedByFixedPi: true, stopCancelledSummary: true,
    retainedHistory: true, noLateRetry: true };
  await page.screenshot({ path: join(f.output, 'pi-auto-compact-stopped.png') });
  await verifyPiPackageCleanup(f);
  assert.deepEqual(report.pageErrors, []);
} catch (error) {
  report.error = error.stack || String(error);
  report.body = (await app?.windows()[0]?.locator('body').innerText().catch(() => ''))?.slice(0, 7000);
  process.exitCode = 1;
  console.error(error);
  await app?.windows()[0]?.screenshot({ path: join(f.output, 'pi-auto-compact-failure.png') }).catch(() => {});
} finally {
  try { report.cleanup = await closeOwned(app, f); assertCleanExit(report.cleanup, logs, 'Pi auto compaction GUI'); }
  catch (error) { report.cleanupError = String(error); process.exitCode = 1; }
  await model.close();
  await writeFile(join(f.output, 'pi-auto-compact-gui-report.json'), JSON.stringify(report, null, 2));
  await writeFile(join(f.output, 'pi-auto-compact-gui.log'), logs.join(''));
  console.log(JSON.stringify(report, null, 2));
}
