// Native GUI -> Host -> pinned Pi 0.87.0 -> isolated loopback npm registry.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixture } from './native-smoke/fixture.mjs';
import { closeOwned, assertCleanExit } from './native-smoke/cleanup.mjs';
import { startPiModel } from './native-smoke/pi-model.mjs';
import { configurePiProfile, isolatePiPackage, verifyPiPackageCleanup } from './native-smoke/pi-package.mjs';

const name = 'pi-controlled-resource-fixture';
const f = await fixture();
await isolatePiPackage(f);
const model = await startPiModel();
await configurePiProfile(f, { url: model.url, modelId: 'pi-native-test', apiKey: 'fixture-not-a-secret' });
delete f.env.PI_OFFLINE;
const settingsPath = join(f.sandbox, 'pi-profile', 'settings.json');
const npmCli = join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
assert(existsSync(npmCli), "Node's bundled npm CLI is required for the package smoke");
const versions = new Map();
for (const version of ['1.0.0', '1.1.0']) {
  const source = join(f.sandbox, `npm-source-${version}`);
  await mkdir(join(source, 'prompts'), { recursive: true });
  await writeFile(join(source, 'package.json'), JSON.stringify({ name, version, pi: { prompts: ['prompts'] } }));
  await writeFile(join(source, 'prompts', 'npm-template.md'),
    `---\ndescription: npm fixture ${version}\n---\nPackage ${version} $1\n`);
  const [packed] = JSON.parse(execFileSync(process.execPath,
    [npmCli, 'pack', '--json', '--pack-destination', f.sandbox],
    { cwd: source, encoding: 'utf8', windowsHide: true,
      env: { ...process.env, npm_config_audit: 'false', npm_config_fund: 'false' } }));
  const bytes = await readFile(join(f.sandbox, packed.filename));
  versions.set(version, { bytes, shasum: createHash('sha1').update(bytes).digest('hex'),
    integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}` });
}
let latest = '1.0.0';
const registryRequests = [];
const registry = createServer((request, response) => {
  const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
  registryRequests.push(`${request.method} ${pathname}`);
  if (pathname === `/${name}`) {
    const published = [...versions.keys()].filter(version => version <= latest);
    response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    response.end(JSON.stringify({ name, 'dist-tags': { latest }, versions: Object.fromEntries(
      published.map(version => [version, { name, version, dist: {
        tarball: `http://127.0.0.1:${registry.address().port}/${name}/-/${name}-${version}.tgz`,
        shasum: versions.get(version).shasum, integrity: versions.get(version).integrity,
      } }])) }));
    return;
  }
  const tarball = pathname.match(new RegExp(`^/${name}/-/${name}-(\\d+\\.\\d+\\.\\d+)\\.tgz$`));
  if (tarball && versions.has(tarball[1])) {
    response.writeHead(200, { 'content-type': 'application/octet-stream', 'cache-control': 'no-store' });
    response.end(versions.get(tarball[1]).bytes);
    return;
  }
  response.writeHead(404);
  response.end('not found');
});
await new Promise(resolve => registry.listen(0, '127.0.0.1', resolve));
const registryUrl = `http://127.0.0.1:${registry.address().port}/`;
// The isolated GUI bootstrap deliberately strips arbitrary environment values.
// Use Pi's public npmCommand setting so every npm operation stays on loopback.
await writeFile(settingsPath, JSON.stringify({ ...JSON.parse(await readFile(settingsPath, 'utf8')),
  defaultProjectTrust: 'always', npmCommand: [process.execPath, npmCli,
    '--registry', registryUrl, '--cache', join(f.sandbox, 'npm-cache'),
    '--no-audit', '--no-fund', '--prefer-online'] }));

const logs = [];
const report = { at: new Date().toISOString(), workspace: f.workspace, piVersion: '0.87.0',
  npmRegistry: registryUrl, inference: 'deterministic loopback provider, not online provider',
  pageErrors: [], registryRequests };
