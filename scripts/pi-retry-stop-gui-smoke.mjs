// Native GUI -> Host -> fixed Pi auto retry backoff -> Stop, without late model work.
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
const model = await startPiModel({ failFirstRequests: 100 });
await configurePiProfile(f, { url: model.url, modelId: 'pi-native-test', apiKey: 'fixture-not-a-secret' });
const settingsPath = join(f.sandbox, 'pi-profile', 'settings.json');
const settings = JSON.parse(await readFile(settingsPath, 'utf8'));
settings.retry = { enabled: true, maxRetries: 2, baseDelayMs: 8_000, provider: { maxRetries: 0 } };
settings.compaction = { enabled: false };
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
  await page.getByRole('menuitem', { name: '新供应商', exact: true }).press('ArrowRight');
  await page.getByText('pi-native-test', { exact: true }).click();
  await page.keyboard.press('Escape');
  const composer = page.getByTestId('v4-composer-input').filter({ visible: true }).first();
  await composer.click();
  await page.keyboard.type('stop Pi retry before another provider request');
  await page.getByTestId('v4-composer-send').filter({ visible: true }).first().click();
  for (let attempt = 0; attempt < 100 && model.requests.length < 1; attempt++) await page.waitForTimeout(50);
  assert.equal(model.requests.length, 1);
  await page.waitForTimeout(1000); // First 503 response has reached Pi's backoff window.
  await page.getByTestId('v4-stop').filter({ visible: true }).first().click();
  await page.getByTestId('v4-stop').filter({ visible: true }).first().waitFor({ state: 'hidden', timeout: 15_000 });
  await page.waitForTimeout(9000); // Longer than configured Pi retry delay.
  assert.equal(model.requests.length, 1, 'Pi must not make a late retry after native Stop');
  assert.match(await page.locator('body').innerText(), /stop Pi retry before another provider request/);
  report.retryStop = { firstFailureReachedFixedPi: true, stoppedBeforeRetry: true, noLateRequest: true };
  await page.screenshot({ path: join(f.output, 'pi-retry-stopped.png') });
  await verifyPiPackageCleanup(f);
  assert.deepEqual(report.pageErrors, []);
} catch (error) {
  report.error = error.stack || String(error);
  report.body = (await app?.windows()[0]?.locator('body').innerText().catch(() => ''))?.slice(0, 7000);
  process.exitCode = 1;
  console.error(error);
  await app?.windows()[0]?.screenshot({ path: join(f.output, 'pi-retry-stop-failure.png') }).catch(() => {});
} finally {
  try { report.cleanup = await closeOwned(app, f); assertCleanExit(report.cleanup, logs, 'Pi retry Stop GUI'); }
  catch (error) { report.cleanupError = String(error); process.exitCode = 1; }
  await model.close();
  await writeFile(join(f.output, 'pi-retry-stop-gui-report.json'), JSON.stringify(report, null, 2));
  await writeFile(join(f.output, 'pi-retry-stop-gui.log'), logs.join(''));
  console.log(JSON.stringify(report, null, 2));
}
