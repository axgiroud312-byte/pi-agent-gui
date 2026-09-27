// Native production-entry privacy proof for Issue #27.
import assert from 'node:assert/strict';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixture } from './native-smoke/fixture.mjs';
import { assertCleanExit, closeOwned } from './native-smoke/cleanup.mjs';
import { startPiModel } from './native-smoke/pi-model.mjs';
import { configurePiProfile, isolatePiPackage, verifyPiPackageCleanup } from './native-smoke/pi-package.mjs';

const f = await fixture();
const namedWorkspace = join(f.sandbox, 'PRIVATE_DIRECTORY_SENTINEL');
await rename(f.workspace, namedWorkspace);
f.workspace = namedWorkspace;
f.env.NATIVE_SMOKE_WORKSPACE = namedWorkspace;
await isolatePiPackage(f);
const model = await startPiModel();
await configurePiProfile(f, { url: model.url, modelId: 'pi-native-test', apiKey: 'sk-PRIVATE_KEY_SENTINEL' });
const report = { at: new Date().toISOString(), pageErrors: [],
  inference: 'fixed Pi 0.87.0 RPC with a deterministic loopback provider, not an online provider' };
const logs = [];
let app;

async function boundaries() {
  return (await readFile(f.env.NATIVE_SMOKE_BOUNDARY_LOG, 'utf8'))
    .split('\n').filter(Boolean).map(JSON.parse);
}

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
  await page.getByTestId('composer-workspace-trigger').filter({ hasText: 'PRIVATE_DIRECTORY_SENTINEL' }).waitFor();

  await page.getByTestId('sidebar').getByTestId('task-settings-button').click();
  if (!await page.getByRole('button', { name: '创建自定义供应商', exact: true }).isVisible()) {
    await page.getByRole('button', { name: '模型设置', exact: true }).click();
    await page.getByTestId('model-provider-add-provider-button').click();
  }
  await page.getByRole('button', { name: '创建自定义供应商', exact: true }).click();
  await page.getByTestId('model-provider-base-url-input').fill(model.url);
  await page.getByTestId('model-provider-api-key-input').fill('sk-PRIVATE_KEY_SENTINEL');
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
  await page.keyboard.type('PI_TEXT: Error: PRIVATE_STACK_SENTINEL futureField=PRIVATE_UNKNOWN_SENTINEL Bearer PRIVATE_BEARER_SENTINEL');
  model.releaseText();
  await page.getByTestId('v4-composer-send').filter({ visible: true }).first().click();
  await page.getByText('PI_TEXT_COMPLETE', { exact: true }).waitFor({ timeout: 30_000 });
  assert(model.requests.some(request => request.scenario === 'PI_TEXT'));
  await verifyPiPackageCleanup(f);
  report.pinnedPiRpcObserved = true;

  await page.getByTestId('workspace-help-menu-trigger').filter({ visible: true }).first().click();
  await page.getByRole('menuitem', { name: '问题上报', exact: true }).click();
  await page.getByTestId('pi-diagnostics-preview-dialog').waitFor();
  await page.getByTestId('pi-diagnostics-copy').waitFor({ state: 'visible' });
  await page.waitForFunction(() => document.querySelector('[data-testid="pi-diagnostics-preview"]')
    ?.textContent?.includes('Pi runtime: 0.87.0'), null, { timeout: 20_000 });
  const preview = await page.getByTestId('pi-diagnostics-preview').innerText();
  assert.match(preview, /Pi runtime: 0\.87\.0/u);
  assert.match(preview, /Pi bridge: 1\.2\.0/u);
  assert.match(preview, /GUI: (?!unavailable)[^\n]+/u);
  assert.doesNotMatch(preview,
    /PRIVATE_|Bearer|sk-|futureField|stack|apiKey|workspacePath|sessionId|\\Users\\|[A-Z]:\\/iu);
  assert.equal((await boundaries()).filter(entry => entry.type === 'open-external-intercepted').length, 0,
    'Opening the diagnostic preview must not open an external page');
  report.previewText = preview;
  await page.screenshot({ path: join(f.output, 'pi-diagnostics-preview.png') });

  await page.getByTestId('pi-diagnostics-copy').click();
  await page.getByRole('button', { name: '已复制', exact: true }).waitFor();
  const copied = await app.evaluate(({ clipboard }) => clipboard.readText());
  assert.equal(copied, preview, 'Actual OS clipboard text must equal the rendered preview exactly');
  report.copiedEqualsRenderedPreview = true;
  assert.equal((await boundaries()).filter(entry => entry.type === 'open-external-intercepted').length, 0,
    'Copy must not open GitHub or send the report');

  await page.getByTestId('pi-diagnostics-open-issue').click();
  await page.getByTestId('pi-diagnostics-preview-dialog').waitFor({ state: 'hidden' });
  const opens = (await boundaries()).filter(entry => entry.type === 'open-external-intercepted');
  assert.deepEqual(opens.map(entry => entry.detail.url),
    ['https://github.com/axgiroud312-byte/pi-agent-gui/issues/new'],
    'Only the explicitly chosen bare issue URL may reach the external boundary');
  report.externalOpenRequiresExplicitClick = true;
  assert.deepEqual(report.pageErrors, []);
  report.ok = true;
} catch (error) {
  report.error = error.stack || String(error);
  process.exitCode = 1;
  console.error(error);
  const page = app?.windows()[0];
  report.body = (await page?.locator('body').innerText().catch(() => ''))?.slice(-7000);
  await page?.screenshot({ path: join(f.output, 'pi-diagnostics-failure.png') }).catch(() => {});
} finally {
  try { report.cleanup = await closeOwned(app, f); assertCleanExit(report.cleanup, logs, 'Pi diagnostics GUI'); }
  catch (error) { report.cleanupError = String(error); process.exitCode = 1; }
  await model.close();
  await writeFile(join(f.output, 'pi-diagnostics-gui-report.json'), JSON.stringify(report, null, 2));
  await writeFile(join(f.output, 'pi-diagnostics-gui.log'), logs.join(''));
  console.log(JSON.stringify(report, null, 2));
}
