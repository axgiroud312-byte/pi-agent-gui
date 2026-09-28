// Isolated native desktop -> Host -> fixed Pi settings corruption and recovery.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixture } from './native-smoke/fixture.mjs';
import { closeOwned, assertCleanExit } from './native-smoke/cleanup.mjs';
import { startPiModel } from './native-smoke/pi-model.mjs';
import { configurePiProfile, isolatePiPackage, verifyPiPackageCleanup } from './native-smoke/pi-package.mjs';

const f = await fixture();
f.electronPath = process.env.NATIVE_SMOKE_ELECTRON_PATH ?? f.electronPath;
await isolatePiPackage(f);
const model = await startPiModel();
await configurePiProfile(f, { url: model.url, modelId: 'pi-native-test', apiKey: 'fixture-not-a-secret' });
const settingsPath = join(f.home, '.zcode', 'v2', 'setting.json');
await mkdir(join(f.home, '.zcode', 'v2'), { recursive: true });
const corrupt = JSON.stringify({ recentProjects: [f.workspace], lastWorkspaceSession: 'damaged-field',
  receivePreviewUpdates: true });
await writeFile(settingsPath, corrupt);
const logs = [];
const report = { at: new Date().toISOString(), settingFile: settingsPath,
  model: 'fixed Pi 0.87.0 plus deterministic loopback; no online account', pageErrors: [] };
let app;
let page;
let stageLogStart = 0;
async function launch() {
  stageLogStart = logs.length;
  app = await f.playwright._electron.launch({ executablePath: f.electronPath,
    args: [fileURLToPath(new URL('./native-smoke/bootstrap.cjs', import.meta.url)), '--lang=zh-CN'],
    cwd: f.root, env: f.env, timeout: 60_000 });
  app.process().stdout?.on('data', chunk => logs.push(String(chunk)));
  app.process().stderr?.on('data', chunk => logs.push(String(chunk)));
  page = await app.firstWindow();
  page.setDefaultTimeout(15_000);
  page.on('pageerror', error => report.pageErrors.push(error.stack || error.message));
  return page;
}
async function close(stage) {
  const cleanup = await closeOwned(app, f);
  if (stage === 'corrupt') {
    assert.equal(cleanup.graceful, true);
    assert.deepEqual(cleanup.forced, []);
    assert.deepEqual(cleanup.survivors, []);
  } else assertCleanExit(cleanup, logs.slice(stageLogStart), `corrupt settings ${stage}`);
  report[`${stage}Cleanup`] = cleanup;
  app = undefined;
  page = undefined;
}
try {
  await launch();
  await page.waitForTimeout(8_000);
  report.corruptBody = (await page.locator('body').innerText()).slice(0, 7000);
  report.corruptFileUnchanged = await readFile(settingsPath, 'utf8') === corrupt;
  report.corruptErrorVisible = /setting\.json|settings.*(invalid|corrupt|read)|设置.*损坏/iu.test(report.corruptBody);
  await page.screenshot({ path: join(f.output, 'settings-corrupt.png') });
  assert.equal(report.corruptFileUnchanged, true, 'startup must not replace the original settings bytes');
  assert.equal(report.corruptErrorVisible, true, 'the user needs a visible settings repair hint');
  await close('corrupt');

  await writeFile(settingsPath, JSON.stringify({ recentProjects: [f.workspace],
    lastWorkspaceSession: [], receivePreviewUpdates: true }));
  await launch();
  await page.waitForTimeout(5_000);
  for (const name of [/^(使用 API key|Use API key)$/, /^(暂时跳过|Skip for now)$/,
    /^(退出引导|Exit onboarding)$/]) {
    const button = page.getByRole('button', { name, exact: true });
    if (await button.isVisible()) { await button.click(); await page.waitForTimeout(1_500); }
  }
  await page.getByRole('button', { name: '添加项目', exact: true }).click();
  await page.getByRole('menuitem', { name: '打开文件夹', exact: true }).click();
  await page.getByTestId('composer-workspace-trigger').filter({ hasText: 'parity-workspace' }).waitFor();
  await page.getByTestId('chat-model-select-trigger').click();
  await page.getByTestId('chat-model-select-search').fill('pi-native-test');
  await page.getByRole('menuitemradio', { name: /pi-native-test/ }).first().click();
  const composer = page.getByTestId('v4-composer-input').filter({ visible: true }).first();
  await composer.click();
  await page.keyboard.type('PI_TEXT: settings recovered');
  model.releaseText();
  await page.getByTestId('v4-composer-send').filter({ visible: true }).first().click();
  await page.getByText('PI_TEXT_COMPLETE', { exact: true }).waitFor({ timeout: 30_000 });
  report.recoveredPiRequests = model.requests.filter(request => request.scenario === 'PI_TEXT').length;
  assert.equal(report.recoveredPiRequests, 1);
  report.recoveredRecentProjects = JSON.parse(await readFile(settingsPath, 'utf8')).recentProjects;
  assert(report.recoveredRecentProjects.includes(f.workspace));
  await verifyPiPackageCleanup(f);
  assert.deepEqual(report.pageErrors, []);
  await close('recovered');
} catch (error) {
  report.error = error.stack || String(error);
  report.body = (await page?.locator('body').innerText().catch(() => ''))?.slice(0, 7000);
  process.exitCode = 1;
  console.error(error);
  await page?.screenshot({ path: join(f.output, 'settings-corrupt-failure.png') }).catch(() => {});
} finally {
  if (app) {
    try { await close('failure'); }
    catch (error) { report.cleanupError = String(error); process.exitCode = 1; }
  }
  await model.close();
  await writeFile(join(f.output, 'pi-desktop-settings-corrupt-gui-report.json'), JSON.stringify(report, null, 2));
  await writeFile(join(f.output, 'pi-desktop-settings-corrupt-gui.log'), logs.join(''));
  console.log(JSON.stringify(report, null, 2));
}
