// Native GUI -> Host -> Pi 0.87.0 -> representative extension tool -> JSONL-backed row/image.
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
const extensionDir = join(f.env.PI_CODING_AGENT_DIR, 'extensions');
await mkdir(extensionDir, { recursive: true });
const extensionPath = fileURLToPath(new URL('../examples/pi-gui-compat/extension.ts', import.meta.url));
const extensionSource = (await readFile(extensionPath, 'utf8'))
  .replace('"@earendil-works/pi-ai"', JSON.stringify(import.meta.resolve('@earendil-works/pi-ai')))
  .replace('"@earendil-works/pi-tui"', JSON.stringify(import.meta.resolve('@earendil-works/pi-tui')));
await writeFile(join(extensionDir, 'pi-gui-compat.ts'), extensionSource);

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
  await page.keyboard.type('PI_RICH_TOOL: invoke gui_rich_probe');
  await page.getByTestId('v4-composer-send').filter({ visible: true }).first().click();
  await page.getByText('PI_RICH_TOOL_COMPLETE', { exact: true }).waitFor({ timeout: 30_000 });
  const request = model.requests.find(item => item.scenario === 'PI_RICH_TOOL');
  assert(request?.tools?.includes('gui_rich_probe'), 'model must see the actual Pi registered tool');
  assert(model.requests.some(item => item.toolResults?.some(result => result.includes('before image'))
    && item.imageMimeTypes?.includes('image/png')),
  'Pi must execute the extension tool and return its image to the controlled model');
  const rich = page.locator('[data-pi-tool-result="gui_rich_probe"]');
  if (!await rich.isVisible()) await page.getByText('已处理', { exact: true }).first().click();
  await rich.waitFor();
  assert.match(await rich.innerText(), /before image[\s\S]*after image[\s\S]*原始工具详情/u);
  await rich.locator('img').waitFor({ timeout: 15_000 });
  await page.waitForFunction(() => {
    const image = document.querySelector('[data-pi-tool-result="gui_rich_probe"] img');
    return image?.complete && image.naturalWidth > 0;
  });
  await rich.locator('summary').click();
  assert.match(await rich.innerText(), /original tool details/u);
  report.richTool = { piExecuted: true, orderedTextVisible: true, imageDecoded: true,
    originalDetailsVisible: true };
  await page.screenshot({ path: join(f.output, 'pi-rich-tool-result.png') });
  await verifyPiPackageCleanup(f);
  assert.deepEqual(report.pageErrors, []);
  report.ok = true;
} catch (error) {
  report.error = error.stack || String(error);
  process.exitCode = 1;
  console.error(error);
  const page = app?.windows()[0];
  report.body = (await page?.locator('body').innerText().catch(() => ''))?.slice(-7000);
  await page?.screenshot({ path: join(f.output, 'pi-rich-tool-failure.png') }).catch(() => {});
} finally {
  report.modelRequests = model.requests;
  try { report.cleanup = await closeOwned(app, f); assertCleanExit(report.cleanup, logs, 'Pi rich tool GUI'); }
  catch (error) { report.cleanupError = String(error); process.exitCode = 1; }
  await model.close();
  await writeFile(join(f.output, 'pi-rich-tool-gui-report.json'), JSON.stringify(report, null, 2));
  await writeFile(join(f.output, 'pi-rich-tool-gui.log'), logs.join(''));
  console.log(JSON.stringify(report, null, 2));
}
