// Isolated production-entry GUI probe for Issue #34. No renderer state injection.
import assert from 'node:assert/strict';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixture } from './native-smoke/fixture.mjs';
import { closeOwned } from './native-smoke/cleanup.mjs';
import { startPiModel } from './native-smoke/pi-model.mjs';
import { drag } from './native-smoke/panels.mjs';
import { resizeNativeWindow } from './native-smoke/evidence.mjs';
import { configurePiProfile, isolatePiPackage, verifyPiPackageCleanup } from './native-smoke/pi-package.mjs';

const f = await fixture();
const packagedExecutable = process.env.NATIVE_PI_PACKAGED_EXE;
if (packagedExecutable) {
  f.electronPath = packagedExecutable;
  // Run the actual asar entry, not the development bootstrap. The packaged app
  // opens its local conversation workspace without an OS folder picker.
  f.workspace = join(f.home, '.zcode', 'workspace', 'default');
  await mkdir(f.workspace, { recursive: true });
  await writeFile(join(f.workspace, 'README.md'), '# Native parity fixture\n\n**Preview marker: NATIVE_PARITY_PREVIEW**\n');
  await writeFile(join(f.workspace, 'hello.txt'), 'Native parity file content\n');
  f.env.ZCODE_DESKTOP_PROFILE_HOME = f.home;
  delete f.env.NODE_OPTIONS;
}
const launchArgs = packagedExecutable ? []
  : [fileURLToPath(new URL('./native-smoke/bootstrap.cjs', import.meta.url)), '--lang=zh-CN'];
