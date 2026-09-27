// Isolated native GUI -> Host -> pinned Pi resource/package probe. Run alone with a built desktop Host.
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
  defaultProjectTrust: 'always', packages: ['npm:pi-resource-update-fixture',
    'npm:pi-resource-fixed-fixture@1.2.3'] }));
const projectPrompts = join(f.workspace, '.pi', 'prompts');
await mkdir(projectPrompts, { recursive: true });
await writeFile(join(projectPrompts, 'gui-template.md'),
  '---\ndescription: Before GUI edit\n---\nExpanded $1');
const packagePath = join(f.workspace, 'sample-package');
await mkdir(join(packagePath, 'prompts'), { recursive: true });
await writeFile(join(packagePath, 'prompts', 'package-template.md'),
  '---\ndescription: Installed from Pi\n---\nPackage $1');
const logs = [];
const report = { at: new Date().toISOString(), workspace: f.workspace, piVersion: '0.87.0',
  inference: 'deterministic loopback provider, not online provider', pageErrors: [], packagePath };
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
  await page.getByTestId('chat-model-select-search').fill('pi-native-test');
  await page.getByRole('menuitemradio', { name: /pi-native-test/ }).first().click();
  const composer = page.getByTestId('v4-composer-input').filter({ visible: true }).first();
  await composer.click();
  await page.keyboard.type('PI_TEXT: resource control smoke');
  model.releaseText();
  await page.getByTestId('v4-composer-send').filter({ visible: true }).first().click();
  await page.getByText('PI_TEXT_COMPLETE', { exact: true }).waitFor({ timeout: 30_000 });
  assert(model.requests.some(request => request.scenario === 'PI_TEXT'));
  await page.getByTestId('pi-resources-open').click();
  const dialog = page.getByTestId('pi-resources-dialog');
  await dialog.waitFor();
  await dialog.getByText('Pi 0.87.0', { exact: false }).waitFor();
  const command = name => dialog.getByTestId('pi-resource-command-row').filter({ hasText: `/${name}` });
  await command('gui-template').waitFor();
  const firstGeneration = await dialog.getAttribute('data-generation');
  assert(firstGeneration);
  const unpinnedNpm = dialog.getByTestId('pi-resource-package-row')
    .filter({ hasText: 'npm:pi-resource-update-fixture' });
  const pinnedNpm = dialog.getByTestId('pi-resource-package-row')
    .filter({ hasText: 'npm:pi-resource-fixed-fixture@1.2.3' });
  await unpinnedNpm.getByRole('button', { name: '离线不可更新' }).waitFor();
  assert(await unpinnedNpm.getByRole('button', { name: '离线不可更新' }).isDisabled());
  await pinnedNpm.getByRole('button', { name: '固定版本' }).waitFor();
  assert(await pinnedNpm.getByRole('button', { name: '固定版本' }).isDisabled());
  await command('gui-template').getByRole('button', { name: '编辑' }).click();
  const editor = dialog.getByTestId('pi-resource-editor');
  await editor.getByRole('textbox', { name: 'Pi 资源内容' }).fill(
    '---\ndescription: Edited by native GUI\n---\nExpanded $1');
  await editor.getByRole('button', { name: '保存并重载' }).click();
  await page.waitForFunction(previous =>
    document.querySelector('[data-testid="pi-resources-dialog"]')?.getAttribute('data-generation') !== previous,
  firstGeneration);
  await command('gui-template').getByText('Edited by native GUI').waitFor();
  const secondGeneration = await dialog.getAttribute('data-generation');
  assert.notEqual(secondGeneration, firstGeneration);
  const available = dialog.getByTestId('pi-resource-availability-row').filter({ hasText: 'gui-template.md' });
  await available.getByRole('button', { name: '停用' }).click();
  await command('gui-template').waitFor({ state: 'detached' });
  await available.getByRole('button', { name: '启用' }).click();
  await command('gui-template').waitFor();
  await dialog.getByRole('textbox', { name: 'Pi 包来源' }).fill(packagePath);
  await dialog.getByRole('button', { name: '安装并重载' }).click();
  await command('package-template').waitFor();
  const pkg = dialog.getByTestId('pi-resource-package-row').filter({ hasText: 'sample-package' });
  await pkg.getByRole('button', { name: '过滤' }).click();
  await pkg.getByRole('textbox', { name: 'Pi 包过滤规则' }).fill('{"prompts":[]}');
  await pkg.getByRole('button', { name: '应用并重载' }).click();
  await command('package-template').waitFor({ state: 'detached' });
  await pkg.getByRole('button', { name: '卸载' }).click();
  await pkg.waitFor({ state: 'detached' });
  const packageSettings = JSON.parse(await readFile(join(f.workspace, '.pi', 'settings.json'), 'utf8'));
  assert.deepEqual(packageSettings.packages ?? [], []);
  await page.screenshot({ path: join(f.output, 'pi-resources-dialog.png') });
  report.resources = { generationChanged: firstGeneration !== secondGeneration,
    templateEdited: true, templateDisabledAndEnabled: true, localPackageInstalledFilteredRemoved: true,
    offlineUpdateBlocked: true, pinnedNpmUpdateExplained: true };
  await verifyPiPackageCleanup(f);
  assert.deepEqual(report.pageErrors, []);
} catch (error) {
  report.error = error.stack || String(error);
  report.body = (await app?.windows()[0]?.locator('body').innerText().catch(() => ''))?.slice(0, 7000);
  process.exitCode = 1;
  console.error(error);
  await app?.windows()[0]?.screenshot({ path: join(f.output, 'pi-resources-failure.png') }).catch(() => {});
} finally {
  try { report.cleanup = await closeOwned(app, f); assertCleanExit(report.cleanup, logs, 'Pi resources GUI'); }
  catch (error) { report.cleanupError = String(error); process.exitCode = 1; }
  await model.close();
  await writeFile(join(f.output, 'pi-resources-gui-report.json'), JSON.stringify(report, null, 2));
  await writeFile(join(f.output, 'pi-resources-gui.log'), logs.join(''));
  console.log(JSON.stringify(report, null, 2));
}
