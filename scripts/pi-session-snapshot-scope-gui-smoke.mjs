// Native production renderer -> Host -> fixed Pi 0.87.0. Detect even a transient A projection in B.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
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
await writeFile(join(extensionDir, 'session-snapshot-scope.ts'), `export default function(pi) {
  pi.on('before_agent_start', (event, ctx) => {
    if (!event.prompt.includes('A_PRIVATE_START')) return;
    ctx.ui.setStatus('session-scope', 'A_PRIVATE_EXTENSION_STATUS');
    ctx.ui.setWidget('session-scope', ['A_PRIVATE_EXTENSION_WIDGET'], { placement: 'belowEditor' });
    ctx.ui.setTitle('A_PRIVATE_EXTENSION_TITLE');
    ctx.ui.setEditorText('A_PRIVATE_EXTENSION_EDITOR');
  });
}`);
const logs = [];
const report = { at: new Date().toISOString(), piVersion: '0.87.0',
  inference: 'deterministic loopback provider, not online provider', pageErrors: [],
  privateTextLeakedInB: null, oldQueueVisibleInB: null };
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

  const pane = () => page.locator('[data-testid^="v4-session-pane"]').filter({ visible: true }).first();
  const activeId = () => pane().getAttribute('data-session-id');
  const chooseModel = async () => {
    await page.getByTestId('chat-model-select-trigger').click();
    await page.getByTestId('chat-model-select-search').fill('pi-native-test');
    await page.getByRole('menuitemradio', { name: /pi-native-test/ }).first().click();
  };
  const send = async text => {
    await page.getByTestId('v4-composer-input').filter({ visible: true }).first().click();
    await page.keyboard.type(text);
    model.releaseText();
    await page.getByTestId('v4-composer-send').filter({ visible: true }).first().click();
    await pane().getByText('PI_TEXT_COMPLETE', { exact: true }).last().waitFor({ timeout: 30_000 });
  };
  await chooseModel();
  await send('PI_TEXT: B_PUBLIC_START');
  const sessionB = await activeId();
  assert.ok(sessionB);
  await page.getByText('新建任务', { exact: true }).first().click();
  await chooseModel();
  await send('PI_TEXT: A_PRIVATE_START');
  const sessionA = await activeId();
  assert.ok(sessionA && sessionA !== sessionB);
  await pane().getByText('A_PRIVATE_EXTENSION_STATUS').waitFor();
  await pane().getByText('A_PRIVATE_EXTENSION_WIDGET').waitFor();
  report.extensionVisibleInA = true;

  await page.getByTestId('v4-composer-input').filter({ visible: true }).first().click();
  await page.keyboard.type('PI_STOP: keep A running');
  await page.getByTestId('v4-composer-send').filter({ visible: true }).first().click();
  await page.waitForFunction(() => document.querySelector('[data-testid="v4-stop"]')?.getClientRects().length);
  await page.getByTestId('v4-composer-input').filter({ visible: true }).first().click();
  await page.keyboard.type('A_PRIVATE_QUEUED_MESSAGE');
  await page.getByTestId('v4-composer-send').filter({ visible: true }).first().click();
  await pane().getByTestId('v4-queue').getByText('A_PRIVATE_QUEUED_MESSAGE').waitFor();

  await page.evaluate(b => {
    window.__scopeLeaks = [];
    const inspect = () => {
      const active = [...document.querySelectorAll('[data-testid^="v4-session-pane"]')]
        .find(node => node.dataset.sessionId === b && node.getClientRects().length);
      if (!active) return;
      const privateText = active.textContent || '';
      for (const marker of ['A_PRIVATE_EXTENSION_STATUS', 'A_PRIVATE_EXTENSION_WIDGET',
        'A_PRIVATE_EXTENSION_TITLE', 'A_PRIVATE_EXTENSION_EDITOR', 'A_PRIVATE_QUEUED_MESSAGE']) {
        if (privateText.includes(marker)) window.__scopeLeaks.push(marker);
      }
    };
    window.__scopeObserver = new MutationObserver(inspect);
    window.__scopeObserver.observe(document.body, { subtree: true, childList: true,
      characterData: true, attributes: true, attributeFilter: ['data-session-id'] });
  }, sessionB);
  await page.evaluate(b => document.querySelector(`[data-testid="task-item-${b}"]`)?.click(), sessionB);
  await page.locator(`[data-session-id="${sessionB}"]`).filter({ visible: true }).waitFor();
  await page.waitForTimeout(1200);
  report.sessionA = sessionA;
  report.sessionB = sessionB;
  report.leaks = await page.evaluate(() => { window.__scopeObserver.disconnect(); return window.__scopeLeaks; });
  report.privateTextLeakedInB = report.leaks.length > 0;
  report.oldQueueVisibleInB = await pane().getByTestId('v4-queue')
    .getByText('A_PRIVATE_QUEUED_MESSAGE').count() > 0;
  assert.deepEqual(report.leaks, [], 'B must never render any A private extension or queue content');
  assert.equal(report.oldQueueVisibleInB, false);

  await page.evaluate(a => document.querySelector(`[data-testid="task-item-${a}"]`)?.click(), sessionA);
  await page.locator(`[data-session-id="${sessionA}"]`).filter({ visible: true }).waitFor();
  const stop = page.getByTestId('v4-stop').filter({ visible: true }).first();
  await stop.waitFor();
  await stop.click();
  await stop.waitFor({ state: 'hidden', timeout: 15_000 });
  assert.deepEqual(report.pageErrors, []);
  await verifyPiPackageCleanup(f);
} catch (error) {
  report.error = error.stack || String(error);
  report.body = (await app?.windows()[0]?.locator('body').innerText().catch(() => ''))?.slice(-7000);
  process.exitCode = 1;
  console.error(error);
  await app?.windows()[0]?.screenshot({ path: join(f.output, 'pi-session-snapshot-scope-failure.png') }).catch(() => {});
} finally {
  try { report.cleanup = await closeOwned(app, f); assertCleanExit(report.cleanup, logs, 'Pi session snapshot scope GUI'); }
  catch (error) { report.cleanupError = String(error); process.exitCode = 1; }
  await model.close();
  await writeFile(join(f.output, 'pi-session-snapshot-scope-gui-report.json'), JSON.stringify(report, null, 2));
  await writeFile(join(f.output, 'pi-session-snapshot-scope-gui.log'), logs.join(''));
  console.log(JSON.stringify(report, null, 2));
}