await isolatePiPackage(f);
const model = await startPiModel();
// Target-side Pi identity stays separate from native application metadata.
await configurePiProfile(f, { url: model.url, modelId: 'pi-native-test', apiKey: 'fixture-not-a-secret' });
let app;
const logs = [];
const report = { at: new Date().toISOString(), workspace: f.workspace, pageErrors: [],
  modelBoundary: { endpoint: model.url, api: 'openai-completions',
    inference: 'isolated deterministic loopback fixture, NOT an online provider',
    tools: 'real pinned Pi 0.87.0 subprocess executes read against the isolated workspace' } };
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
    if (await button.isVisible()) { await button.click(); await page.waitForTimeout(1800); }
  }
  report.visibleButtons = await page.getByRole('button').allTextContents();
  if (!packagedExecutable) {
    await page.getByRole('button', { name: '添加项目', exact: true }).click();
    await page.getByRole('menuitem', { name: '打开文件夹', exact: true }).click();
    await page.getByTestId('composer-workspace-trigger').filter({ hasText: 'parity-workspace' }).waitFor();
  }
  await page.getByTestId('v4-composer-input').waitFor();
  await page.waitForTimeout(2000);
  report.title = await page.title();
  report.hostAlive = !logs.join('').includes('uncaughtException') && !logs.join('').includes('Event not found');
  report.nativeComposerVisible = await page.getByTestId('v4-composer-input').isVisible();
  report.windowCount = app.windows().length;
  await page.screenshot({ path: join(f.output, 'pi-native-workspace.png') });
  if (!await page.getByTestId('settings-page').isVisible()) {
    await page.getByTestId('sidebar').getByTestId('task-settings-button').click();
  }
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
  await page.getByText('pi-native-test', { exact: true }).waitFor();
  const nativeProviders = JSON.parse(await readFile(join(f.home, '.zcode', 'v2', 'provider_config.json'), 'utf8'));
  report.nativeProviderConfig = JSON.stringify(nativeProviders).includes('new-provider');
  assert(report.nativeProviderConfig, 'Native model must use same provider ID as isolated Pi profile');
  await page.getByTestId('settings-back-button').click();
  await page.getByTestId('settings-page').waitFor({ state: 'hidden' });
  await page.getByTestId('chat-model-select-trigger').click();
  await page.getByRole('menuitem', { name: '新供应商', exact: true }).hover();
  await page.getByText('pi-native-test', { exact: true }).click();
  await page.keyboard.press('Escape');
  report.modelSelected = await page.getByTestId('chat-model-select-trigger').innerText();
  const input = page.getByTestId('v4-composer-input').filter({ visible: true }).first();
  await input.click();
  await page.keyboard.type('PI_TEXT: give me a short response');
  report.composerText = await input.innerText();
  report.composerActive = await input.evaluate(node => node === document.activeElement);
  report.sendEnabled = await page.getByTestId('v4-composer-send').filter({ visible: true }).first().isEnabled();
  await page.getByTestId('v4-composer-send').filter({ visible: true }).first().click();
  await page.getByText('PI_TEXT_', { exact: true }).waitFor({ timeout: 30_000 });
  report.streamPartialVisible = await page.getByRole('button', { name: '停止生成', exact: true }).isVisible();
  await page.screenshot({ path: join(f.output, 'pi-native-streaming.png') });
  assert(report.streamPartialVisible, 'The native stop/stream feedback must be visible before Pi completion');
  await page.getByText('PI_TEXT_COMPLETE', { exact: true }).waitFor({ timeout: 30_000 });
  report.afterSend = (await page.locator('body').innerText()).slice(-4500);
  await page.screenshot({ path: join(f.output, 'pi-native-text.png') });
  const send = async text => {
    const composer = page.getByTestId('v4-composer-input').filter({ visible: true }).first();
    await composer.click();
    await page.keyboard.type(text);
    await page.getByTestId('v4-composer-send').filter({ visible: true }).first().click();
  };
  await resizeNativeWindow(app, page, { width: 1280, height: 800 });
  report.scrollComparison = { width: 1280, height: 800,
    theme: await page.evaluate(() => document.documentElement.classList.contains('dark') ? 'dark' : 'light') };
  assert.equal(report.scrollComparison.theme, 'dark', 'Compare original and Pi streaming at the same native dark theme');
  const timeline = page.getByTestId('v4-timeline');
  const position = () => timeline.evaluate(node => ({ top: node.scrollTop,
    height: node.scrollHeight, viewport: node.clientHeight,
    gap: node.scrollHeight - node.clientHeight - node.scrollTop }));
  await send('PI_SCROLL: demonstrate native scrolling while Pi streams');
  for (let i = 0; i < 100 && model.scrollFrames < 3; i++) await page.waitForTimeout(100);
  assert(model.scrollFrames >= 3, 'Real Pi text stream must still be producing frames');
  await page.waitForFunction(() => {
    const node = document.querySelector('[data-testid="v4-timeline"]');
    return node && node.scrollHeight > node.clientHeight + 300
      && node.scrollHeight - node.clientHeight - node.scrollTop < 65;
  }, null, { timeout: 10_000 });
  report.scrollAutoFollow = await position();
  await page.screenshot({ path: join(f.output, 'pi-native-scroll-follow.png') });
  await timeline.hover();
  await page.mouse.wheel(0, -700);
  await page.waitForTimeout(250);
  report.scrollManualBefore = await position();
  assert(report.scrollManualBefore.gap > 150, 'Native user scroll must leave the streaming bottom');
  const framesBeforeManual = model.scrollFrames;
  for (let i = 0; i < 60 && model.scrollFrames < framesBeforeManual + 4; i++) await page.waitForTimeout(100);
  assert(model.scrollFrames >= framesBeforeManual + 4, 'Pi must append text after the user scrolls up');
  await page.waitForTimeout(200);
  report.scrollManualAfter = await position();
  assert(report.scrollManualAfter.gap > 150,
    'Native timeline must not steal manual scroll when Pi appends text');
  await page.screenshot({ path: join(f.output, 'pi-native-scroll-manual.png') });
  const latest = page.getByTestId('v4-timeline-bottom');
  report.backToLatestVisible = await latest.isVisible();
  assert(report.backToLatestVisible, 'Native return-to-latest control must appear after manual scroll');
  await latest.click();
  await page.getByRole('button', { name: '停止生成', exact: true }).waitFor({ state: 'hidden', timeout: 30_000 });
  await page.waitForFunction(() => {
    const node = document.querySelector('[data-testid="v4-timeline"]');
    return node && node.scrollHeight - node.clientHeight - node.scrollTop < 65;
  }, null, { timeout: 10_000 });
  report.scrollAfterLatest = await position();
  await page.screenshot({ path: join(f.output, 'pi-native-scroll-latest.png') });
  await send('PI_READ: read the workspace README.md');
  await page.getByText('PI_READ_COMPLETE', { exact: true }).waitFor({ timeout: 30_000 });
  await page.getByRole('button', { name: '停止生成', exact: true }).waitFor({ state: 'hidden', timeout: 30_000 });
  const readTurn = page.locator('section[data-turn-id]').filter({ hasText: 'PI_READ: read the workspace README.md' }).first();
  const toolCard = readTurn.locator('[data-testid^="chat-tool-call-block"]').filter({ visible: true }).first();
  report.historyTriggerCount = await readTurn.locator('[data-testid^="chat-assistant-history-trigger"]').count();
  if (!await toolCard.isVisible() && report.historyTriggerCount > 0) {
    await readTurn.locator('[data-testid^="chat-assistant-history-trigger"]').first().click();
  }
  report.nativeToolCardVisible = await toolCard.isVisible();
  report.nativeToolCard = report.nativeToolCardVisible ? (await toolCard.innerText()).slice(0, 1000) : null;
  report.nativeToolStatus = report.nativeToolCardVisible ? await toolCard.getAttribute('data-status') : null;
  report.liveRowText = await page.locator('[data-testid^="v4-row"]').allInnerTexts();
  report.piRead = model.requests.some(request => request.scenario === 'PI_READ'
    && request.toolResults.some(result => result.includes('NATIVE_PARITY_PREVIEW')));
  await page.screenshot({ path: join(f.output, 'pi-native-read.png') });
  assert(report.piRead, 'The controlled provider must observe the result of Pi executing read');
  assert(report.nativeToolCardVisible && report.nativeToolCard?.includes('README.md')
    && report.nativeToolStatus === 'completed', 'The original Read card must show Pi tool completion');
  await send('PI_STOP: keep streaming until I stop you');
  for (let i = 0; i < 100 && model.held === 0; i++) await page.waitForTimeout(100);
  assert(model.held > 0, 'Pi request must still be active before GUI Stop');
  await page.screenshot({ path: join(f.output, 'pi-native-before-stop.png') });
  await page.getByRole('button', { name: '停止生成', exact: true }).click();
  await page.getByRole('button', { name: '停止生成', exact: true }).waitFor({ state: 'hidden', timeout: 30_000 });
  for (let i = 0; i < 100 && model.held > 0; i++) await page.waitForTimeout(100);
  report.piStop = model.held === 0;
  report.modelRequests = model.requests;
  report.afterStop = (await page.locator('body').innerText()).slice(-4500);
  await page.screenshot({ path: join(f.output, 'pi-native-stopped.png') });
  assert(report.piStop, 'Native stop must cancel the Pi provider stream');
  const catalog = join(f.home, '.zcode', 'v2', 'pi-sessions');
  report.bookmarks = (await readdir(catalog)).filter(name => name.endsWith('.json'));
  assert.equal(report.bookmarks.length, 1, 'Only the prompted Pi session is indexed, not empty drafts');
  const requestsBeforeRestart = model.requests.length;
  report.firstCleanup = await closeOwned(app, f);
  assert.deepEqual(report.firstCleanup.survivors, [], 'First Host and Pi process must exit before restart');
  app = await f.playwright._electron.launch({ executablePath: f.electronPath,
    args: launchArgs, cwd: f.root, env: f.env, timeout: 60_000 });
  app.process().stdout?.on('data', chunk => logs.push(String(chunk)));
  app.process().stderr?.on('data', chunk => logs.push(String(chunk)));
  const reopenedPage = await app.firstWindow();
  reopenedPage.setDefaultTimeout(15_000);
  reopenedPage.on('pageerror', error => report.pageErrors.push(error.stack || error.message));
  await reopenedPage.waitForTimeout(5000);
  for (const name of [/^(使用 API key|Use API key)$/, /^(暂时跳过|Skip for now)$/, /^(退出引导|Exit onboarding)$/]) {
    const button = reopenedPage.getByRole('button', { name, exact: true });
    if (await button.isVisible()) { await button.click(); await reopenedPage.waitForTimeout(1200); }
  }
  report.beforeHistoryOpen = (await reopenedPage.locator('body').innerText()).slice(-2000);
  if (!packagedExecutable && await reopenedPage.getByRole('button', { name: '添加项目', exact: true }).isVisible()) {
    await reopenedPage.getByRole('button', { name: '添加项目', exact: true }).click();
    await reopenedPage.getByRole('menuitem', { name: '打开文件夹', exact: true }).click();
  }
  if (await reopenedPage.getByText('PI_TEXT_COMPLETE', { exact: true }).count() === 0) {
    await reopenedPage.getByText('PI_TEXT: give me a short response', { exact: true }).first().click();
  }
  await reopenedPage.getByText('PI_TEXT_COMPLETE', { exact: true }).waitFor({ timeout: 30_000 });
  await reopenedPage.getByText('PI_READ_COMPLETE', { exact: true }).waitFor();
  report.afterRestart = (await reopenedPage.locator('body').innerText()).slice(-4500);
  const restoredReadTurn = reopenedPage.locator('section[data-turn-id]').filter({ hasText: 'PI_READ: read the workspace README.md' }).first();
  const restoredToolCard = restoredReadTurn.locator('[data-testid^="chat-tool-call-block"]').filter({ visible: true }).first();
  if (!await restoredToolCard.isVisible() && await restoredReadTurn.locator('[data-testid^="chat-assistant-history-trigger"]').count() > 0) {
    await restoredReadTurn.locator('[data-testid^="chat-assistant-history-trigger"]').first().click();
  }
  report.restoredToolCardVisible = await restoredToolCard.isVisible();
  report.restoredToolStatus = report.restoredToolCardVisible ? await restoredToolCard.getAttribute('data-status') : null;
  report.restoredRowText = await reopenedPage.locator('[data-testid^="v4-row"]').allInnerTexts();
  report.restartReplayed = model.requests.length > requestsBeforeRestart;
  await reopenedPage.screenshot({ path: join(f.output, 'pi-native-restored.png') });
  assert.equal(report.restartReplayed, false, 'Restoring Pi history must never replay a prompt');
  assert(report.nativeToolCardVisible && report.restoredToolCardVisible && report.restoredToolStatus === 'completed',
    'Pi read tool card must be visibly rendered live and after restart');
  report.layoutMatrix = [];
  for (const size of [{ width: 1280, height: 800 }, { width: 1920, height: 1080 }]) {
    await resizeNativeWindow(app, reopenedPage, size);
    for (const theme of ['light', 'dark']) {
      await reopenedPage.getByTestId('task-settings-button').filter({ visible: true }).click();
      await reopenedPage.getByRole('button', { name: '外观', exact: true }).click();
      await reopenedPage.getByTestId('settings-page').getByRole('combobox').first().click();
      await reopenedPage.getByRole('option', { name: theme === 'dark' ? '深色' : '浅色', exact: true }).click();
      await reopenedPage.waitForFunction(dark => document.documentElement.classList.contains('dark') === dark,
        theme === 'dark');
      await reopenedPage.getByTestId('settings-back-button').click();
      await reopenedPage.getByTestId('settings-page').waitFor({ state: 'hidden' });
      const readSection = reopenedPage.locator('section[data-turn-id]')
        .filter({ hasText: 'PI_READ: read the workspace README.md' }).first();
      const card = readSection.locator('[data-testid^="chat-tool-call-block"]').filter({ visible: true }).first();
      if (!await card.isVisible()) await readSection.locator('[data-testid^="chat-assistant-history-trigger"]').first().click();
      await card.scrollIntoViewIfNeeded();
      const entry = { size, theme,
        sidebar: await reopenedPage.getByTestId('sidebar').isVisible(),
        composer: await reopenedPage.getByTestId('v4-composer-input').isVisible(),
        readCard: await card.isVisible(),
        status: await card.getAttribute('data-status'),
      };
      report.layoutMatrix.push(entry);
      assert(entry.sidebar && entry.composer && entry.readCard && entry.status === 'completed',
        'Native shell, composer and completed Pi read card must survive viewport/theme changes');
      await reopenedPage.screenshot({ path: join(f.output, `pi-native-${size.width}x${size.height}-${theme}-restored.png`) });
    }
  }
  const readFileChip = restoredToolCard.getByRole('button', { name: 'README.md', exact: true });
  report.readFileChipClickable = await readFileChip.isVisible();
  if (report.readFileChipClickable) {
    await readFileChip.click();
    await reopenedPage.getByText('NATIVE_PARITY_PREVIEW', { exact: false }).first()
      .waitFor({ timeout: 5000 }).catch(() => {});
    report.readPreviewMarkerVisible = await reopenedPage.getByText('NATIVE_PARITY_PREVIEW', { exact: false })
      .first().isVisible();
    report.readPreviewText = (await reopenedPage.locator('body').innerText()).slice(-1800);
    await reopenedPage.screenshot({ path: join(f.output, 'pi-native-read-preview.png') });
  }
  assert(report.readFileChipClickable && report.readPreviewMarkerVisible,
    'Native Read card must open the same workspace file that Pi executed');
  const reopenedSend = async text => {
    const composer = reopenedPage.getByTestId('v4-composer-input').filter({ visible: true }).first();
    await composer.click(); await reopenedPage.keyboard.type(text);
    await reopenedPage.getByTestId('v4-composer-send').filter({ visible: true }).first().click();
  };
  const firstSessionId = await reopenedPage.locator('[data-testid^="v4-session-pane"]').filter({ visible: true }).first()
    .getAttribute('data-session-id');
  await reopenedSend('PI_HELLO: read the workspace hello.txt');
  await reopenedPage.getByText('PI_HELLO_COMPLETE', { exact: true }).waitFor({ timeout: 30_000 });
  await reopenedPage.getByRole('button', { name: '停止生成', exact: true }).waitFor({ state: 'hidden', timeout: 30_000 });
  const helloTurn = reopenedPage.locator('section[data-turn-id]').filter({ hasText: 'PI_HELLO: read the workspace hello.txt' }).first();
  const helloCard = helloTurn.locator('[data-testid^="chat-tool-call-block"]').filter({ visible: true }).first();
  report.helloDebug = { turn: (await helloTurn.innerText()).slice(-450),
    triggers: await helloTurn.locator('[data-testid^="chat-assistant-history-trigger"]').count(),
    modelRequests: model.requests.slice(-2) };
  const helloHistory = helloTurn.locator('[data-testid^="chat-assistant-history-trigger"]').first();
  if (!await helloCard.isVisible()) await helloHistory.click();
  await helloHistory.and(reopenedPage.locator('[data-history-open="true"]')).waitFor();
  // The original history uses an animated Radix Collapsible: wait for its
  // enter transition before clicking the newly mounted native Read chip.
  await reopenedPage.waitForTimeout(350);
  report.helloDebug.card = await helloCard.isVisible() ? await helloCard.innerText() : null;
  report.helloDebug.buttons = await helloCard.getByRole('button').allTextContents();
  report.helloDebug.openPath = await helloCard.getByRole('button', { name: 'hello.txt', exact: true }).getAttribute('title');
  await helloCard.getByRole('button', { name: 'hello.txt', exact: true }).click();
  const helloPreview = reopenedPage.getByText('Native parity file content', { exact: false }).first();
  report.helloFirstClickTabs = await reopenedPage.locator('[data-side-pane-tab-id]').allTextContents();
  await helloPreview.waitFor({ timeout: 5000 }).catch(() => {});
  report.helloFirstClickVisible = await helloPreview.isVisible();
  report.helloPreviewDebug = {
    markerVisible: await helloPreview.isVisible(),
    tabs: await reopenedPage.locator('[data-side-pane-tab-id]').evaluateAll(nodes => nodes.map(node => ({
      text: node.textContent, state: node.getAttribute('data-state'), id: node.getAttribute('data-side-pane-tab-id'),
    }))),
    paneText: (await reopenedPage.locator('#browser').innerText().catch(() => '')).slice(-1200),
    modelRequests: model.requests.slice(-2),
  };
  assert(report.helloPreviewDebug.markerVisible, 'Second Pi read must open the actual hello.txt content');
  const sideTabs = reopenedPage.locator('[data-side-pane-tab-id]');
  assert.equal(await sideTabs.count(), 2, 'Opening a second Pi-read file must retain native Side Pane tabs');
  const tabOrderBefore = await sideTabs.allTextContents();
  const firstTab = await sideTabs.nth(0).boundingBox(), secondTab = await sideTabs.nth(1).boundingBox();
  await drag(reopenedPage, sideTabs.nth(0), secondTab.x - firstTab.x + 30, 0);
  report.tabOrderAfterDrag = await sideTabs.allTextContents();
  assert.notDeepEqual(report.tabOrderAfterDrag, tabOrderBefore, 'Native file tab drag must reorder tabs');
  await sideTabs.filter({ hasText: 'README.md' }).click();
  report.postDragFirstClickActive = await sideTabs.filter({ hasText: 'README.md' }).getAttribute('data-state') === 'active';
  if (!report.postDragFirstClickActive) {
    // The original SidePaneTabTrigger suppresses the first click after a drag.
    await sideTabs.filter({ hasText: 'README.md' }).click();
  }
  await sideTabs.filter({ hasText: 'README.md' }).and(reopenedPage.locator('[data-state="active"]')).waitFor();
  const widthBeforeResize = (await reopenedPage.locator('#browser').boundingBox()).width;
  await drag(reopenedPage, reopenedPage.locator('[data-workspace-side-pane-resize-handle]'), -75, 0);
  report.sidePaneWidth = { before: widthBeforeResize, after: (await reopenedPage.locator('#browser').boundingBox()).width };
  assert(report.sidePaneWidth.after > widthBeforeResize + 30, 'Original Side Pane drag resize must still work');
  await reopenedPage.screenshot({ path: join(f.output, 'pi-native-tabs-drag.png') });
  await sideTabs.filter({ hasText: 'hello.txt' }).click();
  await sideTabs.filter({ hasText: 'hello.txt' }).getByRole('button').click();
  assert.equal(await sideTabs.count(), 1);
  report.tabCloseRetainsReadme = await sideTabs.first().innerText();
  await reopenedPage.screenshot({ path: join(f.output, 'pi-native-tab-closed.png') });
  await reopenedPage.getByText('新建任务', { exact: true }).first().click();
  await reopenedSend('PI_TEXT: second Pi session is independent');
  await reopenedPage.getByText('PI_TEXT_COMPLETE', { exact: true }).waitFor({ timeout: 30_000 });
  const secondSessionId = await reopenedPage.locator('[data-testid^="v4-session-pane"]').filter({ visible: true }).first()
    .getAttribute('data-session-id');
  report.sessionSwitch = { firstSessionId, secondSessionId,
    sidebarRows: await reopenedPage.locator('[data-testid^="task-item-"]').allTextContents() };
  assert(firstSessionId && secondSessionId && firstSessionId !== secondSessionId,
    'Native new-task action must allocate a distinct Pi session');
  const requestsBeforeSwitch = model.requests.length;
  await reopenedPage.locator('[data-testid^="task-item-"]')
    .filter({ hasText: 'PI_TEXT: give me a short response' }).first().click();
  await reopenedPage.getByText('PI_HELLO_COMPLETE', { exact: true }).waitFor();
  report.sessionSwitch.restoredFirst = await reopenedPage.locator('[data-testid^="v4-session-pane"]')
    .filter({ visible: true }).first().getAttribute('data-session-id');
  await reopenedPage.locator('[data-testid^="task-item-"]')
    .filter({ hasText: 'PI_TEXT: second Pi session is independent' }).first().click();
  report.sessionSwitch.restoredSecond = await reopenedPage.locator('[data-testid^="v4-session-pane"]')
    .filter({ visible: true }).first().getAttribute('data-session-id');
  report.sessionSwitch.noReplay = model.requests.length === requestsBeforeSwitch;
  report.modelRequestsFinal = model.requests;
  assert.equal(report.sessionSwitch.restoredFirst, firstSessionId);
  assert.equal(report.sessionSwitch.restoredSecond, secondSessionId);
  assert(report.sessionSwitch.noReplay, 'Switching native Pi sessions must not replay either prompt');
  await reopenedPage.screenshot({ path: join(f.output, 'pi-native-session-switch.png') });
  await reopenedPage.locator('[data-testid^="task-item-"]')
    .filter({ hasText: 'PI_TEXT: second Pi session is independent' }).first().click({ button: 'right' });
  const split = reopenedPage.getByTestId('v4-task-open-in-split');
  report.conversationSplit = {
    nativeOriginal: 'unavailable in fixed #32 original runtime; see issue-32-parity/evidence.json',
    entryVisible: await split.isVisible(), enabled: await split.isEnabled(),
  };
  if (report.conversationSplit.entryVisible && report.conversationSplit.enabled) {
    await split.click();
    const divider = reopenedPage.getByTestId('v4-split-divider');
    await divider.waitFor();
    const before = await divider.boundingBox();
    await drag(reopenedPage, divider, 75, 0);
    report.conversationSplit.resized = (await divider.boundingBox()).x !== before.x;
    assert(report.conversationSplit.resized, 'If exposed, conversation split drag must work');
    await reopenedPage.screenshot({ path: join(f.output, 'pi-native-conversation-split.png') });
    await reopenedPage.getByTestId('v4-split-close').click();
  } else {
    report.conversationSplit.unavailable = 'Native task-menu split is not enabled; no hidden store activation';
    await reopenedPage.screenshot({ path: join(f.output, 'pi-native-conversation-split-unavailable.png') });
    await reopenedPage.keyboard.press('Escape');
  }
  await verifyPiPackageCleanup(f);
  report.piPrivatePackageCleanupVerified = true;
  const boundaries = (await readFile(f.env.NATIVE_SMOKE_BOUNDARY_LOG, 'utf8'))
    .split('\n').filter(Boolean).map(JSON.parse);
  report.filesystemBlocked = boundaries.filter(entry => entry.type === 'filesystem-blocked');
  assert.deepEqual(report.filesystemBlocked, [], 'Pi must not write outside the isolated fixture');
  assert(report.hostAlive, 'Host must survive workspace subscription');
  assert.equal(report.pageErrors.length, 0, 'Renderer must not throw');
} catch (error) {
  report.error = error.stack || String(error);
  const failedPage = app?.windows()[0];
  const details = failedPage?.getByTestId('chat-error-details-button');
  if (await details?.isVisible().catch(() => false)) await details.click().catch(() => {});
  report.body = (await failedPage?.locator('body').innerText().catch(() => ''))?.slice(0, 7000);
  process.exitCode = 1;
  console.error(error);
  await app?.windows()[0]?.screenshot({ path: join(f.output, 'pi-native-failure.png') }).catch(() => {});
} finally {
  try { report.cleanup = await closeOwned(app, f); }
  catch (error) { report.cleanupError = String(error); process.exitCode = 1; }
  await model.close();
  await writeFile(join(f.output, 'pi-native-gui-report.json'), JSON.stringify(report, null, 2));
  await writeFile(join(f.output, 'pi-native-gui.log'), logs.join(''));
  console.log(JSON.stringify(report, null, 2));
}
