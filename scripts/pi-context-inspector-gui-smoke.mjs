// Isolated production-source Electron -> Host -> fixed Pi context projection.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
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
await writeFile(join(extensionDir, 'context-edit.ts'), `export default function(pi) {
  let edited = false;
  pi.on('agent_before_settle', (event, ctx) => {
    if (edited) return;
    const first = ctx.sessionManager.getEntries().find(entry => entry.type === 'message' && entry.message.role === 'user');
    if (!first) return;
    edited = true;
    return { entries: [...event.entries, { type: 'context_edit', targetId: first.id,
      replacement: { content: [{ type: 'text', text: 'PI_REPLACED_GUI_CONTEXT' }] } }] };
  });
}`);
const logs = [];
const report = { at: new Date().toISOString(), workspace: f.workspace, piVersion: '0.87.0',
  providerBoundary: 'deterministic loopback provider, no online account', pageErrors: [] };
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
  assert(JSON.stringify(JSON.parse(await readFile(join(f.home, '.zcode', 'v2', 'provider_config.json'), 'utf8')))
    .includes('new-provider'));
  await page.getByTestId('settings-back-button').click();
  await page.getByTestId('settings-page').waitFor({ state: 'hidden' });
  await page.getByTestId('chat-model-select-trigger').click();
  await page.getByTestId('chat-model-select-search').fill('pi-native-test');
  await page.getByRole('menuitemradio', { name: /pi-native-test/ }).first().click();
  const composer = page.getByTestId('v4-composer-input').filter({ visible: true }).first();
  await composer.click();
  await page.keyboard.type('PI_TEXT: context inspector GUI original');
  model.releaseText();
  await page.getByTestId('v4-composer-send').filter({ visible: true }).first().click();
  await page.getByText('PI_TEXT_COMPLETE', { exact: true }).waitFor({ timeout: 30_000 });
  assert(model.requests.some(request => request.scenario === 'PI_TEXT'));
  await page.getByTestId('pi-context-open').click();
  const dialog = page.getByTestId('pi-context-dialog');
  await dialog.waitFor();
  await dialog.getByText('PI_TEXT: context inspector GUI original', { exact: false }).waitFor();
  const history = await dialog.getByTestId('pi-context-page').innerText();
  assert(history.includes('PI_TEXT: context inspector GUI original'));
  await page.screenshot({ path: join(f.output, 'pi-context-history.png') });
  await dialog.getByTestId('pi-context-tab-effective').click();
  await dialog.getByText('PI_REPLACED_GUI_CONTEXT', { exact: true }).waitFor();
  const effective = await dialog.getByTestId('pi-context-page').innerText();
  assert(!effective.includes('context inspector GUI original'));
  await page.screenshot({ path: join(f.output, 'pi-context-current.png') });
  await dialog.getByTestId('pi-context-tab-edits').click();
  await dialog.getByText('PI_REPLACED_GUI_CONTEXT', { exact: true }).waitFor();
  const edits = await dialog.getByTestId('pi-context-page').innerText();
  assert(edits.includes('目标 Pi ID:'));
  await dialog.getByTestId('pi-context-tab-summaries').click();
  await dialog.getByText('此页没有 Pi 记录。', { exact: true }).waitFor();
  report.inspection = { rawOriginal: true, currentReplacement: true, realContextEdit: true,
    summariesEmptyBeforeCompaction: true, imagePathNotExercised: true };
  await verifyPiPackageCleanup(f);
  assert.deepEqual(report.pageErrors, []);
} catch (error) {
  report.error = error.stack || String(error);
  report.body = (await app?.windows()[0]?.locator('body').innerText().catch(() => ''))?.slice(0, 7000);
  process.exitCode = 1;
  console.error(error);
  await app?.windows()[0]?.screenshot({ path: join(f.output, 'pi-context-failure.png') }).catch(() => {});
} finally {
  try { report.cleanup = await closeOwned(app, f); assertCleanExit(report.cleanup, logs, 'Pi context GUI'); }
  catch (error) { report.cleanupError = String(error); process.exitCode = 1; }
  await model.close();
  await writeFile(join(f.output, 'pi-context-gui-report.json'), JSON.stringify(report, null, 2));
  await writeFile(join(f.output, 'pi-context-gui.log'), logs.join(''));
  console.log(JSON.stringify(report, null, 2));
}