let app;
try {
  app = await f.playwright._electron.launch({ executablePath: f.electronPath,
    args: [fileURLToPath(new URL('./native-smoke/bootstrap.cjs', import.meta.url)), '--lang=zh-CN'],
    cwd: f.root, env: f.env, timeout: 60_000 });
  app.process().stdout?.on('data', chunk => logs.push(String(chunk)));
  app.process().stderr?.on('data', chunk => logs.push(String(chunk)));
  const page = await app.firstWindow();
  page.setDefaultTimeout(20_000);
  page.on('pageerror', error => report.pageErrors.push(error.stack || error.message));
  await page.waitForTimeout(6000);
  for (const label of [/^(使用 API key|Use API key)$/, /^(暂时跳过|Skip for now)$/, /^(退出引导|Exit onboarding)$/]) {
    const button = page.getByRole('button', { name: label, exact: true });
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
  await page.keyboard.type('PI_TEXT: npm package update setup');
  model.releaseText();
  await page.getByTestId('v4-composer-send').filter({ visible: true }).first().click();
  await page.getByText('PI_TEXT_COMPLETE', { exact: true }).waitFor({ timeout: 30_000 });
  await page.getByTestId('pi-resources-open').click();
  const dialog = page.getByTestId('pi-resources-dialog');
  await dialog.waitFor();
  await dialog.getByText('Pi 0.87.0', { exact: false }).waitFor();
  const row = dialog.getByTestId('pi-resource-package-row').filter({ hasText: `npm:${name}` });
  const command = dialog.getByTestId('pi-resource-command-row').filter({ hasText: '/npm-template' });
  const beforeGeneration = await dialog.getAttribute('data-generation');
  await dialog.getByRole('textbox', { name: 'Pi 包来源' }).fill(`npm:${name}`);
  await dialog.getByRole('button', { name: '安装并重载' }).click();
  await row.waitFor({ timeout: 45_000 });
  await command.getByText('npm fixture 1.0.0', { exact: false }).waitFor();
  const installedGeneration = await dialog.getAttribute('data-generation');
  assert.notEqual(installedGeneration, beforeGeneration);
  const packagePath = join(f.workspace, '.pi', 'npm', 'node_modules', name, 'package.json');
  assert.equal(JSON.parse(await readFile(packagePath, 'utf8')).version, '1.0.0');
  latest = '1.1.0';
  await row.getByRole('button', { name: '更新', exact: true }).click();
  await command.getByText('npm fixture 1.1.0', { exact: false }).waitFor({ timeout: 45_000 });
  const updatedGeneration = await dialog.getAttribute('data-generation');
  assert.notEqual(updatedGeneration, installedGeneration);
  assert.equal(JSON.parse(await readFile(packagePath, 'utf8')).version, '1.1.0');
  await page.screenshot({ path: join(f.output, 'pi-npm-package-updated.png') });
  await row.getByRole('button', { name: '更新', exact: true }).click();
  await dialog.getByRole('alert').filter({ hasText: /已是当前安装版本，资源未更新/ }).waitFor();
  assert.equal(await dialog.getAttribute('data-generation'), updatedGeneration);
  await page.screenshot({ path: join(f.output, 'pi-npm-package-unchanged.png') });
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden' });
  await composer.click();
  await page.keyboard.type('/npm-template PI_TEXT_ALPHA');
  await page.getByTestId('v4-composer-send').filter({ visible: true }).first().click();
  await page.getByText('PI_TEXT_COMPLETE', { exact: true }).last().waitFor({ timeout: 30_000 });
  assert(model.requests.some(request => request.promptText.includes('Package 1.1.0 PI_TEXT_ALPHA')),
    'real Pi model request must contain the updated npm prompt expansion');
  await page.getByTestId('pi-resources-open').click();
  await dialog.waitFor();
  await row.getByRole('button', { name: '卸载', exact: true }).click();
  await row.waitFor({ state: 'detached', timeout: 45_000 });
  await command.waitFor({ state: 'detached' });
  assert.deepEqual(JSON.parse(await readFile(join(f.workspace, '.pi', 'settings.json'), 'utf8')).packages ?? [], []);
  await verifyPiPackageCleanup(f);
  assert.deepEqual(report.pageErrors, []);
  report.package = { installedVersion: '1.0.0', updatedVersion: '1.1.0',
    installReloaded: beforeGeneration !== installedGeneration,
    updateReloaded: installedGeneration !== updatedGeneration,
    unchangedDidNotReload: true, updatedPromptReachedPiModel: true, uninstalled: true };
  assert(registryRequests.some(request => request.includes(`${name}-1.0.0.tgz`)));
  assert(registryRequests.some(request => request.includes(`${name}-1.1.0.tgz`)));
} catch (error) {
  report.error = error.stack || String(error);
  report.body = (await app?.windows()[0]?.locator('body').innerText().catch(() => ''))?.slice(0, 7000);
  process.exitCode = 1;
  await app?.windows()[0]?.screenshot({ path: join(f.output, 'pi-npm-package-failure.png') }).catch(() => {});
} finally {
  try { report.cleanup = await closeOwned(app, f); assertCleanExit(report.cleanup, logs, 'Pi npm package update GUI'); }
  catch (error) { report.cleanupError = String(error); process.exitCode = 1; }
  await model.close();
  registry.closeAllConnections();
  await new Promise(resolve => registry.close(resolve));
  await writeFile(join(f.output, 'pi-npm-package-update-gui-report.json'), JSON.stringify(report, null, 2));
  await writeFile(join(f.output, 'pi-npm-package-update-gui.log'), logs.join(''));
  console.log(JSON.stringify(report, null, 2));
}
