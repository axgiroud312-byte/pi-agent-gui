// Native GUI -> Host -> pinned Pi 0.87.0 package scope warning; no package update is performed.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
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
const profileSettings = join(f.sandbox, 'pi-profile', 'settings.json');
await writeFile(profileSettings, JSON.stringify({ ...JSON.parse(await readFile(profileSettings, 'utf8')),
  defaultProjectTrust: 'always', packages: ['npm:pi-resource-scope-fixture@^1.0.0'] }));
await mkdir(join(f.workspace, '.pi'), { recursive: true });
await writeFile(join(f.workspace, '.pi', 'settings.json'), JSON.stringify({
  packages: ['npm:pi-resource-scope-fixture@^2.0.0'],
}));
const logs = [];
const report = { at: new Date().toISOString(), workspace: f.workspace, piVersion: '0.87.0',
  inference: 'deterministic loopback provider, not online provider', pageErrors: [] };
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
  await page.getByTestId('composer-workspace-trigger').filter({ hasText: 'parity-workspace' }).waitFor();
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
  await page.getByTestId('chat-model-select-trigger').click();
  await page.getByRole('menuitem', { name: '新供应商', exact: true }).press('ArrowRight');
  await page.getByText('pi-native-test', { exact: true }).click();
  await page.keyboard.press('Escape');
  const composer = page.getByTestId('v4-composer-input').filter({ visible: true }).first();
  await composer.click();
  await page.keyboard.type('PI_TEXT: package scope warning');
  model.releaseText();
  await page.getByTestId('v4-composer-send').filter({ visible: true }).first().click();
  await page.getByText('PI_TEXT_COMPLETE', { exact: true }).waitFor({ timeout: 30_000 });
  assert(model.requests.some(request => request.scenario === 'PI_TEXT'));
  await page.getByTestId('pi-resources-open').click();
  const dialog = page.getByTestId('pi-resources-dialog');
  await dialog.waitFor();
  await dialog.getByText('Pi 0.87.0', { exact: false }).waitFor();
  const rows = dialog.getByTestId('pi-resource-package-row').filter({ hasText: 'pi-resource-scope-fixture' });
  assert.equal(await rows.count(), 2);
  for (const row of await rows.all()) {
    const warning = row.getByTestId('pi-package-update-scope-warning');
    await warning.waitFor();
    assert.match(await warning.innerText(), /用户、项目\s*作用域/);
    assert(await row.getByRole('button', { name: '更新' }).isDisabled());
  }
  const generation = await dialog.getAttribute('data-generation');
  assert(generation);
  await page.screenshot({ path: join(f.output, 'pi-package-update-scope-warning.png') });
  assert.equal(await dialog.getAttribute('data-generation'), generation);
  await verifyPiPackageCleanup(f);
  assert.deepEqual(report.pageErrors, []);
  report.scope = { rows: 2, bothWarned: true, bothUpdateButtonsDisabled: true,
    generationUnchanged: true, packageUpdateInvoked: false };
} catch (error) {
  report.error = error.stack || String(error);
  report.body = (await app?.windows()[0]?.locator('body').innerText().catch(() => ''))?.slice(0, 7000);
  process.exitCode = 1;
  await app?.windows()[0]?.screenshot({ path: join(f.output, 'pi-package-update-scope-failure.png') }).catch(() => {});
} finally {
  try { report.cleanup = await closeOwned(app, f); assertCleanExit(report.cleanup, logs, 'Pi package update scope GUI'); }
  catch (error) { report.cleanupError = String(error); process.exitCode = 1; }
  await model.close();
  await writeFile(join(f.output, 'pi-package-update-scope-gui-report.json'), JSON.stringify(report, null, 2));
  await writeFile(join(f.output, 'pi-package-update-scope-gui.log'), logs.join(''));
  console.log(JSON.stringify(report, null, 2));
}
