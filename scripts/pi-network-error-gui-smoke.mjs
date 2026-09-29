// Real Electron -> sanitized Host -> fixed Pi -> environment-only CONNECT proxy.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { connect } from 'node:net';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixture } from './native-smoke/fixture.mjs';
import { closeOwned, assertCleanExit } from './native-smoke/cleanup.mjs';
import { startPiModel } from './native-smoke/pi-model.mjs';
import { configurePiProfile, isolatePiPackage } from './native-smoke/pi-package.mjs';

const f = await fixture();
const packagedExecutable = process.env.NATIVE_PI_PACKAGED_EXE;
if (packagedExecutable) {
  f.electronPath = packagedExecutable;
  f.workspace = join(f.home, '.zcode', 'workspace', 'default');
  await mkdir(f.workspace, { recursive: true });
  f.env.ZCODE_DESKTOP_PROFILE_HOME = f.home;
  delete f.env.NODE_OPTIONS;
}
const model = await startPiModel();
const sockets = new Set();
let reachable = false;
let tunnels = 0;
const proxy = createServer((_req, res) => { res.writeHead(405); res.end(); });
proxy.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
proxy.on('connect', (req, client, head) => {
  tunnels++;
  if (req.url !== 'pi-network.invalid:80' || !reachable) { client.destroy(); return; }
  const upstream = connect(Number(new URL(model.url).port), '127.0.0.1', () => {
    client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    if (head.length) upstream.write(head);
    upstream.pipe(client); client.pipe(upstream);
  });
  upstream.on('error', () => client.destroy());
  client.on('error', () => upstream.destroy());
  client.on('close', () => upstream.destroy());
});
await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve));
const report = { at: new Date().toISOString(), boundary: 'Electron -> Host -> Pi 0.87.0 -> loopback proxy/model; no online provider',
  executable: f.electronPath, packaged: Boolean(packagedExecutable), pageErrors: [], phases: [] };
let app;
let logs = [];

async function open() {
  logs = [];
  app = await f.playwright._electron.launch({ executablePath: f.electronPath,
    args: packagedExecutable ? ['--lang=zh-CN'] : [fileURLToPath(new URL('./native-smoke/bootstrap.cjs', import.meta.url)), '--lang=zh-CN'],
    cwd: packagedExecutable ? f.sandbox : f.root, env: f.env, timeout: 60_000 });
  app.process().stdout?.on('data', chunk => logs.push(String(chunk)));
  app.process().stderr?.on('data', chunk => logs.push(String(chunk)));
  const page = await app.firstWindow();
  page.setDefaultTimeout(25_000);
  page.on('pageerror', error => report.pageErrors.push(error.message));
  await page.waitForTimeout(5000);
  for (const name of [/^(使用 API key|Use API key)$/, /^(暂时跳过|Skip for now)$/, /^(退出引导|Exit onboarding)$/]) {
    const button = page.getByRole('button', { name, exact: true });
    if (await button.isVisible()) { await button.click(); await page.waitForTimeout(1000); }
  }
  const addProject = page.getByRole('button', { name: '添加项目', exact: true });
  if (!packagedExecutable && await addProject.isVisible()) {
    await addProject.click();
    await page.getByRole('menuitem', { name: '打开文件夹', exact: true }).click();
  }
  return page;
}
async function close(phase) {
  const cleanup = await closeOwned(app, f);
  app = undefined;
  assertCleanExit(cleanup, logs, phase);
  report.phases.push({ phase, cleanup });
  await writeFile(join(f.output, `${phase}.log`), logs.join(''));
}
async function expectInlineError(page, screenshot) {
  const inline = page.getByTestId('v4-timeline').getByTestId('pi-model-error').last();
  await inline.getByText('模型连接失败', { exact: true }).waitFor({ timeout: 45_000 });
  await page.getByTestId('v4-stop').filter({ visible: true }).waitFor({ state: 'hidden', timeout: 30_000 });
  assert.equal(await page.getByTestId('chat-error-banner').count(), 0, 'no duplicate composer error banner');
  await inline.locator('summary').click();
  assert.match(await inline.innerText(), /fetch failed|Connection error/i);
  await page.screenshot({ path: join(f.output, screenshot) });
}
try {
  await isolatePiPackage(f);
  await configurePiProfile(f, { url: 'http://pi-network.invalid/v1', modelId: 'pi-native-test', apiKey: 'fixture-only' });
  const settingsFile = join(f.sandbox, 'pi-profile', 'settings.json');
  const settings = JSON.parse(await readFile(settingsFile, 'utf8'));
  settings.retry = { enabled: false, provider: { maxRetries: 0 } };
  await writeFile(settingsFile, JSON.stringify(settings));
  assert.equal(settings.httpProxy, undefined);
  f.env.HTTP_PROXY = f.env.HTTPS_PROXY = `http://127.0.0.1:${proxy.address().port}`;
  f.env.NO_PROXY = 'localhost,127.0.0.1';
  let page = await open();
  await page.getByTestId('chat-model-select-trigger').click();
  await page.getByTestId('chat-model-select-search').fill('pi-native-test');
  await page.getByRole('menuitemradio', { name: /pi-native-test/ }).first().click();
  let composer = page.getByTestId('v4-composer-input').filter({ visible: true }).first();
  await composer.fill('NETWORK_FAILURE_CHECK');
  await page.getByTestId('v4-composer-send').filter({ visible: true }).first().click();
  await expectInlineError(page, 'connection-error-inline.png');
  assert(tunnels > 0, 'Pi must reach the environment-only proxy even on the failing request');
  assert.equal(model.requests.length, 0);
  await close('failed-request');
  page = await open();
  const task = page.getByTestId('sidebar').locator('[data-testid^="task-item-"]').filter({ hasText: 'NETWORK_FAILURE_CHECK' }).first();
  await task.click();
  await expectInlineError(page, 'connection-error-restored.png');
  reachable = true;
  composer = page.getByTestId('v4-composer-input').filter({ visible: true }).first();
  await composer.fill('NETWORK_RECOVERY_CHECK');
  await page.getByTestId('v4-composer-send').filter({ visible: true }).first().click();
  await page.getByText('PI_TEXT_COMPLETE', { exact: true }).waitFor({ timeout: 45_000 });
  assert.equal(model.requests.length, 1, 'recovery must use Pi through the restored proxy');
  assert.equal(await page.getByTestId('chat-error-banner').count(), 0);
  await page.screenshot({ path: join(f.output, 'connection-recovered.png') });
  report.proxyTunnels = tunnels;
  report.modelRequests = model.requests.length;
  report.profileProxy = settings.httpProxy ?? null;
  assert.deepEqual(report.pageErrors, []);
  await close('recovered-request');
} catch (error) {
  report.error = error.stack || String(error);
  process.exitCode = 1;
  if (app) {
    report.body = await app.windows()[0]?.locator('body').innerText().catch(() => '');
    await app.windows()[0]?.screenshot({ path: join(f.output, 'failure.png') }).catch(() => {});
  }
} finally {
  if (app) await close('cleanup').catch(error => { report.cleanupError = String(error); process.exitCode = 1; });
  for (const socket of sockets) socket.destroy();
  await new Promise(resolve => proxy.close(resolve));
  await model.close();
  await writeFile(join(f.output, 'pi-network-error-gui-report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
