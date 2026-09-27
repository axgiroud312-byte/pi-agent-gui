// Run alone after a production desktop build: native renderer -> Host -> pinned Pi -> loopback router.
// This proves the integration path, not real GGUF inference.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixture } from './native-smoke/fixture.mjs';
import { closeOwned, assertCleanExit } from './native-smoke/cleanup.mjs';
import { startPiModel } from './native-smoke/pi-model.mjs';
import { configurePiProfile, isolatePiPackage, verifyPiPackageCleanup } from './native-smoke/pi-package.mjs';

const f = await fixture();
await isolatePiPackage(f);
const fallback = await startPiModel();
await configurePiProfile(f, { url: fallback.url, modelId: 'pi-native-test', apiKey: 'fixture-not-a-secret' });
let status = 'unloaded';
const routerRequests = [];
const router = createServer(async (request, response) => {
  let raw = '';
  for await (const part of request) raw += part;
  routerRequests.push({ path: request.url, method: request.method, authorization: request.headers.authorization,
    body: raw ? JSON.parse(raw) : undefined });
  if (request.url === '/models/sse') {
    response.writeHead(200, { 'content-type': 'text/event-stream' }); return;
  }
  if ((request.url === '/models' || request.url === '/models?reload=1') && request.method === 'GET') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ data: [{ id: 'gui.gguf', source: 'file', status: { value: status },
      meta: { n_ctx: 4096 } }] })); return;
  }
  if (request.url?.startsWith('/props')) {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ chat_template: 'chatml', models_autoload: false })); return;
  }
  if (request.url === '/models/load' && request.method === 'POST') {
    status = 'loaded'; response.writeHead(200, { 'content-type': 'application/json' }); response.end('{}'); return;
  }
  if (request.url === '/models/unload' && request.method === 'POST') {
    status = 'unloaded'; response.writeHead(200, { 'content-type': 'application/json' }); response.end('{}'); return;
  }
  if (request.url === '/v1/chat/completions' && request.method === 'POST') {
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    response.end(`data: ${JSON.stringify({ id: 'gui-router', object: 'chat.completion.chunk', created: 1,
      model: 'gui.gguf', choices: [{ index: 0, delta: { role: 'assistant', content: 'PI_LLAMA_GUI_REPLY' },
        finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`); return;
  }
  response.writeHead(404); response.end();
});
await new Promise(resolve => router.listen(0, '127.0.0.1', resolve));
const address = router.address();
assert(address && typeof address !== 'string');
f.env.LLAMA_BASE_URL = `http://127.0.0.1:${address.port}`;
f.env.LLAMA_API_KEY = 'gui-router-test-key';
const report = { at: new Date().toISOString(), workspace: f.workspace, piVersion: '0.87.0',
  inference: 'loopback router contract, not real GGUF', pageErrors: [], routerUrl: f.env.LLAMA_BASE_URL };
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
  await page.getByTestId('model-provider-base-url-input').fill(fallback.url);
  await page.getByTestId('model-provider-api-key-input').fill('fixture-not-a-secret');
  await page.getByTestId('model-provider-api-format-trigger').click();
  await page.getByRole('option', { name: /Chat Completions/ }).click();
  await page.getByTestId('model-provider-add-model-button').click();
  await page.getByPlaceholder('模型 ID', { exact: true }).fill('pi-native-test');
  await page.getByRole('dialog').getByRole('button', { name: '保存', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  assert(JSON.stringify(JSON.parse(await readFile(join(f.home, '.zcode', 'v2', 'provider_config.json'), 'utf8')))
    .includes('new-provider'));
  await page.getByTestId('settings-back-button').click();
  await page.getByTestId('settings-page').waitFor({ state: 'hidden' });
  await page.getByTestId('chat-model-select-trigger').click();
  await page.getByRole('menuitem', { name: '新供应商', exact: true }).press('ArrowRight');
  await page.getByText('pi-native-test', { exact: true }).click();
  await page.keyboard.press('Escape');
  await page.getByTestId('v4-composer-input').filter({ visible: true }).first().click();
  await page.keyboard.type('PI_TEXT: create Pi router session');
  fallback.releaseText();
  await page.getByTestId('v4-composer-send').filter({ visible: true }).first().click();
  await page.getByText('PI_TEXT_COMPLETE', { exact: true }).waitFor({ timeout: 30_000 });
  await page.getByTestId('pi-llama-router-open').click();
  const dialog = page.getByTestId('pi-llama-router-dialog');
  await dialog.waitFor();
  const model = dialog.locator('[data-model-id="gui.gguf"]');
  await model.getByText('未加载', { exact: false }).waitFor();
  await model.getByRole('button', { name: '加载' }).click();
  await model.getByText('已加载', { exact: false }).waitFor({ timeout: 30_000 });
  await model.getByText('Pi 可选', { exact: false }).waitFor();
  await page.screenshot({ path: join(f.output, 'pi-llama-loaded.png') });
  await page.keyboard.press('Escape');
  await page.getByTestId('chat-model-select-trigger').click();
  await page.getByRole('menuitem', { name: 'llama.cpp', exact: true }).press('ArrowRight');
  await page.getByText('gui.gguf', { exact: true }).click();
  await page.keyboard.press('Escape');
  await page.getByTestId('v4-composer-input').filter({ visible: true }).first().click();
  await page.keyboard.type('router GUI inference');
  await page.getByTestId('v4-composer-send').filter({ visible: true }).first().click();
  await page.getByText('PI_LLAMA_GUI_REPLY', { exact: true }).waitFor({ timeout: 30_000 });
  assert.equal(routerRequests.filter(item => item.path === '/v1/chat/completions').length, 1);
  assert.equal(routerRequests.find(item => item.path === '/v1/chat/completions')?.authorization,
    'Bearer gui-router-test-key');
  await page.getByTestId('pi-llama-router-open').click();
  await dialog.locator('[data-model-id="gui.gguf"]').getByRole('button', { name: '卸载' }).click();
  await dialog.locator('[data-model-id="gui.gguf"]').getByText('未加载', { exact: false }).waitFor();
  await page.screenshot({ path: join(f.output, 'pi-llama-unloaded.png') });
  await verifyPiPackageCleanup(f);
  assert.deepEqual(report.pageErrors, []);
  report.router = { load: routerRequests.filter(item => item.path === '/models/load').length,
    inference: routerRequests.filter(item => item.path === '/v1/chat/completions').length,
    unload: routerRequests.filter(item => item.path === '/models/unload').length };
} catch (error) {
  report.error = error.stack || String(error);
  report.body = (await app?.windows()[0]?.locator('body').innerText().catch(() => ''))?.slice(0, 7000);
  process.exitCode = 1;
  console.error(error);
  await app?.windows()[0]?.screenshot({ path: join(f.output, 'pi-llama-failure.png') }).catch(() => {});
} finally {
  try { report.cleanup = await closeOwned(app, f); assertCleanExit(report.cleanup, logs, 'Pi llama router GUI'); }
  catch (error) { report.cleanupError = String(error); process.exitCode = 1; }
  await fallback.close();
  router.closeAllConnections(); await new Promise(resolve => router.close(() => resolve()));
  await writeFile(join(f.output, 'pi-llama-gui-report.json'), JSON.stringify(report, null, 2));
  await writeFile(join(f.output, 'pi-llama-gui.log'), logs.join(''));
  console.log(JSON.stringify(report, null, 2));
}
