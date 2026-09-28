// #9: native confirmation deletes only the selected cold Pi JSONL and stays deleted after restart.
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
  boundary: 'native Electron GUI → Host → pinned Pi 0.87.0 JSONL; deterministic local model, no online provider',
  cleanups: [] };
let app;
const model = await startPiModel();
try {
  await isolatePiPackage(f);
  await configurePiProfile(f, { url: model.url, modelId: 'pi-native-test', apiKey: 'fixture-not-a-secret' });
  f.env.PI_CODING_AGENT_SESSION_DIR = join(f.sandbox, 'shared-cli-sessions');
  await mkdir(f.env.PI_CODING_AGENT_SESSION_DIR);
  const cli = SessionManager.create(f.workspace, f.env.PI_CODING_AGENT_SESSION_DIR);
  cli.appendMessage({ role: 'user', content: 'CLI_DELETE_TARGET', timestamp: Date.now() });
  cli.appendMessage({ role: 'assistant', content: [{ type: 'text', text: 'CLI_TARGET_ANSWER' }], timestamp: Date.now() });
  cli.appendSessionInfo('Pi session delete target');
  const sessionId = cli.getSessionId();
  const sessionFile = cli.getSessionFile();
  assert.ok(sessionFile);
  const before = await readFile(sessionFile);
  const otherWorkspace = join(f.sandbox, 'other-workspace');
  await mkdir(otherWorkspace);
  const other = SessionManager.create(otherWorkspace, f.env.PI_CODING_AGENT_SESSION_DIR);
  other.appendMessage({ role: 'user', content: 'OTHER_WORKSPACE', timestamp: Date.now() });
  other.appendMessage({ role: 'assistant', content: [{ type: 'text', text: 'KEEP_ME' }], timestamp: Date.now() });
  const otherFile = other.getSessionFile();
  assert.ok(otherFile);
  const otherBefore = await readFile(otherFile);
  report.selected = { sessionId, sessionFile };
  report.otherWorkspaceFile = otherFile;
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
  await item.click({ button: 'right' });
  await first.getByTestId('pi-session-delete-menu').click();
  const dialog = first.getByRole('dialog').filter({ hasText: sessionId });
  await dialog.waitFor();
  assert((await dialog.innerText()).includes(sessionFile), 'confirmation must show exact Pi JSONL');
  assert((await dialog.innerText()).includes('Pi session delete target'), 'confirmation must show Pi title');
  await dialog.getByRole('button', { name: /取消/ }).click();
  await dialog.waitFor({ state: 'hidden' });
  assert.deepEqual(await readFile(sessionFile), before, 'cancel must not change Pi history');
  report.cancelPreserved = true;
  await item.click();
  await first.getByText('CLI_TARGET_ANSWER', { exact: true }).waitFor({ timeout: 30_000 });
  const afterOpen = await readFile(sessionFile);
  await item.click({ button: 'right' });
  await first.getByTestId('pi-session-delete-menu').click();
  await first.waitForTimeout(500);
  assert.equal(await first.getByRole('dialog').filter({ hasText: sessionId }).count(), 0,
    'active Pi session must not reach the destructive confirmation');
  assert((await readFile(sessionFile)).subarray(0, afterOpen.length).equals(afterOpen));
  assert.equal(SessionManager.open(sessionFile).getSessionId(), sessionId);
  report.activePreserved = true;
  report.cleanups.push(await closeOwned(app, f));
  app = undefined;
  assertCleanExit(report.cleanups.at(-1), logs, '#9 delete active exit');

  const second = await launch();
  const coldItem = second.locator(`[data-testid="task-item-${sessionId}"]`);
  await coldItem.waitFor({ timeout: 30_000 });
  await coldItem.click({ button: 'right' });
  await second.getByTestId('pi-session-delete-menu').click();
  const confirmedDialog = second.getByRole('dialog').filter({ hasText: sessionId });
  await confirmedDialog.waitFor();
  await confirmedDialog.getByRole('button', { name: /删除 Pi 会话/ }).click();
  await coldItem.waitFor({ state: 'detached', timeout: 30_000 });
  await assert.rejects(readFile(sessionFile), { code: 'ENOENT' });
  assert.equal((await SessionManager.list(f.workspace, f.env.PI_CODING_AGENT_SESSION_DIR)).length, 0);
  assert.deepEqual(await readFile(otherFile), otherBefore);
  report.confirmDeletedOnlySelectedJsonl = true;
  report.cleanups.push(await closeOwned(app, f));
  app = undefined;
  assertCleanExit(report.cleanups.at(-1), logs, '#9 delete confirmed exit');

  const third = await launch();
  await third.waitForTimeout(2500);
  assert.equal(await third.locator(`[data-testid="task-item-${sessionId}"]`).count(), 0);
  assert.deepEqual(await readFile(otherFile), otherBefore);
  report.deletedStayedAbsentAfterRestart = true;
  report.cleanups.push(await closeOwned(app, f));
  app = undefined;
  assertCleanExit(report.cleanups.at(-1), logs, '#9 delete restart exit');
  await verifyPiPackageCleanup(f);
  assert.deepEqual(report.pageErrors, []);
  report.ok = true;
} catch (error) {
  report.ok = false;
  report.error = error instanceof Error ? error.stack : String(error);
  if (app) await (await app.firstWindow()).screenshot({ path: join(f.output, 'pi-session-delete-failed.png') }).catch(() => {});
  throw error;
} finally {
  if (app) report.cleanupAfterFailure = await closeOwned(app, f).catch(error => ({ error: String(error) }));
  await model.close();
  if (!report.ok) report.logsTail = logs.slice(-80);
  await writeFile(join(f.output, 'pi-session-delete-gui-report.json'), JSON.stringify(report, null, 2));
}
