// Native production renderer -> Host -> pinned Pi --no-session; no resumable JSONL after a real turn.
import assert from 'node:assert/strict';
import { readdir, writeFile } from 'node:fs/promises';
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
const report = { at: new Date().toISOString(), piVersion: '0.87.0', workspace: f.workspace,
  inference: 'deterministic loopback provider, not an online provider', pageErrors: [], cleanup: [] };
const logs = [];
const jsonls = async () => {
  const root = join(f.sandbox, 'pi-profile', 'sessions');
  const found = [];
  const visit = async path => {
    for (const entry of await readdir(path, { withFileTypes: true }).catch(() => [])) {
      const target = join(path, entry.name);
      if (entry.isDirectory()) await visit(target);
      else if (entry.isFile() && entry.name.endsWith('.jsonl')) found.push(target);
    }
  };
  await visit(root);
  return found;
};
const launch = async () => {
  const application = await f.playwright._electron.launch({ executablePath: f.electronPath,
    args: [fileURLToPath(new URL('./native-smoke/bootstrap.cjs', import.meta.url)), '--lang=zh-CN'],
    cwd: f.root, env: f.env, timeout: 60_000 });
  application.process().stdout?.on('data', chunk => logs.push(String(chunk)));
  application.process().stderr?.on('data', chunk => logs.push(String(chunk)));
  const page = await application.firstWindow();
  page.setDefaultTimeout(15_000);
  page.on('pageerror', error => report.pageErrors.push(error.stack || error.message));
  await page.waitForTimeout(6000);
  return { application, page };
};
let app;
try {
  let started = await launch();
  app = started.application;
  let page = started.page;
  for (const name of [/^(使用 API key|Use API key)$/, /^(暂时跳过|Skip for now)$/, /^(退出引导|Exit onboarding)$/]) {
    const button = page.getByRole('button', { name, exact: true });
    if (await button.isVisible()) { await button.click(); await page.waitForTimeout(1800); }
  }
  await page.getByRole('button', { name: '添加项目', exact: true }).click();
  await page.getByRole('menuitem', { name: '打开文件夹', exact: true }).click();
  await page.getByTestId('composer-workspace-trigger').filter({ hasText: 'parity-workspace' }).waitFor();
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
  await page.keyboard.press('Escape');
  const toggle = page.getByTestId('pi-temporary-session-toggle');
  await toggle.waitFor();
  assert.equal(await toggle.getAttribute('aria-pressed'), 'false');
  await toggle.click();
  assert.equal(await toggle.getAttribute('aria-pressed'), 'true');
  await page.screenshot({ path: join(f.output, 'temporary-draft-selected.png') });
  const composer = page.getByTestId('v4-composer-input').filter({ visible: true }).first();
  await composer.click();
  await page.keyboard.type('temporary-pi-run');
  await page.getByTestId('v4-composer-send').filter({ visible: true }).first().click();
  for (let attempt = 0; attempt < 120 && model.requests.length < 1; attempt++) await page.waitForTimeout(250);
  assert.equal(model.requests.length, 1, 'a real pinned Pi model turn must run');
  await page.getByText('PI_TEXT_COMPLETE', { exact: true }).first().waitFor({ timeout: 30_000 });
  await page.getByTestId('pi-temporary-session-indicator').waitFor();
  assert.equal((await jsonls()).length, 0, 'temporary Pi run must not create JSONL');
  assert.equal(await page.getByTestId('pi-transfer-open').count(), 0,
    'temporary session has no JSONL transfer action');
  report.turn = { piRequests: model.requests.length, prompt: model.requests[0]?.promptText,
    temporaryIndicator: true, jsonlFiles: await jsonls() };
  await page.screenshot({ path: join(f.output, 'temporary-run.png') });
  report.cleanup.push(await closeOwned(app, f));
  assertCleanExit(report.cleanup.at(-1), logs, 'Pi temporary GUI first run');
  app = undefined;

  started = await launch();
  app = started.application;
  page = started.page;
  assert.equal((await jsonls()).length, 0);
  assert.equal(await page.getByTestId('pi-temporary-session-indicator').count(), 0,
    'Pi temporary session must not be restored after app restart');
  report.restart = { jsonlFiles: await jsonls(), temporarySessionRestored: false };
  await verifyPiPackageCleanup(f);
  assert.deepEqual(report.pageErrors, []);
} catch (error) {
  report.error = error.stack || String(error);
  report.body = (await app?.windows()[0]?.locator('body').innerText().catch(() => ''))?.slice(-7000);
  process.exitCode = 1;
  console.error(error);
  await app?.windows()[0]?.screenshot({ path: join(f.output, 'temporary-failure.png') }).catch(() => {});
} finally {
  if (app) {
    try { report.cleanup.push(await closeOwned(app, f)); assertCleanExit(report.cleanup.at(-1), logs,
      'Pi temporary GUI final run'); }
    catch (error) { report.cleanupError = String(error); process.exitCode = 1; }
  }
  await model.close();
  await writeFile(join(f.output, 'pi-temporary-session-gui-report.json'), JSON.stringify(report, null, 2));
  await writeFile(join(f.output, 'pi-temporary-session-gui.log'), logs.join(''));
  console.log(JSON.stringify(report, null, 2));
}
