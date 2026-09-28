// Native Electron -> Host -> pinned Pi 0.87.0 -> deferred local fake gh publisher.
// The fake intercepts every gh command in the isolated Host; no Gist is sent.
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
const fakeId = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const viewerUrl = `https://pi.dev/session/#${fakeId}`;
const gistUrl = `https://gist.github.com/example/${fakeId}`;
const called = join(f.output, 'fake-gh-called.jsonl');
const released = join(f.output, 'fake-gh-release');
const completed = join(f.output, 'fake-gh-completed');
Object.assign(f.env, {
  NATIVE_SMOKE_FAKE_GH_CALLED: called,
  NATIVE_SMOKE_FAKE_GH_RELEASE: released,
  NATIVE_SMOKE_FAKE_GH_COMPLETED: completed,
  NATIVE_SMOKE_FAKE_GH_URL: gistUrl,
});
const report = { at: new Date().toISOString(), piVersion: '0.87.0',
  inference: 'deterministic loopback provider, not online provider',
  publisher: 'local deferred child_process interception; no GitHub request',
  remoteGistCreated: false, pageErrors: [] };
const logs = [];
let app;
const waitForFile = async path => {
  for (let attempt = 0; attempt < 300; attempt++) {
    try { return await readFile(path, 'utf8'); } catch { await new Promise(resolve => setTimeout(resolve, 100)); }
  }
  throw new Error(`Timed out waiting for fake publisher file: ${path}`);
};
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
  const chooseModel = async () => {
    await page.getByTestId('chat-model-select-trigger').click();
    await page.getByTestId('chat-model-select-search').fill('pi-native-test');
    await page.getByRole('menuitemradio', { name: /pi-native-test/ }).first().click();
  };
  const send = async prompt => {
    await page.getByTestId('v4-composer-input').filter({ visible: true }).first().click();
    await page.keyboard.type(prompt);
    await page.getByTestId('v4-composer-send').filter({ visible: true }).first().click();
    await page.locator('[data-testid^="v4-session-pane"]').filter({ visible: true }).first()
      .getByText('PI_HELLO_COMPLETE', { exact: true }).waitFor({ timeout: 30_000 });
  };
  const activeId = () => page.locator('[data-testid^="v4-session-pane"]')
    .filter({ visible: true }).first().getAttribute('data-session-id');
  const select = async id => {
    await page.locator(`[data-testid="task-item-${id}"]`).click();
    await page.locator(`[data-session-id="${id}"]`).filter({ visible: true }).waitFor();
  };
  await chooseModel();
  await send('PI_HELLO: A_PRIVATE_SHARE_RECEIPT');
  const sessionA = await activeId();
  await page.getByText('新建任务', { exact: true }).first().click();
  await chooseModel();
  await send('PI_HELLO: B_PUBLIC_SHARE_RECEIPT');
  const sessionB = await activeId();
  assert.ok(sessionA && sessionB && sessionA !== sessionB);
  await select(sessionA);
  const transfer = page.getByTestId('pi-transfer-dialog');
  await page.getByTestId('pi-transfer-open').click();
  await transfer.getByTestId('pi-transfer-last-answer').filter({ hasText: 'PI_HELLO_COMPLETE' }).waitFor();
  await transfer.getByTestId('pi-share-preview').click();
  await transfer.getByTestId('pi-share-content-preview')
    .filter({ hasText: 'A_PRIVATE_SHARE_RECEIPT' }).waitFor();
  await transfer.getByTestId('pi-share-confirm-checkbox').check();
  await transfer.getByTestId('pi-share-publish').click();
  const fakeCalls = (await waitForFile(called)).trim().split(/\r?\n/u).map(JSON.parse);
  assert.equal(fakeCalls.length, 1, 'one confirmed A action makes one fake publisher call');
  assert.equal(fakeCalls[0].containsA, true);
  assert.equal(fakeCalls[0].containsB, false);
  await page.evaluate(b => {
    window.__shareReceiptLeakedA = false;
    window.__shareReceiptObserver = new MutationObserver(() => {
      const pane = document.querySelector(`[data-testid^="v4-session-pane"][data-session-id="${b}"]`);
      if (pane?.getClientRects().length && document.body.innerText.includes('pi.dev/session/#aaaaaaaa')) {
        window.__shareReceiptLeakedA = true;
      }
    });
    window.__shareReceiptObserver.observe(document.body, { subtree: true, childList: true, characterData: true });
    document.querySelector(`[data-testid="task-item-${b}"]`)?.click();
  }, sessionB);
  await page.locator(`[data-session-id="${sessionB}"]`).filter({ visible: true }).waitFor();
  await writeFile(released, 'release');
  await waitForFile(completed);
  await page.waitForTimeout(500);
  report.sessionIsolation = { sessionA, sessionB,
    bSawAReceiptAtAnyMutation: await page.evaluate(() => {
      window.__shareReceiptObserver.disconnect();
      return window.__shareReceiptLeakedA;
    }), bReceiptCount: await transfer.getByTestId('pi-share-receipts').count() };
  assert.equal(report.sessionIsolation.bSawAReceiptAtAnyMutation, false);
  assert.equal(report.sessionIsolation.bReceiptCount, 0);
  await select(sessionA);
  await page.getByTestId('pi-transfer-open').click();
  await transfer.getByTestId('pi-share-receipts').getByRole('status')
    .filter({ hasText: viewerUrl }).waitFor({ timeout: 15_000 });
  assert.match(await transfer.getByTestId('pi-share-receipts').innerText(), new RegExp(fakeId, 'u'));
  await page.screenshot({ path: join(f.output, 'pi-share-receipt-a.png') });
  report.receipt = { publisherCalls: fakeCalls.length, sourceHtmlSha256: fakeCalls[0].sha256,
    sourceHtmlBytes: fakeCalls[0].bytes, aRecoveredAfterSwitch: true,
    onlyInRendererMemory: true, realGistCreated: false };
  assert.deepEqual(report.pageErrors, []);
  await verifyPiPackageCleanup(f);
} catch (error) {
  report.error = error.stack || String(error);
  report.body = (await app?.windows()[0]?.locator('body').innerText().catch(() => ''))?.slice(-7000);
  process.exitCode = 1;
  console.error(error);
  await app?.windows()[0]?.screenshot({ path: join(f.output, 'pi-share-receipt-failure.png') }).catch(() => {});
} finally {
  try { report.cleanup = await closeOwned(app, f); assertCleanExit(report.cleanup, logs, 'Pi share receipt GUI'); }
  catch (error) { report.cleanupError = String(error); process.exitCode = 1; }
  await model.close();
  await writeFile(join(f.output, 'pi-share-receipt-gui-report.json'), JSON.stringify(report, null, 2));
  await writeFile(join(f.output, 'pi-share-receipt-gui.log'), logs.join(''));
  console.log(JSON.stringify(report, null, 2));
}
