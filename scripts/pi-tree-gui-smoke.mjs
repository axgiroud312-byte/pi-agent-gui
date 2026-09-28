// Isolated native desktop GUI -> Host -> pinned Pi tree/label/reload probe.
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
const model = await startPiModel();
await configurePiProfile(f, { url: model.url, modelId: 'pi-native-test', apiKey: 'fixture-not-a-secret' });
const logs = [];
const report = { at: new Date().toISOString(), workspace: f.workspace, piVersion: '0.87.0',
  inference: 'deterministic loopback provider, not online provider', pageErrors: [] };
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
  await page.keyboard.type('PI_TEXT: tree control smoke');
  model.releaseText();
  await page.getByTestId('v4-composer-send').filter({ visible: true }).first().click();
  await page.getByText('PI_TEXT_COMPLETE', { exact: true }).waitFor({ timeout: 30_000 });
  assert(model.requests.some(request => request.scenario === 'PI_TEXT'));
  const firstSessionId = await page.locator('[data-testid^="v4-session-pane"]').filter({ visible: true }).first()
    .getAttribute('data-session-id');
  assert.ok(firstSessionId && firstSessionId !== 'draft');
  await page.getByTestId('pi-tree-open').click();
  const dialog = page.getByTestId('pi-tree-dialog');
  await dialog.waitFor();
  await dialog.getByText('Pi 0.87.0', { exact: false }).waitFor();
  const firstGeneration = await dialog.getAttribute('data-generation');
  assert(firstGeneration);
  const user = dialog.getByRole('treeitem').filter({ hasText: 'user: PI_TEXT: tree control smoke' }).first();
  await user.click();
  await dialog.locator('#pi-tree-label').fill('first checkpoint');
  await dialog.getByRole('button', { name: '保存标签' }).click();
  await dialog.getByRole('treeitem').filter({ hasText: 'first checkpoint' }).waitFor();
  await dialog.getByRole('button', { name: '重载扩展' }).click();
  await page.waitForFunction(first => {
    const element = document.querySelector('[data-testid="pi-tree-dialog"]');
    return element?.getAttribute('data-generation') && element.getAttribute('data-generation') !== first;
  }, firstGeneration, { timeout: 20_000 });
  const secondGeneration = await dialog.getAttribute('data-generation');
  assert.notEqual(secondGeneration, firstGeneration);
  await page.screenshot({ path: join(f.output, 'pi-tree-dialog.png') });
  await dialog.getByRole('treeitem').filter({ hasText: 'first checkpoint' }).first().click();
  await dialog.getByRole('button', { name: /编辑此输入|跳转到节点/ }).click();
  await dialog.waitFor({ state: 'hidden' });
  await page.getByTestId('v4-composer-input').filter({ visible: true }).first()
    .filter({ hasText: 'PI_TEXT: tree control smoke' }).waitFor();
  report.tree = { generationChanged: firstGeneration !== secondGeneration,
    label: 'first checkpoint', restoredText: await composer.innerText() };
  assert(report.tree.restoredText.includes('PI_TEXT: tree control smoke'));
  await page.screenshot({ path: join(f.output, 'pi-tree-restored.png') });
  await page.getByText('新建任务', { exact: true }).first().click();
  await page.getByTestId('chat-model-select-trigger').click();
  await page.getByTestId('chat-model-select-search').fill('pi-native-test');
  await page.getByRole('menuitemradio', { name: /pi-native-test/ }).first().click();
  await page.getByTestId('v4-composer-input').filter({ visible: true }).first().click();
  await page.keyboard.type('PI_TEXT: second tree session');
  await page.getByTestId('v4-composer-send').filter({ visible: true }).first().click();
  await page.locator('[data-testid^="v4-session-pane"]').filter({ visible: true }).first()
    .getByText('PI_TEXT_COMPLETE', { exact: true }).waitFor({ timeout: 30_000 });
  const secondSessionId = await page.locator('[data-testid^="v4-session-pane"]').filter({ visible: true }).first()
    .getAttribute('data-session-id');
  assert.ok(secondSessionId && secondSessionId !== firstSessionId);
  await page.locator(`[data-testid="task-item-${firstSessionId}"]`).click();
  await page.locator(`[data-session-id="${firstSessionId}"]`).filter({ visible: true }).waitFor();
  await page.getByTestId('pi-tree-open').click();
  await dialog.getByRole('treeitem').filter({ hasText: 'first checkpoint' }).waitFor();
  await page.keyboard.press('Escape');
  await page.locator(`[data-testid="task-item-${secondSessionId}"]`).click();
  await page.locator(`[data-session-id="${secondSessionId}"]`).filter({ visible: true }).waitFor();
  await page.evaluate(() => {
    window.__piTreeSawOldSession = false;
    window.__piTreeObserver = new MutationObserver(() => {
      const tree = document.querySelector('[data-testid="pi-tree-dialog"]');
      if (tree?.textContent?.includes('first checkpoint')) window.__piTreeSawOldSession = true;
    });
    window.__piTreeObserver.observe(document.body, { subtree: true, childList: true, characterData: true });
  });
  await page.getByTestId('pi-tree-open').click();
  await dialog.getByRole('treeitem').filter({ hasText: 'PI_TEXT: second tree session' }).waitFor();
  report.sessionIsolation = { firstSessionId, secondSessionId,
    sawOldSession: await page.evaluate(() => {
      window.__piTreeObserver.disconnect();
      return window.__piTreeSawOldSession;
    }) };
  assert.equal(report.sessionIsolation.sawOldSession, false,
    'Session B tree must never render session A bookmark while its Pi read is pending');
  await verifyPiPackageCleanup(f);
  assert.deepEqual(report.pageErrors, []);
} catch (error) {
  report.error = error.stack || String(error);
  report.body = (await app?.windows()[0]?.locator('body').innerText().catch(() => ''))?.slice(0, 7000);
  process.exitCode = 1;
  console.error(error);
  await app?.windows()[0]?.screenshot({ path: join(f.output, 'pi-tree-failure.png') }).catch(() => {});
} finally {
  try { report.cleanup = await closeOwned(app, f); assertCleanExit(report.cleanup, logs, 'Pi tree GUI'); }
  catch (error) { report.cleanupError = String(error); process.exitCode = 1; }
  await model.close();
  await writeFile(join(f.output, 'pi-tree-gui-report.json'), JSON.stringify(report, null, 2));
  await writeFile(join(f.output, 'pi-tree-gui.log'), logs.join(''));
  console.log(JSON.stringify(report, null, 2));
}
