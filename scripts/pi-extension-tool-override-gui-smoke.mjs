// Native GUI -> Host -> Pi 0.87.0 same-name tool override -> JSONL-backed row.
import assert from 'node:assert/strict';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
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
const extensionDir = join(f.env.PI_CODING_AGENT_DIR, 'extensions');
await mkdir(extensionDir, { recursive: true });
const extensionPath = fileURLToPath(new URL('../examples/pi-gui-compat/tool-override.ts', import.meta.url));
const extensionSource = (await readFile(extensionPath, 'utf8'))
  .replace('"@earendil-works/pi-ai"', JSON.stringify(import.meta.resolve('@earendil-works/pi-ai')));
await writeFile(join(extensionDir, 'tool-override.ts'), extensionSource);

const logs = [];
const report = { at: new Date().toISOString(), pageErrors: [],
  inference: 'fixed Pi 0.87.0 RPC with a deterministic loopback provider; no online provider' };
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
    if (await button.isVisible()) { await button.click(); await page.waitForTimeout(1500); }
  }
  await page.getByRole('button', { name: '添加项目', exact: true }).click();
  await page.getByRole('menuitem', { name: '打开文件夹', exact: true }).click();
  await page.getByTestId('composer-workspace-trigger').filter({ hasText: 'parity-workspace' }).waitFor();
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
  await page.keyboard.type('PI_READ: invoke the Pi read tool on README.md');
  await page.getByTestId('v4-composer-send').filter({ visible: true }).first().click();
  await page.getByText('PI_READ_COMPLETE', { exact: true }).waitFor({ timeout: 30_000 });
  await page.getByTestId('pi-tree-open').click();
  const dialog = page.getByTestId('pi-tree-dialog');
  await dialog.waitFor();
  await dialog.getByTestId('pi-tools-section').locator('summary').click();
  const read = dialog.getByTestId('pi-tools-section').getByText('read', { exact: true });
  await read.waitFor();
  assert(await read.locator('xpath=../..').locator('input[type=checkbox]').isChecked());
  assert.match(await read.locator('xpath=../..').innerText(),
    /Controlled same-name read override for GUI verification/u);
  await page.keyboard.press('Escape');
  const readRequests = model.requests.filter(item => item.scenario === 'PI_READ');
  assert.equal(readRequests.length, 2, 'Pi model must call read, receive one result, then continue');
  assert(readRequests[0]?.tools?.includes('read'), 'model must see Pi read tool');
  assert(readRequests[1]?.toolResults?.some(result => result.includes('EXTENSION_READ_OVERRIDE_MARKER')),
    'Pi must execute the extension override');
  assert(!readRequests[1]?.toolResults?.some(result => result.includes('NATIVE_PARITY_PREVIEW')),
    'Pi must not execute the built-in file read');
  const result = page.locator('[data-pi-tool-result="read"]');
  if (!await result.isVisible()) await page.getByText('已处理', { exact: true }).first().click();
  await result.waitFor();
  assert.equal(await result.getAttribute('open'), null,
    'normal read output starts folded so file content does not fill the native timeline');
  await result.locator('summary').click();
  assert(await result.evaluate(node => node.hasAttribute('open')));
  assert.match(await result.innerText(), /EXTENSION_READ_OVERRIDE_MARKER/u);
  assert.doesNotMatch(await result.innerText(), /NATIVE_PARITY_PREVIEW/u);
  const files = (await readdir(f.env.PI_CODING_AGENT_DIR, { recursive: true })).filter(file => file.endsWith('.jsonl'));
  assert((await Promise.all(files.map(file => readFile(join(f.env.PI_CODING_AGENT_DIR, file), 'utf8'))))
    .some(history => history.includes('EXTENSION_READ_OVERRIDE_MARKER')));
  report.toolOverride = { nativeToolDescriptionVisible: true, activeRead: true,
    extensionExecuted: true, builtinReadExcluded: true, jsonlResult: true,
    resultExplicitlyExpanded: true };
  await page.screenshot({ path: join(f.output, 'pi-read-override-result.png') });
  await verifyPiPackageCleanup(f);
  assert.deepEqual(report.pageErrors, []);
  report.ok = true;
} catch (error) {
  report.error = error.stack || String(error);
  process.exitCode = 1;
  console.error(error);
  const page = app?.windows()[0];
  report.body = (await page?.locator('body').innerText().catch(() => ''))?.slice(-7000);
  await page?.screenshot({ path: join(f.output, 'pi-read-override-failure.png') }).catch(() => {});
} finally {
  report.modelRequests = model.requests;
  try { report.cleanup = await closeOwned(app, f); assertCleanExit(report.cleanup, logs, 'Pi read override GUI'); }
  catch (error) { report.cleanupError = String(error); process.exitCode = 1; }
  await model.close();
  await writeFile(join(f.output, 'pi-read-override-gui-report.json'), JSON.stringify(report, null, 2));
  await writeFile(join(f.output, 'pi-read-override-gui.log'), logs.join(''));
  console.log(JSON.stringify(report, null, 2));
}
