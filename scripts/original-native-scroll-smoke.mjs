// Fixed-original native GUI comparison for #34. Launch a disposable archive of
// original@317d286 (its 4,975 source files match upstream@872ad96), never the
// user's source worktree. The old Agent is used only for reference, never Pi.
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixture } from './native-smoke/fixture.mjs';
import { startModel } from './native-smoke/model.mjs';
import { closeOwned } from './native-smoke/cleanup.mjs';
import { originalInteractions } from './native-smoke/original-interactions.mjs';

const originalRoot = resolve(process.env.NATIVE_ORIGINAL_ROOT ?? 'D:/Temp/pi-34-original-comparison');
const f = await fixture();
assert.equal(f.baseline, 'original', 'Pass --baseline original for this reference-only probe');
f.root = originalRoot;
f.env.NATIVE_SMOKE_ROOT = originalRoot;
f.env.ZCODE_DESKTOP_PROFILE_HOME = f.home;
const model = await startModel(f);
let app;
const logs = [];
const report = { source: 'original reference archive 317d286 / fixed upstream 872ad96',
  modelBoundary: { endpoint: model.url, kind: 'local deterministic OpenAI-compatible; old Agent, NOT Pi' },
  workspace: f.workspace, pageErrors: [], originalRoot };
try {
  app = await f.playwright._electron.launch({ executablePath: f.electronPath,
    args: [fileURLToPath(new URL('./native-smoke/bootstrap.cjs', import.meta.url)), '--lang=zh-CN'],
    cwd: originalRoot, env: f.env, timeout: 60_000 });
  app.process().stdout?.on('data', chunk => logs.push(String(chunk)));
  app.process().stderr?.on('data', chunk => logs.push(String(chunk)));
  const page = await app.firstWindow();
  page.setDefaultTimeout(20_000);
  page.on('pageerror', error => report.pageErrors.push(error.stack || error.message));
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.waitForTimeout(6000);
  for (const name of [/^(使用 API key|Use API key)$/, /^(暂时跳过|Skip for now)$/, /^(退出引导|Exit onboarding)$/]) {
    const button = page.getByRole('button', { name, exact: true });
    if (await button.isVisible()) { await button.click(); await page.waitForTimeout(1800); }
  }
  await page.getByTestId('task-settings-button').filter({ visible: true }).click();
  await page.getByTestId('settings-locale-select-trigger').click();
  await page.getByTestId('settings-locale-select-item-zh-CN').click();
  await page.getByTestId('settings-back-button').click();
  await page.getByTestId('settings-page').waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: '添加项目', exact: true }).click();
  await page.getByRole('menuitem', { name: '打开文件夹', exact: true }).click();
  await page.getByTestId('composer-workspace-trigger').filter({ hasText: 'parity-workspace' }).waitFor();
  await page.getByTestId('task-settings-button').filter({ visible: true }).click();
  await page.getByRole('button', { name: '模型设置', exact: true }).click();
  await page.getByTestId('model-provider-add-provider-button').click();
  await page.getByRole('button', { name: '创建自定义供应商', exact: true }).click();
  await page.getByTestId('model-provider-base-url-input').fill(model.url);
  await page.getByTestId('model-provider-api-key-input').fill('parity-fixture-not-a-secret');
  await page.getByTestId('model-provider-api-format-trigger').click();
  await page.getByRole('option', { name: /Chat Completions/ }).click();
  await page.getByTestId('model-provider-add-model-button').click();
  await page.getByPlaceholder('模型 ID', { exact: true }).fill('parity-controlled');
  await page.getByRole('dialog').getByRole('button', { name: '保存', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  await page.getByText('parity-controlled', { exact: true }).waitFor();
  await page.getByTestId('settings-back-button').click();
  await page.getByTestId('settings-page').waitFor({ state: 'hidden' });
  await page.getByTestId('chat-model-select-trigger').click();
  await page.getByRole('menuitem', { name: '新供应商', exact: true }).hover();
  await page.getByText('parity-controlled', { exact: true }).click();
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows().find(window => window.isVisible())?.setContentSize(1280, 800);
  });
  await page.setViewportSize({ width: 1280, height: 800 });
  report.scrollComparison = { width: 1280, height: 800,
    theme: await page.evaluate(() => document.documentElement.classList.contains('dark') ? 'dark' : 'light') };
  assert.equal(report.scrollComparison.theme, 'dark', 'Compare fixed original and Pi product at the same dark theme');
  const input = page.getByTestId('v4-composer-input').filter({ visible: true }).first();
  await input.click(); await page.keyboard.type('PARITY_SCROLL: original timeline behavior');
  await page.getByTestId('v4-composer-send').filter({ visible: true }).first().click();
  for (let i = 0; i < 450 && model.scrollFrames < 3; i++) await page.waitForTimeout(100);
  report.modelRequestsBeforeScroll = model.requests.slice(-5);
  assert(model.scrollFrames >= 3, 'Original native Agent must have a continuing stream');
  const timeline = page.getByTestId('v4-timeline');
  const position = () => timeline.evaluate(node => ({ top: node.scrollTop, height: node.scrollHeight,
    viewport: node.clientHeight, gap: node.scrollHeight - node.clientHeight - node.scrollTop }));
  await page.waitForFunction(() => { const node = document.querySelector('[data-testid="v4-timeline"]');
    return node && node.scrollHeight > node.clientHeight + 300 &&
      node.scrollHeight - node.clientHeight - node.scrollTop < 65;
  }, null, { timeout: 10_000 });
  report.autoFollow = await position();
  await page.screenshot({ path: join(f.output, 'original-native-scroll-follow.png') });
  await timeline.hover(); await page.mouse.wheel(0, -700);
  await page.waitForTimeout(250);
  report.manualBefore = await position();
  assert(report.manualBefore.gap > 150, 'Original timeline user scroll must move above bottom');
  const framesBefore = model.scrollFrames;
  for (let i = 0; i < 60 && model.scrollFrames < framesBefore + 4; i++) await page.waitForTimeout(100);
  assert(model.scrollFrames >= framesBefore + 4, 'Original Agent stream must append after manual scroll');
  await page.waitForTimeout(200);
  report.manualAfter = await position();
  await page.screenshot({ path: join(f.output, 'original-native-scroll-manual.png') });
  report.backToLatestVisible = await page.getByTestId('v4-timeline-bottom').isVisible();
  await page.getByTestId('v4-timeline-bottom').click();
  await page.getByRole('button', { name: '停止生成', exact: true }).waitFor({ state: 'hidden', timeout: 30_000 });
  await page.waitForFunction(() => { const node = document.querySelector('[data-testid="v4-timeline"]');
    return node && node.scrollHeight - node.clientHeight - node.scrollTop < 65;
  }, null, { timeout: 10_000 });
  report.afterLatest = await position();
  report.requests = model.requests.filter(item => item.scenario === 'PARITY_SCROLL');
  assert(report.manualAfter.gap > 150 && report.backToLatestVisible && report.afterLatest.gap < 65,
    'Original native scroll behavior does not match its expected interaction');
  assert.equal(report.pageErrors.length, 0);
  await page.screenshot({ path: join(f.output, 'original-native-scroll-latest.png') });
  await originalInteractions({ app, page, input, model, f, report });
} catch (error) {
  report.error = error.stack || String(error);
  report.body = (await app?.windows()[0]?.locator('body').innerText().catch(() => ''))?.slice(-2500);
  process.exitCode = 1;
  console.error(error);
  await app?.windows()[0]?.screenshot({ path: join(f.output, 'original-native-failure.png') }).catch(() => {});
} finally {
  try { report.cleanup = await closeOwned(app, f); }
  catch (error) { report.cleanupError = String(error); process.exitCode = 1; }
  await model.close();
  await writeFile(join(f.output, 'original-native-scroll-report.json'), JSON.stringify(report, null, 2));
  await writeFile(join(f.output, 'original-native-scroll.log'), logs.join(''));
  console.log(JSON.stringify({ ...report, body: report.body?.slice(0, 400) }, null, 2));
}
