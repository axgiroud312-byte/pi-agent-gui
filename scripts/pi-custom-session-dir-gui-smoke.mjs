// #9/#10: project sessionDir routes Pi JSONL, CLI cold/hot discovery and restart continuation.
import assert from 'node:assert/strict';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import { fixture } from './native-smoke/fixture.mjs';
import { assertCleanExit, closeOwned } from './native-smoke/cleanup.mjs';
import { startPiModel } from './native-smoke/pi-model.mjs';
import { configurePiProfile, isolatePiPackage, verifyPiPackageCleanup } from './native-smoke/pi-package.mjs';

const f = await fixture();
const model = await startPiModel();
const logs = [];
const customDir = join(f.workspace, 'project-history');
const report = { at: new Date().toISOString(), workspace: f.workspace, customDir,
  boundary: 'native Electron GUI → Host → pinned Pi 0.87.0 RPC and public SessionManager; loopback model only',
  pageErrors: [], cleanup: [] };
const historyFiles = async () => (await readdir(customDir).catch(() => []))
  .filter(name => name.endsWith('.jsonl')).map(name => join(customDir, name));
const addCliHistory = (name, input, answer) => {
  const cli = SessionManager.create(f.workspace, customDir);
  cli.appendMessage({ role: 'user', content: input, timestamp: Date.now() });
  cli.appendMessage({ role: 'assistant', content: [{ type: 'text', text: answer }],
    api: 'openai-completions', provider: 'new-provider', model: 'pi-native-test',
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: 'stop', timestamp: Date.now() });
  cli.appendSessionInfo(name);
  return { id: cli.getSessionId(), file: cli.getSessionFile() };
};
const launch = async () => {
  const application = await f.playwright._electron.launch({ executablePath: f.electronPath,
    args: [fileURLToPath(new URL('./native-smoke/bootstrap.cjs', import.meta.url)), '--lang=zh-CN'],
    cwd: f.root, env: f.env, timeout: 60_000 });
  application.process().stdout?.on('data', chunk => logs.push(String(chunk)));
  application.process().stderr?.on('data', chunk => logs.push(String(chunk)));
  const page = await application.firstWindow();
  page.setDefaultTimeout(20_000);
  page.on('pageerror', error => report.pageErrors.push(error.stack || error.message));
  await page.waitForTimeout(6000);
  return { application, page };
};
const dismissOnboarding = async page => {
  const candidates = [/^(使用 API key|Use API key)$/, /^(暂时跳过|Skip for now)$/,
    /^(退出引导|Exit onboarding)$/, /^(跳过|Skip)$/];
  for (let attempt = 0; attempt < 60; attempt++) {
    if (await page.getByRole('button', { name: '添加项目', exact: true }).isVisible() ||
      await page.locator('[data-testid^="task-item-"]').count() > 0) return;
    for (const name of candidates) {
      const button = page.getByRole('button', { name, exact: true });
      if (await button.isVisible()) { await button.click(); break; }
    }
    await page.waitForTimeout(1000);
  }
  throw new Error(`Native GUI did not finish onboarding: ${(await page.locator('body').innerText()).slice(0, 1200)}`);
};
const send = async (page, prompt) => {
  const composer = page.getByTestId('v4-composer-input').filter({ visible: true }).first();
  await composer.click();
  await page.keyboard.type(prompt);
  await page.getByTestId('v4-composer-send').filter({ visible: true }).first().click();
};
let app;
try {
  await isolatePiPackage(f);
  await configurePiProfile(f, { url: model.url, modelId: 'pi-native-test', apiKey: 'fixture-not-a-secret' });
  const profileSettings = join(f.sandbox, 'pi-profile', 'settings.json');
  const user = JSON.parse(await readFile(profileSettings, 'utf8'));
  await writeFile(profileSettings, JSON.stringify({ ...user, sessionDir: 'user-history' }));
  await mkdir(join(f.workspace, '.pi'));
  await mkdir(customDir);
  await writeFile(join(f.workspace, '.pi', 'settings.json'), '{"sessionDir":"project-history"}');
  const cold = addCliHistory('Cold custom CLI history', 'COLD_CUSTOM_INPUT', 'COLD_CUSTOM_ANSWER');
  assert.ok(cold.file && cold.file.startsWith(`${customDir}\\`));
  const coldBytes = await readFile(cold.file);
  let started = await launch();
  app = started.application;
  let page = started.page;
  await dismissOnboarding(page);
  await page.getByRole('button', { name: '添加项目', exact: true }).click();
  await page.getByRole('menuitem', { name: '打开文件夹', exact: true }).click();
  await page.getByTestId('composer-workspace-trigger').filter({ hasText: 'parity-workspace' }).waitFor();
  await page.locator(`[data-testid="task-item-${cold.id}"]`).waitFor({ timeout: 30_000 });
  await page.locator(`[data-testid="task-item-${cold.id}"]`).click();
  await page.getByText('COLD_CUSTOM_ANSWER', { exact: true }).waitFor();
  report.cold = { ...cold, opened: true, modelRequests: model.requests.length };
  assert.equal(model.requests.length, 0, 'cold CLI discovery does not invoke Pi model');
  assert((await readFile(cold.file)).subarray(0, coldBytes.length).equals(coldBytes));

  await page.getByTestId('sidebar').getByTestId('task-settings-button').click();
  await page.getByRole('button', { name: '模型设置', exact: true }).click();
  const settings = page.getByTestId('pi-settings-section');
  await settings.waitFor();
  await page.waitForFunction(path => document.querySelector('[data-testid="pi-settings-section"]')
    ?.textContent?.includes(path), customDir);
  report.settingsDirectoryVisible = true;
  await page.screenshot({ path: join(f.output, 'custom-session-dir-settings.png') });
  await page.getByTestId('model-provider-add-provider-button').click();
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

  const hot = addCliHistory('Hot custom CLI history', 'HOT_CUSTOM_INPUT', 'HOT_CUSTOM_ANSWER');
  const hotBytes = await readFile(hot.file);
  await page.getByRole('button', { name: /^搜索/ }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByPlaceholder('搜索操作、任务或文件').fill('Hot custom CLI history');
  await dialog.getByText('Hot custom CLI history', { exact: true }).waitFor();
  await page.locator(`[data-testid="task-item-${hot.id}"]`).waitFor();
  await dialog.getByText('Hot custom CLI history', { exact: true }).click();
  await page.getByText('HOT_CUSTOM_ANSWER', { exact: true }).waitFor();
  report.hot = { ...hot, opened: true, modelRequests: model.requests.length };
  assert.equal(model.requests.length, 0, 'hot CLI discovery does not invoke Pi model');
  assert((await readFile(hot.file)).subarray(0, hotBytes.length).equals(hotBytes));

  await page.getByText('新建任务', { exact: true }).first().click();
  await page.getByTestId('chat-model-select-trigger').click();
  await page.getByTestId('chat-model-select-search').fill('pi-native-test');
  await page.getByRole('menuitemradio', { name: /pi-native-test/ }).first().click();
  await send(page, 'PI_HELLO: new custom directory session');
  await page.getByText('PI_HELLO_COMPLETE', { exact: true }).waitFor({ timeout: 30_000 });
  const sessionId = await page.locator('[data-testid^="v4-session-pane"]').filter({ visible: true }).first()
    .getAttribute('data-session-id');
  assert.ok(sessionId && sessionId !== 'draft');
  const guiFile = (await historyFiles()).find(file => file !== cold.file && file !== hot.file);
  assert.ok(guiFile, 'GUI-created Pi JSONL must be in project sessionDir');
  assert.equal(SessionManager.open(guiFile).getSessionId(), sessionId);
  const beforeRestart = await readFile(guiFile);
  report.guiCreated = { sessionId, file: guiFile, modelRequests: model.requests.length,
    cliOpenedSameId: true };
  assert.equal(model.requests.length, 2, 'PI_HELLO performs Pi read then answer');
  await page.screenshot({ path: join(f.output, 'custom-session-dir-new-session.png') });
  report.cleanup.push(await closeOwned(app, f));
  assertCleanExit(report.cleanup.at(-1), logs, 'custom Pi session directory first GUI exit');
  app = undefined;

  started = await launch();
  app = started.application;
  page = started.page;
  await dismissOnboarding(page);
  await page.locator(`[data-testid="task-item-${sessionId}"]`).waitFor({ timeout: 30_000 });
  await page.locator(`[data-testid="task-item-${sessionId}"]`).click();
  await page.getByText('PI_HELLO_COMPLETE', { exact: true }).waitFor();
  const requestsBeforeContinue = model.requests.length;
  assert.equal(requestsBeforeContinue, 2, 'restart must not replay the original Pi prompt');
  await send(page, 'PI_HELLO: continue custom directory session');
  for (let attempt = 0; attempt < 120 && model.requests.length === requestsBeforeContinue; attempt++) {
    await page.waitForTimeout(250);
  }
  assert(model.requests.length > requestsBeforeContinue, 'continuation reaches fixed Pi model');
  for (let attempt = 0; attempt < 120 &&
    await page.getByText('PI_HELLO_COMPLETE', { exact: true }).count() < 2; attempt++) {
    await page.waitForTimeout(250);
  }
  assert(await page.getByText('PI_HELLO_COMPLETE', { exact: true }).count() >= 2,
    'native UI shows both original and continued fixed Pi answers');
  await page.getByRole('button', { name: '停止生成', exact: true }).waitFor({ state: 'hidden', timeout: 30_000 });
  assert.equal(await page.locator('[data-testid^="v4-session-pane"]').filter({ visible: true }).first()
    .getAttribute('data-session-id'), sessionId);
  const continued = SessionManager.open(guiFile);
  const messages = continued.getEntries().filter(entry => entry.type === 'message');
  assert(messages.some(entry => entry.message.role === 'user' &&
    JSON.stringify(entry.message.content).includes('continue custom directory session')));
  assert((await readFile(guiFile)).subarray(0, beforeRestart.length).equals(beforeRestart),
    'restart continuation must append to the existing Pi JSONL');
  report.restart = { sameSessionId: true, sameFile: guiFile, appended: true,
    modelRequestsAfterContinue: model.requests.length, jsonlFiles: await historyFiles() };
  await page.screenshot({ path: join(f.output, 'custom-session-dir-restarted.png') });
  await verifyPiPackageCleanup(f);
  assert.deepEqual(report.pageErrors, []);
} catch (error) {
  report.error = error instanceof Error ? error.stack : String(error);
  report.body = (await app?.windows()[0]?.locator('body').innerText().catch(() => ''))?.slice(-7000);
  process.exitCode = 1;
  console.error(error);
  await app?.windows()[0]?.screenshot({ path: join(f.output, 'custom-session-dir-failed.png') }).catch(() => {});
} finally {
  if (app) {
    try { report.cleanup.push(await closeOwned(app, f));
      assertCleanExit(report.cleanup.at(-1), logs, 'custom Pi session directory final GUI exit'); }
    catch (error) { report.cleanupError = String(error); process.exitCode = 1; }
  }
  await model.close();
  report.ok = !report.error && !report.cleanupError && report.pageErrors.length === 0;
  await writeFile(join(f.output, 'pi-custom-session-dir-gui-report.json'), JSON.stringify(report, null, 2));
  await writeFile(join(f.output, 'pi-custom-session-dir-gui.log'), logs.join(''));
  console.log(JSON.stringify(report, null, 2));
}
