// #9: a Pi CLI JSONL session is searchable and opens through the native command center.
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
  cli.appendSessionInfo('Find Pi CLI session');
  const sessionId = cli.getSessionId();
  const sessionFile = cli.getSessionFile();
  assert.ok(sessionFile);
  report.cliSessionId = sessionId;
  report.cliSessionFile = sessionFile;
  const before = await readFile(sessionFile, 'utf8');

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
  await page.locator(`[data-testid="task-item-${sessionId}"]`).waitFor({ timeout: 30_000 });
  await page.getByRole('button', { name: /^搜索/ }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByPlaceholder('搜索操作、任务或文件').fill('Pi CLI session');
  await dialog.getByText('Find Pi CLI session', { exact: true }).waitFor({ timeout: 30_000 });
  report.searchFoundCliSession = true;
  await dialog.getByText('Find Pi CLI session', { exact: true }).click();
  await page.getByText('CLI_ANSWER', { exact: true }).waitFor({ timeout: 30_000 });
  report.openedOriginalHistory = true;
  await page.screenshot({ path: join(f.output, 'pi-session-search-open.png') });
  report.cleanup = await closeOwned(app, f);
  app = undefined;
  assertCleanExit(report.cleanup, logs, '#9 search exit');
  assert((await readFile(sessionFile, 'utf8')).startsWith(before), 'search/open must preserve original JSONL');
  assert.equal(SessionManager.open(sessionFile).getSessionId(), sessionId);
  await verifyPiPackageCleanup(f);
  assert.deepEqual(report.pageErrors, []);
  report.ok = true;
} catch (error) {
  report.ok = false;
  report.error = error instanceof Error ? error.stack : String(error);
  if (app) await (await app.firstWindow()).screenshot({ path: join(f.output, 'pi-session-search-failed.png') }).catch(() => {});
  throw error;
} finally {
  if (app) report.cleanupAfterFailure = await closeOwned(app, f).catch(error => ({ error: String(error) }));
  await model.close();
  if (!report.ok) report.logsTail = logs.slice(-80);
  await writeFile(join(f.output, 'pi-session-search-gui-report.json'), JSON.stringify(report, null, 2));
}
