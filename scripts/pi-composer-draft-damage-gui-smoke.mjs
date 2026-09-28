// Native GUI -> Host -> fixed Pi cold recovery of a damaged composer draft record.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixture } from './native-smoke/fixture.mjs';
import { assertCleanExit, closeOwned } from './native-smoke/cleanup.mjs';
import { startPiModel } from './native-smoke/pi-model.mjs';
import { configurePiProfile, isolatePiPackage, verifyPiPackageCleanup } from './native-smoke/pi-package.mjs';

const f = await fixture();
await isolatePiPackage(f);
const model = await startPiModel();
await configurePiProfile(f, { url: model.url, modelId: 'pi-native-test', apiKey: 'fixture-not-a-secret' });
const args = [fileURLToPath(new URL('./native-smoke/bootstrap.cjs', import.meta.url)), '--lang=zh-CN'];
const report = { at: new Date().toISOString(), piVersion: '0.87.0', pageErrors: [],
  modelBoundary: 'real pinned Pi RPC + deterministic loopback model', cleanups: [] };
const logs = [];
let app;

async function launch() {
  app = await f.playwright._electron.launch({ executablePath: f.electronPath,
    args, cwd: f.root, env: f.env, timeout: 60_000 });
  app.process().stdout?.on('data', chunk => logs.push(String(chunk)));
  app.process().stderr?.on('data', chunk => logs.push(String(chunk)));
  const page = await app.firstWindow();
  page.setDefaultTimeout(15_000);
  page.on('pageerror', error => report.pageErrors.push(error.stack || error.message));
  await page.waitForTimeout(6000);
  for (let attempt = 0; attempt < 60; attempt++) {
    if (await page.getByTestId('onboarding-page').isVisible()) {
      await page.getByTestId('onboarding-page').getByRole('button',
        { name: /^(跳过|Skip)$/, exact: true }).click();
      await page.waitForTimeout(1000);
      continue;
    }
    if (await page.getByRole('button', { name: '添加项目', exact: true }).isVisible() ||
      await page.getByTestId('composer-workspace-trigger').filter({ hasText: 'parity-workspace' }).isVisible()) break;
    for (const name of [/^(使用 API key|Use API key)$/, /^(暂时跳过|Skip for now)$/,
      /^(退出引导|Exit onboarding)$/]) {
      const button = page.getByRole('button', { name, exact: true });
      if (await button.isVisible()) { await button.click(); break; }
    }
    await page.waitForTimeout(1000);
  }
  if (!await page.getByTestId('composer-workspace-trigger').filter({ hasText: 'parity-workspace' }).isVisible()) {
    await page.getByRole('button', { name: '添加项目', exact: true }).click();
    await page.getByRole('menuitem', { name: '打开文件夹', exact: true }).click();
    await page.getByTestId('composer-workspace-trigger').filter({ hasText: 'parity-workspace' }).waitFor();
  }
  return page;
}

async function close(stage) {
  const cleanup = await closeOwned(app, f);
  assertCleanExit(cleanup, logs, stage);
  report.cleanups.push(cleanup);
  app = undefined;
}

