// Native Electron -> Host file save ACK race, with a real fixed Pi session.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixture } from './native-smoke/fixture.mjs';
import { assertCleanExit, closeOwned } from './native-smoke/cleanup.mjs';
import { startPiModel } from './native-smoke/pi-model.mjs';
import { configurePiProfile, isolatePiPackage, verifyPiPackageCleanup } from './native-smoke/pi-package.mjs';

const f = await fixture();
f.env.NATIVE_SMOKE_FILE_SAVE_ACK_DELAY_MS = '1800';
const pathA = join(f.workspace, 'A race.txt');
const pathB = join(f.workspace, 'B race.txt');
await writeFile(pathA, 'A disk', 'utf8');
await writeFile(pathB, 'B disk', 'utf8');
await isolatePiPackage(f);
const model = await startPiModel();
await configurePiProfile(f, { url: model.url, modelId: 'pi-native-test', apiKey: 'fixture-not-a-secret' });
const launchArgs = [fileURLToPath(new URL('./native-smoke/bootstrap.cjs', import.meta.url)), '--lang=zh-CN'];
const report = { at: new Date().toISOString(), piVersion: '0.87.0', pageErrors: [],
  hostAckDelayMs: 1800, modelBoundary: 'real pinned Pi RPC + deterministic loopback model' };
const logs = [];
let app;

async function openTreeFile(page, name) {
  if (!await page.getByTestId('workspace-file-tree-panel').isVisible()) {
    await page.getByText('parity-workspace', { exact: true }).first().hover();
    await page.locator('[data-testid^="workspace-file-tree-button"]').click();
  }
  await page.getByTestId('workspace-file-tree-panel').getByText(name, { exact: true }).first().dblclick();
  await page.locator('[data-side-pane-tab-id]').filter({ hasText: name }).waitFor();
  return page.getByTestId('preview-pane').filter({ visible: true }).first();
}

try {
  app = await f.playwright._electron.launch({ executablePath: f.electronPath,
    args: launchArgs, cwd: f.root, env: f.env, timeout: 60_000 });
  app.process().stdout?.on('data', chunk => logs.push(String(chunk)));
  app.process().stderr?.on('data', chunk => logs.push(String(chunk)));
  const page = await app.firstWindow();
  page.setDefaultTimeout(15_000);
  page.on('pageerror', error => report.pageErrors.push(error.stack || error.message));
  await page.waitForTimeout(6000);
  for (const name of [/^(使用 API key|Use API key)$/, /^(暂时跳过|Skip for now)$/, /^(退出引导|Exit onboarding)$/]) {
    const button = page.getByRole('button', { name, exact: true });
    if (await button.isVisible()) { await button.click(); await page.waitForTimeout(1500); }
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
  const composer = page.getByTestId('v4-composer-input').filter({ visible: true }).first();
  await composer.click();
  await page.keyboard.type('PI_HELLO: read hello.txt');
  await page.getByTestId('v4-composer-send').filter({ visible: true }).first().click();
  await page.getByText('PI_HELLO_COMPLETE', { exact: true }).waitFor({ timeout: 30_000 });
  assert(model.requests.some(request => request.scenario === 'PI_HELLO'));
  report.fixedPiRequest = model.requests.filter(request => request.scenario === 'PI_HELLO').length;

  const paneA = await openTreeFile(page, 'A race.txt');
  await paneA.getByRole('button', { name: '编辑文件' }).click();
  const editorA = paneA.getByRole('textbox', { name: '文件内容' });
  await editorA.fill('A first save');
  await paneA.getByRole('button', { name: '保存', exact: true }).click();
  await paneA.getByRole('button', { name: '保存中…' }).waitFor();
  await editorA.fill('A newer unsaved draft');
  await paneA.getByText('未保存；草稿会在重启后恢复').waitFor();
  await paneA.getByRole('button', { name: '保存中…' }).waitFor({ state: 'hidden', timeout: 15_000 });
  report.newerInput = { editor: await editorA.inputValue(), disk: await readFile(pathA, 'utf8'),
    draft: await page.evaluate(() => Object.values(localStorage).find(value => value.includes('A newer unsaved draft')) ?? null) };
  assert.equal(report.newerInput.editor, 'A newer unsaved draft');
  assert.equal(report.newerInput.disk, 'A first save');
  assert(report.newerInput.draft, 'newer input must remain in durable localStorage after old Host ACK');
  await page.screenshot({ path: join(f.output, 'file-save-race-newer-draft.png') });

  await paneA.getByRole('button', { name: '返回预览，草稿会保留' }).click();
  await paneA.getByRole('button', { name: '编辑文件' }).click();
  assert.equal(await paneA.getByRole('textbox', { name: '文件内容' }).inputValue(), 'A newer unsaved draft');
  await paneA.getByRole('button', { name: '保存', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('[data-testid="pi-file-editor"]'));
  assert.equal(await readFile(pathA, 'utf8'), 'A newer unsaved draft');
  report.followupSave = true;

  const paneB = await openTreeFile(page, 'B race.txt');
  await paneB.getByRole('button', { name: '编辑文件' }).click();
  const editorB = paneB.getByRole('textbox', { name: '文件内容' });
  await editorB.fill('B independent draft');
  report.secondTargetDraft = await editorB.inputValue();
  assert.equal(report.secondTargetDraft, 'B independent draft');
  await verifyPiPackageCleanup(f);
  assert.deepEqual(report.pageErrors, []);
  report.ok = true;
} catch (error) {
  report.error = error.stack || String(error);
  report.body = (await app?.windows()[0]?.locator('body').innerText().catch(() => ''))?.slice(-4500);
  process.exitCode = 1;
  console.error(error);
  await app?.windows()[0]?.screenshot({ path: join(f.output, 'file-save-race-failure.png') }).catch(() => {});
} finally {
  try { report.cleanup = await closeOwned(app, f); assertCleanExit(report.cleanup, logs, '#14 file save race'); }
  catch (error) { report.cleanupError = String(error); process.exitCode = 1; }
  await model.close();
  await mkdir(f.output, { recursive: true });
  await writeFile(join(f.output, 'pi-file-save-race-gui-report.json'), JSON.stringify(report, null, 2));
  await writeFile(join(f.output, 'pi-file-save-race-gui.log'), logs.join(''));
  console.log(JSON.stringify(report, null, 2));
}
