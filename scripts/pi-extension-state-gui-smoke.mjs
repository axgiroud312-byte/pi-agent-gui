// Native GUI -> Host -> fixed Pi 0.87.0 extension display and tool control.
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
const extensionDir = join(f.env.PI_CODING_AGENT_DIR, 'extensions');
await mkdir(extensionDir, { recursive: true });
// Profile extensions live outside this repository. Resolve the fixed Pi TypeBox
// dependency to a file URL so the real Pi loader can import the exact version.
const fixturePath = fileURLToPath(new URL('../packages/services/test/fixtures/pi-ui-state.ts', import.meta.url));
const piAiUrl = import.meta.resolve('@earendil-works/pi-ai');
const extensionSource = (await readFile(fixturePath, 'utf8'))
  .replace('"@earendil-works/pi-ai"', JSON.stringify(piAiUrl));
await writeFile(join(extensionDir, 'pi-ui-state.ts'), extensionSource);
const logs = [];
const report = { at: new Date().toISOString(), workspace: f.workspace, piVersion: '0.87.0',
  providerBoundary: 'deterministic loopback provider, no online provider request', pageErrors: [] };
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
  await page.keyboard.type('PI_TEXT: extension display smoke');
  model.releaseText();
  await page.getByTestId('v4-composer-send').filter({ visible: true }).first().click();
  await page.getByText('PI_TEXT_COMPLETE', { exact: true }).waitFor({ timeout: 30_000 });
  assert(model.requests.some(request => request.scenario === 'PI_TEXT'));
  await page.getByTestId('pi-extension-status-startup').waitFor();
  await page.getByTestId('pi-extension-widget-startup').waitFor();
  await page.getByTestId('pi-extension-title').getByText('Pi extension terminal title').waitFor();
  await page.getByText('Pi startup notice', { exact: true }).waitFor();
  const suggestion = page.getByTestId('pi-extension-editor-text');
  assert.equal(await suggestion.inputValue(), 'Pi suggested draft');
  assert(!(await composer.innerText()).includes('Pi suggested draft'), 'extension suggestion must not overwrite a draft');
  await page.screenshot({ path: join(f.output, 'pi-extension-state-before-apply.png') });
  await page.getByRole('button', { name: '应用到输入框', exact: true }).click();
  await composer.filter({ hasText: 'Pi suggested draft' }).waitFor();
  report.editorText = { proposed: true, appliedExplicitly: true };
  await page.getByTestId('pi-tree-open').click();
  const dialog = page.getByTestId('pi-tree-dialog');
  await dialog.waitFor();
  const firstGeneration = await dialog.getAttribute('data-generation');
  assert(firstGeneration);
  await dialog.getByTestId('pi-tools-section').locator('summary').click();
  const probe = dialog.getByTestId('pi-tools-section').getByText('pi_ide_probe', { exact: true });
  await probe.waitFor();
  const checkbox = probe.locator('xpath=../..').locator('input[type=checkbox]');
  const wasChecked = await checkbox.isChecked();
  await checkbox.click();
  await dialog.getByRole('button', { name: '保存启用工具' }).click();
  await page.waitForFunction(([expected]) => {
    const root = document.querySelector('[data-testid="pi-tools-section"]');
    const input = [...root?.querySelectorAll('label') ?? []]
      .find(label => label.textContent?.includes('pi_ide_probe'))?.querySelector('input');
    return input?.checked === expected;
  }, [!wasChecked]);
  await dialog.getByRole('button', { name: '刷新', exact: true }).click();
  assert.equal(await checkbox.isChecked(), !wasChecked, 'Pi readback must preserve the selected tool state');
  await dialog.getByRole('button', { name: '重载扩展' }).click();
  await page.waitForFunction(first => document.querySelector('[data-testid="pi-tree-dialog"]')
    ?.getAttribute('data-generation') !== first, firstGeneration, { timeout: 20_000 });
  assert.equal(await page.getByTestId('pi-extension-status-startup').count(), 0);
  assert.equal(await page.getByTestId('pi-extension-widget-startup').count(), 0);
  assert.equal(await page.getByTestId('pi-extension-title').count(), 0);
  report.extension = { startupStatusVisible: true, widgetVisible: true, titleVisible: true,
    noticeVisible: true, oldStateClearedAfterReload: true, generationChanged: true,
    dynamicToolReadback: true };
  await page.screenshot({ path: join(f.output, 'pi-extension-after-reload.png') });
  await verifyPiPackageCleanup(f);
  assert.deepEqual(report.pageErrors, []);
} catch (error) {
  report.error = error.stack || String(error);
  report.body = (await app?.windows()[0]?.locator('body').innerText().catch(() => ''))?.slice(0, 7000);
  process.exitCode = 1;
  console.error(error);
  await app?.windows()[0]?.screenshot({ path: join(f.output, 'pi-extension-state-failure.png') }).catch(() => {});
} finally {
  try { report.cleanup = await closeOwned(app, f); assertCleanExit(report.cleanup, logs, 'Pi extension state GUI'); }
  catch (error) { report.cleanupError = String(error); process.exitCode = 1; }
  await model.close();
  await writeFile(join(f.output, 'pi-extension-state-gui-report.json'), JSON.stringify(report, null, 2));
  await writeFile(join(f.output, 'pi-extension-state-gui.log'), logs.join(''));
  console.log(JSON.stringify(report, null, 2));
}
