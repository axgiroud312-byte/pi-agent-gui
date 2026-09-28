// Native GUI, fixed Pi 0.87.0: Shell and transfer views belong to their source session.
// No Gist is published by this regression.
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
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
const report = { at: new Date().toISOString(), piVersion: '0.87.0',
  inference: 'deterministic loopback provider, not online provider',
  externalWriteAttempted: false, pageErrors: [] };
const logs = [];
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

  const activeId = () => page.locator('[data-testid^="v4-session-pane"]')
    .filter({ visible: true }).first().getAttribute('data-session-id');
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
    await page.locator('[data-testid^="v4-session-pane"]').filter({ visible: true }).first()
      .getByText('PI_TEXT_COMPLETE', { exact: true }).waitFor({ timeout: 30_000 });
  };
  await chooseModel();
  await send('PI_TEXT: A_PRIVATE_SHELL_TRANSFER_SCOPE');
  const sessionA = await activeId();
  assert.ok(sessionA);
  await page.getByText('新建任务', { exact: true }).first().click();
  await chooseModel();
  await send('PI_TEXT: B_PUBLIC_SCOPE');
  const sessionB = await activeId();
  assert.ok(sessionB && sessionA !== sessionB);
  const select = async id => {
    await page.locator(`[data-testid="task-item-${id}"]`).click();
    await page.locator(`[data-session-id="${id}"]`).filter({ visible: true }).waitFor();
  };
  await select(sessionA);
  const shell = page.getByTestId('pi-shell-dialog');
  await page.getByTestId('pi-shell-open').click();
  await shell.getByTestId('pi-shell-command').fill('echo A_PRIVATE_SHELL_COMMAND');
  await shell.getByRole('button', { name: '运行', exact: true }).click();
  await shell.getByTestId('pi-shell-result').getByText('退出码：0').waitFor();
  assert.match(await shell.getByTestId('pi-shell-result').innerText(), /A_PRIVATE_SHELL_COMMAND/u);
  await page.keyboard.press('Escape');
  await shell.waitFor({ state: 'hidden' });
  await select(sessionB);
  await page.getByTestId('pi-shell-open').click();
  report.shell = { sessionA, sessionB,
    bCommand: await shell.getByTestId('pi-shell-command').inputValue(),
    bOldResult: await shell.getByTestId('pi-shell-result').count(),
    bStop: await shell.getByRole('button', { name: 'Stop shell' }).count() };
  await page.keyboard.press('Escape');
  await shell.waitFor({ state: 'hidden' });

  await select(sessionA);
  const transfer = page.getByTestId('pi-transfer-dialog');
  await page.getByTestId('pi-transfer-open').click();
  await transfer.getByTestId('pi-transfer-last-answer').filter({ hasText: 'PI_TEXT_COMPLETE' }).waitFor();
  await transfer.getByTestId('pi-share-preview').click();
  await transfer.getByTestId('pi-share-content-preview')
    .filter({ hasText: 'A_PRIVATE_SHELL_TRANSFER_SCOPE' }).waitFor();
  await page.evaluate(b => {
    window.__piTransferLeakedA = false;
    window.__piTransferObserver = new MutationObserver(() => {
      const selected = document.querySelector('[data-testid^="v4-session-pane"][data-session-id="' + b + '"]');
      const content = document.querySelector('[data-testid="pi-share-content-preview"]');
      if (selected?.getClientRects().length &&
        content?.textContent?.includes('A_PRIVATE_SHELL_TRANSFER_SCOPE')) {
        window.__piTransferLeakedA = true;
      }
    });
    window.__piTransferObserver.observe(document.body, { subtree: true, childList: true, characterData: true });
  }, sessionB);
  // A task may be selected by another pane or a shortcut while a modal is open.
  // DOM click models that session ownership transition without relying on pointer interception.
  await page.evaluate(b => document.querySelector(`[data-testid="task-item-${b}"]`)?.click(), sessionB);
  await page.locator(`[data-session-id="${sessionB}"]`).filter({ visible: true }).waitFor();
  await page.waitForTimeout(1000);
  report.transfer = { leakedAAtAnyMutation: await page.evaluate(() => {
    window.__piTransferObserver.disconnect();
    return window.__piTransferLeakedA;
  }), bPrivatePreviewVisible: await transfer.getByTestId('pi-share-content-preview')
    .filter({ hasText: 'A_PRIVATE_SHELL_TRANSFER_SCOPE' }).count() };
  if (await transfer.isVisible()) {
    await page.keyboard.press('Escape');
    await transfer.waitFor({ state: 'hidden' });
  }
  await select(sessionA);
  await page.getByTestId('pi-shell-open').click();
  await shell.getByTestId('pi-shell-command').fill(
    'node -e "setTimeout(() => process.stdout.write(\'LATE_A_SHELL_OUTPUT\'), 30000)"');
  const longShellStartedAt = Date.now();
  await shell.getByRole('button', { name: '运行', exact: true }).click();
  await page.getByTestId('v4-stop').filter({ visible: true }).first().waitFor();
  await page.evaluate(b => document.querySelector(`[data-testid="task-item-${b}"]`)?.click(), sessionB);
  await page.locator(`[data-session-id="${sessionB}"]`).filter({ visible: true }).waitFor();
  report.shell.bDuringARun = { dialogStop: await shell.getByRole('button', { name: 'Stop shell' }).count(),
    sessionStop: await page.getByTestId('v4-stop').filter({ visible: true }).count() };
  await page.evaluate(a => document.querySelector(`[data-testid="task-item-${a}"]`)?.click(), sessionA);
  await page.locator(`[data-session-id="${sessionA}"]`).filter({ visible: true }).waitFor();
  const stopA = page.getByTestId('v4-stop').filter({ visible: true }).first();
  await stopA.waitFor();
  await stopA.click();
  await stopA.waitFor({ state: 'hidden', timeout: 15_000 });
  await page.locator(`[data-session-id="${sessionA}"]`).filter({ visible: true })
    .getByText('已停止', { exact: true }).last().waitFor();
  assert.ok(Date.now() - longShellStartedAt < 30_000, 'Stop must finish before the 30-second shell output');
  report.shell.aReturnedStop = { targetSessionId: sessionA, stoppedBeforeThirtySecondOutput: true };
  assert.deepEqual(report.pageErrors, []);
  await verifyPiPackageCleanup(f);
  assert.equal(report.shell.bCommand, '', 'B shell must not inherit A command');
  assert.equal(report.shell.bOldResult, 0, 'B shell must not display A result');
  assert.equal(report.shell.bStop, 0, 'B shell must not offer Stop for A work');
  assert.deepEqual(report.shell.bDuringARun, { dialogStop: 0, sessionStop: 0 },
    'B must not expose either Stop target for A running shell');
  assert.equal(report.transfer.leakedAAtAnyMutation, false,
    'B must never render A private share preview, even for one paint');
  assert.equal(report.transfer.bPrivatePreviewVisible, 0);
} catch (error) {
  report.error = error.stack || String(error);
  report.body = (await app?.windows()[0]?.locator('body').innerText().catch(() => ''))?.slice(-7000);
  process.exitCode = 1;
  console.error(error);
  await app?.windows()[0]?.screenshot({ path: join(f.output, 'pi-dialog-session-isolation-failure.png') }).catch(() => {});
} finally {
  try { report.cleanup = await closeOwned(app, f); assertCleanExit(report.cleanup, logs, 'Pi dialog session isolation GUI'); }
  catch (error) { report.cleanupError = String(error); process.exitCode = 1; }
  await model.close();
  await writeFile(join(f.output, 'pi-dialog-session-isolation-gui-report.json'), JSON.stringify(report, null, 2));
  await writeFile(join(f.output, 'pi-dialog-session-isolation-gui.log'), logs.join(''));
  console.log(JSON.stringify(report, null, 2));
}