try {
  let page = await launch();
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
  await page.getByTestId('chat-model-select-trigger').click();
  await page.getByTestId('chat-model-select-search').fill('pi-native-test');
  await page.getByRole('menuitemradio', { name: /pi-native-test/ }).first().click();
  const composer = page.getByTestId('v4-composer-input').filter({ visible: true }).first();
  await composer.click();
  await page.keyboard.type('PI_HELLO: read hello.txt');
  await page.getByTestId('v4-composer-send').filter({ visible: true }).first().click();
  await page.getByText('PI_HELLO_COMPLETE', { exact: true }).waitFor({ timeout: 30_000 });
  report.fixedPiRequests = model.requests.filter(request => request.scenario === 'PI_HELLO').length;
  assert(report.fixedPiRequests >= 1, 'real pinned Pi must call the controlled model');
  await composer.click();
  await page.keyboard.type('PRIVATE_UNSENT_DRAFT_A');
  await page.waitForFunction(() => Object.values(localStorage).some(value => value.includes('PRIVATE_UNSENT_DRAFT_A')));
  const seeded = await page.evaluate(() => {
    const key = Object.entries(localStorage).find(([name, value]) =>
      name.startsWith('zcode-v4-composer-drafts:v1:') && value.includes('PRIVATE_UNSENT_DRAFT_A'))?.[0];
    if (!key) throw new Error('Composer draft aggregate key missing');
    const parsed = JSON.parse(localStorage.getItem(key));
    parsed.scopes['session-B'] = { text: 'PRIVATE_UNSENT_DRAFT_B', updatedAt: Date.now() };
    const raw = JSON.stringify(parsed).replace('"text":"PRIVATE_UNSENT_DRAFT_B"', '"missingText":"PRIVATE_UNSENT_DRAFT_B"');
    localStorage.setItem(key, raw);
    return { key, raw };
  });
  assert(seeded.raw.includes('PRIVATE_UNSENT_DRAFT_A') && seeded.raw.includes('PRIVATE_UNSENT_DRAFT_B'));
  await close('before draft recovery restart');

  page = await launch();
  await page.getByTestId('v4-composer-draft-damaged').waitFor({ timeout: 20_000 });
  const visible = await page.getByTestId('v4-composer-draft-damaged').innerText();
  assert(visible.includes('原始记录仍留在本机'));
  const exported = join(f.output, 'private-draft-recovery.txt');
  // Electron's native session owns downloads; Playwright's Page download event
  // does not fire for this app window. Set an isolated fixture destination at
  // the real will-download boundary instead of opening a system save dialog.
  await app.evaluate(({ BrowserWindow }, savePath) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.webContents.session.on('will-download', (_event, item) => {
      item.setSavePath(savePath);
      globalThis.__piDraftRecoveryDownload = item.getFilename();
    });
  }, exported);
  await page.getByTestId('v4-composer-draft-export').click();
  let downloaded = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await readFile(exported, 'utf8').then(() => true, () => false)) { downloaded = true; break; }
    await page.waitForTimeout(100);
  }
  assert(downloaded, 'native Electron download must save the user-requested raw record');
  report.nativeDownload = await app.evaluate(() => globalThis.__piDraftRecoveryDownload ?? null);
  assert(report.nativeDownload?.startsWith('pi-composer-draft-recovery-'));
  assert.equal(await readFile(exported, 'utf8'), seeded.raw, 'user export must preserve exact original text');
  await page.getByTestId('v4-composer-input').filter({ visible: true }).first().click();
  await page.keyboard.type('NEW_INPUT_AFTER_DAMAGE');
  await page.waitForTimeout(350);
  report.recovery = { visible, exportExact: true, preservedRaw: await page.evaluate(key => localStorage.getItem(key), seeded.key) === seeded.raw,
    newInputVisible: (await page.getByTestId('v4-composer-input').filter({ visible: true }).first().innerText()).includes('NEW_INPUT_AFTER_DAMAGE') };
  assert(report.recovery.preservedRaw && report.recovery.newInputVisible,
    'new input remains visible while the damaged original is preserved');
  await verifyPiPackageCleanup(f);
  assert.deepEqual(report.pageErrors, []);
  report.ok = true;
} catch (error) {
  report.error = error.stack || String(error);
  process.exitCode = 1;
  console.error(error);
  await app?.windows()[0]?.screenshot({ path: join(f.output, 'composer-draft-damage-failure.png') }).catch(() => {});
} finally {
  if (app) {
    try { await close('after draft recovery'); }
    catch (error) { report.cleanupError = String(error); process.exitCode = 1; }
  }
  await model.close();
  await mkdir(f.output, { recursive: true });
  await writeFile(join(f.output, 'pi-composer-draft-damage-gui-report.json'), JSON.stringify(report, null, 2));
  await writeFile(join(f.output, 'pi-composer-draft-damage-gui.log'), logs.join(''));
  console.log(JSON.stringify(report, null, 2));
}
