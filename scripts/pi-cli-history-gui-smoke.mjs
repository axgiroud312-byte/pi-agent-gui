// #9: CLI-authored Pi JSONL must appear in the native desktop and continue in place.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import { fixture } from './native-smoke/fixture.mjs';
import { assertCleanExit, closeOwned } from './native-smoke/cleanup.mjs';
import { startPiModel } from './native-smoke/pi-model.mjs';
import { configurePiProfile, isolatePiPackage, verifyPiPackageCleanup } from './native-smoke/pi-package.mjs';

const f = await fixture();
const logs = [];
const report = { at: new Date().toISOString(), workspace: f.workspace, pageErrors: [],
  boundary: 'native Electron GUI → Host → pinned Pi 0.87.0 RPC; deterministic local model, no online provider' };
let app;
const model = await startPiModel();
try {
  await isolatePiPackage(f);
  await configurePiProfile(f, { url: model.url, modelId: 'pi-native-test', apiKey: 'fixture-not-a-secret' });
  f.env.PI_CODING_AGENT_SESSION_DIR = join(f.sandbox, 'cli-sessions');
  await mkdir(f.env.PI_CODING_AGENT_SESSION_DIR);
  const cli = SessionManager.create(f.workspace, f.env.PI_CODING_AGENT_SESSION_DIR);
  cli.appendMessage({ role: 'user', content: 'CLI_ORIGINAL', timestamp: Date.now() });
  cli.appendMessage({ role: 'assistant', content: [{ type: 'text', text: 'CLI_ANSWER' }],
    api: 'openai-completions', provider: 'new-provider', model: 'pi-native-test',
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: 'stop', timestamp: Date.now() });
  cli.appendSessionInfo('CLI imported history');
  const sessionId = cli.getSessionId();
  const sessionFile = cli.getSessionFile();
  assert.ok(sessionFile);
  const before = await readFile(sessionFile, 'utf8');
  assert.equal((await SessionManager.list(f.workspace, f.env.PI_CODING_AGENT_SESSION_DIR))[0]?.id, sessionId);
  report.cliSessionId = sessionId;
  report.cliSessionFile = sessionFile;
  app = await f.playwright._electron.launch({ executablePath: f.electronPath,
    args: [fileURLToPath(new URL('./native-smoke/bootstrap.cjs', import.meta.url)), '--lang=zh-CN'],
    cwd: f.root, env: f.env, timeout: 60_000 });
  app.process().stdout?.on('data', chunk => logs.push(String(chunk)));
  app.process().stderr?.on('data', chunk => logs.push(String(chunk)));
  const page = await app.firstWindow();
  page.setDefaultTimeout(20_000);
  page.on('pageerror', error => report.pageErrors.push(error.stack || error.message));
  await page.waitForTimeout(6000);
  for (const name of [/^(使用 API key|Use API key)$/, /^(暂时跳过|Skip for now)$/, /^(退出引导|Exit onboarding)$/]) {
    const button = page.getByRole('button', { name, exact: true });
    if (await button.isVisible()) { await button.click(); await page.waitForTimeout(1200); }
  }
  await page.getByRole('button', { name: '添加项目', exact: true }).click();
  await page.getByRole('menuitem', { name: '打开文件夹', exact: true }).click();
  await page.getByTestId('composer-workspace-trigger').filter({ hasText: 'parity-workspace' }).waitFor();
  const item = page.locator('[data-testid^="task-item-"]').filter({ hasText: 'CLI imported history' }).first();
  await item.waitFor({ timeout: 30_000 });
  report.cliTitleVisible = await item.isVisible();
  await item.click();
  await page.getByText('CLI_ANSWER', { exact: true }).waitFor({ timeout: 30_000 });
  report.cliHistoryVisible = await page.getByText('CLI_ORIGINAL', { exact: true }).isVisible();
  report.requestsBeforeGuiPrompt = model.requests.length;
  assert.equal(report.requestsBeforeGuiPrompt, 0, 'opening CLI history must not replay any model request');
  assert((await readFile(sessionFile, 'utf8')).startsWith(before),
    'Pi may append a real setting entry on resume, but existing CLI history must remain byte-for-byte intact');
  await page.screenshot({ path: join(f.output, 'pi-cli-history-open.png') });

  await page.getByTestId('sidebar').getByTestId('task-settings-button').click();
  await page.getByRole('button', { name: '模型设置', exact: true }).click();
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
  await page.getByTestId('chat-model-select-trigger').click();
  await page.getByRole('menuitem', { name: '新供应商', exact: true }).press('ArrowRight');
  await page.getByText('pi-native-test', { exact: true }).click();
  await page.keyboard.press('Escape');
  const input = page.getByTestId('v4-composer-input').filter({ visible: true }).first();
  await input.click();
  await page.keyboard.type('PI_HELLO: continue CLI history');
  await page.getByTestId('v4-composer-send').filter({ visible: true }).first().click();
  await page.getByText('PI_HELLO_COMPLETE', { exact: true }).waitFor({ timeout: 30_000 });
  await page.getByRole('button', { name: '停止生成', exact: true }).waitFor({ state: 'hidden', timeout: 30_000 });
  report.modelRequests = model.requests;
  report.piRead = model.requests.some(request => request.scenario === 'PI_HELLO'
    && request.toolResults.some(result => result.includes('Native parity file content')));
  assert(report.piRead, 'fixed Pi must execute read in the CLI session after GUI continuation');
  await page.screenshot({ path: join(f.output, 'pi-cli-history-continued.png') });
  report.cleanup = await closeOwned(app, f);
  app = undefined;
  assertCleanExit(report.cleanup, logs, '#9 CLI history GUI');
  const continued = SessionManager.open(sessionFile);
  assert.equal(continued.getSessionId(), sessionId);
  report.cliReopenMessages = continued.getEntries().filter(entry => entry.type === 'message').map(entry => {
    const content = entry.message.content;
    return typeof content === 'string' ? content : Array.isArray(content)
      ? content.filter(part => part.type === 'text').map(part => part.text).join('') : '';
  });
  assert(report.cliReopenMessages.includes('CLI_ORIGINAL'));
  assert(report.cliReopenMessages.includes('PI_HELLO: continue CLI history'));
  assert(report.cliReopenMessages.includes('PI_HELLO_COMPLETE'));
  await verifyPiPackageCleanup(f);
  report.piPrivatePackageCleanupVerified = true;
  assert.deepEqual(report.pageErrors, []);
  report.ok = true;
} catch (error) {
  report.ok = false;
  report.error = error instanceof Error ? error.stack : String(error);
  throw error;
} finally {
  if (app) report.cleanupAfterFailure = await closeOwned(app, f).catch(error => ({ error: String(error) }));
  await model.close();
  await writeFile(join(f.output, 'pi-cli-history-gui-report.json'), JSON.stringify(report, null, 2));
}
