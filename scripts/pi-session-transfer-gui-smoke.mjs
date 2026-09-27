// Native production renderer -> Host -> pinned Pi 0.87.0 transfer and local-only share preview.
// This script never confirms a real Gist publication.
import assert from 'node:assert/strict';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixture } from './native-smoke/fixture.mjs';
import { closeOwned, assertCleanExit } from './native-smoke/cleanup.mjs';
import { startPiModel } from './native-smoke/pi-model.mjs';
import { configurePiProfile, isolatePiPackage, verifyPiPackageCleanup } from './native-smoke/pi-package.mjs';

const f = await fixture();
const importSource = join(f.workspace, 'transfer-import-source.jsonl');
f.env.NATIVE_SMOKE_PICKED_FILE = importSource;
await isolatePiPackage(f);
const model = await startPiModel();
await configurePiProfile(f, { url: model.url, modelId: 'pi-native-test', apiKey: 'fixture-not-a-secret' });
const report = { at: new Date().toISOString(), piVersion: '0.87.0', workspace: f.workspace,
  inference: 'deterministic loopback provider, not an online provider', remoteGistCreated: false, pageErrors: [] };
const logs = [];
const jsonls = async () => {
  const found = [];
  const visit = async directory => {
    for (const entry of await readdir(directory, { withFileTypes: true }).catch(() => [])) {
      const target = join(directory, entry.name);
      if (entry.isDirectory()) await visit(target);
      else if (entry.isFile() && entry.name.endsWith('.jsonl')) found.push(target);
    }
  };
  await visit(join(f.sandbox, 'pi-profile', 'sessions'));
  return found;
};
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
  const send = async prompt => {
    await composer.click(); await page.keyboard.type(prompt);
    await page.getByTestId('v4-composer-send').filter({ visible: true }).first().click();
  };
  await send('PI_HELLO: transfer source');
  await page.getByText('PI_HELLO_COMPLETE', { exact: true }).waitFor({ timeout: 30_000 });
  const sourceFiles = await jsonls();
  const sourceFile = (await Promise.all(sourceFiles.map(async path => ({ path, bytes: await readFile(path) }))))
    .find(item => item.bytes.includes(Buffer.from('PI_HELLO: transfer source')));
  assert(sourceFile, 'Pi must persist the source history');

  await page.getByTestId('pi-transfer-open').click();
  const dialog = page.getByTestId('pi-transfer-dialog');
  await dialog.getByTestId('pi-transfer-last-answer').filter({ hasText: 'PI_HELLO_COMPLETE' }).waitFor();
  await dialog.getByTestId('pi-copy-last-answer').click();
  await dialog.getByRole('status').filter({ hasText: '已复制' }).waitFor();
  await dialog.getByTestId('pi-export-jsonl').click();
  await dialog.getByRole('status').filter({ hasText: 'JSONL' }).waitFor();
  const exportedJsonl = (await readdir(f.workspace)).find(name => /^pi-.*\.jsonl$/u.test(name));
  assert(exportedJsonl, 'native export must create a JSONL file');
  const exportedBytes = await readFile(join(f.workspace, exportedJsonl));
  assert.deepEqual(exportedBytes, sourceFile.bytes, 'raw export must match Pi JSONL exactly');
  await dialog.getByTestId('pi-export-html').click();
  await dialog.getByRole('status').filter({ hasText: 'HTML' }).waitFor();
  const exportedHtml = (await readdir(f.workspace)).find(name => /^pi-.*\.html$/u.test(name));
  assert(exportedHtml, 'native export must create a Pi HTML file');
  const html = await readFile(join(f.workspace, exportedHtml), 'utf8');
  const embedded = /<script id="session-data" type="application\/json">([A-Za-z0-9+/=]+)<\/script>/u.exec(html)?.[1];
  assert(embedded, 'Pi HTML must embed reviewable session data');
  assert.match(Buffer.from(embedded, 'base64').toString('utf8'), /PI_HELLO: transfer source/u);

  await dialog.getByTestId('pi-share-preview').click();
  const confirmation = dialog.getByTestId('pi-share-confirmation');
  await confirmation.waitFor();
  assert.match(await confirmation.getByTestId('pi-share-content-preview').innerText(),
    /PI_HELLO: transfer source/u);
  assert.equal(await confirmation.getByTestId('pi-share-publish').isDisabled(), true,
    'preview alone cannot send content to GitHub');
  await page.screenshot({ path: join(f.output, 'pi-transfer-share-preview.png') });
  report.sharePreview = { realPiHtml: true, explicitConfirmationRequired: true, externalWriteAttempted: false };

  await writeFile(importSource, exportedBytes);
  const importOriginal = await readFile(importSource);
  await dialog.getByTestId('pi-import-jsonl').click();
  await dialog.waitFor({ state: 'hidden', timeout: 30_000 });
  await page.getByText('PI_HELLO: transfer source', { exact: true }).first().waitFor({ timeout: 30_000 });
  const importedFiles = await jsonls();
  const importedFile = importedFiles.find(path => !sourceFiles.includes(path));
  assert(importedFile, 'Pi import must create a new real JSONL');
  assert.deepEqual(await readFile(importSource), importOriginal, 'GUI import must not rewrite selected source');
  await send('PI_IMAGE: imported branch');
  await page.getByText('PI_IMAGE_COMPLETE', { exact: true }).waitFor({ timeout: 30_000 });
  const importedHistory = await readFile(importedFile, 'utf8');
  assert(importedHistory.includes('PI_HELLO: transfer source') && importedHistory.includes('PI_IMAGE: imported branch'));
  assert.deepEqual(await readFile(sourceFile.path), sourceFile.bytes, 'imported follow-up must not rewrite source Pi session');
  report.transfer = { rawBytesMatch: true, htmlFromPi: true, importedSessionFile: importedFile,
    importSourcePreserved: true, importedInferenceViaPi: true };
  await page.screenshot({ path: join(f.output, 'pi-transfer-imported.png') });
  await verifyPiPackageCleanup(f);
  assert.deepEqual(report.pageErrors, []);
} catch (error) {
  report.error = error.stack || String(error);
  report.body = (await app?.windows()[0]?.locator('body').innerText().catch(() => ''))?.slice(-7000);
  process.exitCode = 1;
  console.error(error);
  await app?.windows()[0]?.screenshot({ path: join(f.output, 'pi-transfer-failure.png') }).catch(() => {});
} finally {
  try { report.cleanup = await closeOwned(app, f); assertCleanExit(report.cleanup, logs, 'Pi transfer GUI'); }
  catch (error) { report.cleanupError = String(error); process.exitCode = 1; }
  await model.close();
  await writeFile(join(f.output, 'pi-session-transfer-gui-report.json'), JSON.stringify(report, null, 2));
  await writeFile(join(f.output, 'pi-session-transfer-gui.log'), logs.join(''));
  console.log(JSON.stringify(report, null, 2));
}
