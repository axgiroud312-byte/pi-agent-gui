// #9: native sidebar rename must commit to Pi JSONL and survive a full desktop restart.
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
  boundary: 'native Electron GUI → Host → pinned Pi 0.87.0 RPC; deterministic local model, no online provider',
  cleanups: [] };
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
  cli.appendSessionInfo('CLI name before GUI');
  const sessionId = cli.getSessionId();
  const sessionFile = cli.getSessionFile();
  assert.ok(sessionFile);
  const before = await readFile(sessionFile, 'utf8');
  const launch = async () => {
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
    return page;
  };
  const first = await launch();
  const item = first.locator(`[data-testid="task-item-${sessionId}"]`);
  await item.waitFor({ timeout: 30_000 });
  await item.click();
  await first.getByText('CLI_ANSWER', { exact: true }).waitFor({ timeout: 30_000 });
  await item.click({ button: 'right' });
  await first.getByRole('menuitem', { name: '重命名任务', exact: true }).click();
  await first.getByPlaceholder('任务名称', { exact: true }).fill('Renamed in native GUI');
  await first.getByRole('dialog').getByRole('button', { name: '确认', exact: true }).click();
  await first.getByRole('dialog').waitFor({ state: 'hidden' });
  await first.locator(`[data-testid="task-item-${sessionId}"]`).filter({ hasText: 'Renamed in native GUI' }).waitFor();
  await first.screenshot({ path: join(f.output, 'pi-session-renamed.png') });
  report.cleanups.push(await closeOwned(app, f));
  app = undefined;
  assertCleanExit(report.cleanups.at(-1), logs, '#9 rename first exit');
  assert((await readFile(sessionFile, 'utf8')).startsWith(before), 'existing CLI history must stay intact');
  assert.equal(SessionManager.open(sessionFile).getSessionId(), sessionId);
  report.cliNameAfterGui = (await SessionManager.list(f.workspace, f.env.PI_CODING_AGENT_SESSION_DIR))
    .find(entry => entry.id === sessionId)?.name;
  assert.equal(report.cliNameAfterGui, 'Renamed in native GUI');
  const second = await launch();
  await second.locator(`[data-testid="task-item-${sessionId}"]`)
    .filter({ hasText: 'Renamed in native GUI' }).waitFor({ timeout: 30_000 });
  report.renamedTitleSurvivedRestart = true;
  report.cleanups.push(await closeOwned(app, f));
  app = undefined;
  assertCleanExit(report.cleanups.at(-1), logs, '#9 rename restart exit');
  await verifyPiPackageCleanup(f);
  assert.deepEqual(report.pageErrors, []);
  report.ok = true;
} catch (error) {
  report.ok = false;
  report.error = error instanceof Error ? error.stack : String(error);
  throw error;
} finally {
  if (app) report.cleanupAfterFailure = await closeOwned(app, f).catch(error => ({ error: String(error) }));
  await model.close();
  await writeFile(join(f.output, 'pi-session-rename-gui-report.json'), JSON.stringify(report, null, 2));
}
