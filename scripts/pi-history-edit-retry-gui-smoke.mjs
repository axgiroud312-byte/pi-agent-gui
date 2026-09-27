// Native production renderer -> Host -> fixed Pi 0.87.0 historical branch retry and edit.
import assert from 'node:assert/strict';
import { readFile, readdir, writeFile } from 'node:fs/promises';
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
  inference: 'deterministic loopback provider, not an online provider', pageErrors: [] };
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
  const send = async prompt => {
    await composer.click();
    await page.keyboard.type(prompt);
    await page.getByTestId('v4-composer-send').filter({ visible: true }).first().click();
  };
  const waitForRequests = async count => {
    for (let i = 0; i < 120 && model.requests.length < count; i++) await page.waitForTimeout(250);
    assert.equal(model.requests.length, count, `expected ${count} fixed Pi model requests`);
  };
  await send('history-one');
  await waitForRequests(1);
  await page.getByText('PI_TEXT_COMPLETE', { exact: true }).first().waitFor({ timeout: 30_000 });
  await send('history-two');
  await waitForRequests(2);
  await page.getByText('PI_TEXT_COMPLETE', { exact: true }).nth(1).waitFor({ timeout: 30_000 });
  const files = await jsonls();
  assert.equal(files.length, 1, 'history retry stays in the same Pi session file');
  const sourceFile = files[0];
  const beforeRetry = await readFile(sourceFile);
  await page.getByTestId('pi-tree-open').click();
  let dialog = page.getByTestId('pi-tree-dialog');
  await dialog.getByRole('treeitem').filter({ hasText: 'user: history-two' }).first().click();
  await page.screenshot({ path: join(f.output, 'history-retry-selected.png') });
  await dialog.getByTestId('pi-tree-retry').click();
  await dialog.waitFor({ state: 'hidden', timeout: 30_000 });
  await waitForRequests(3);
  await page.getByText('PI_TEXT_COMPLETE', { exact: true }).nth(1).waitFor({ timeout: 30_000 });
  assert.deepEqual(model.requests.map(item => item.promptText), ['history-one', 'history-two', 'history-two']);
  const afterRetry = await readFile(sourceFile);
  assert(afterRetry.subarray(0, beforeRetry.length).equals(beforeRetry), 'Pi must append a branch, preserving old JSONL');
  assert.equal((afterRetry.toString('utf8').match(/history-two/g) ?? []).length, 2);
  report.retry = { samePiJsonl: sourceFile, preservedOldBytes: true, providerRequests: 3 };
  await page.screenshot({ path: join(f.output, 'history-retry-branch.png') });
  await page.getByTestId('pi-tree-open').click();
  dialog = page.getByTestId('pi-tree-dialog');
  await dialog.getByRole('treeitem').filter({ hasText: 'user: history-one' }).first().click();
  await dialog.getByRole('button', { name: '编辑此输入' }).click();
  await dialog.waitFor({ state: 'hidden', timeout: 30_000 });
  await composer.filter({ hasText: 'history-one' }).waitFor({ timeout: 20_000 });
  assert.equal(model.requests.length, 3, 'editing must wait for explicit user send');
  report.editPrefill = { originalText: await composer.innerText(), noModelCallUntilSend: true };
  await page.screenshot({ path: join(f.output, 'history-edit-prefill.png') });
  await composer.click();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.type('history-one-edited');
  await page.getByTestId('v4-composer-send').filter({ visible: true }).first().click();
  await waitForRequests(4);
  assert.equal(model.requests[3]?.promptText, 'history-one-edited');
  const afterEdit = await readFile(sourceFile);
  assert(afterEdit.subarray(0, afterRetry.length).equals(afterRetry));
  assert.equal((await jsonls()).length, 1, 'edit remains a Pi branch in the same JSONL');
  report.editSent = { originalBranchPreserved: true, fixedPiPrompt: model.requests[3]?.promptText };
  await page.screenshot({ path: join(f.output, 'history-edit-branch.png') });
  await verifyPiPackageCleanup(f);
  assert.deepEqual(report.pageErrors, []);
} catch (error) {
  report.error = error.stack || String(error);
  report.body = (await app?.windows()[0]?.locator('body').innerText().catch(() => ''))?.slice(-7000);
  process.exitCode = 1;
  console.error(error);
  await app?.windows()[0]?.screenshot({ path: join(f.output, 'history-edit-retry-failure.png') }).catch(() => {});
} finally {
  try { report.cleanup = await closeOwned(app, f); assertCleanExit(report.cleanup, logs, 'Pi history edit/retry GUI'); }
  catch (error) { report.cleanupError = String(error); process.exitCode = 1; }
  await model.close();
  await writeFile(join(f.output, 'pi-history-edit-retry-gui-report.json'), JSON.stringify(report, null, 2));
  await writeFile(join(f.output, 'pi-history-edit-retry-gui.log'), logs.join(''));
  console.log(JSON.stringify(report, null, 2));
}
