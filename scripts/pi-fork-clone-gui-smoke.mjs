// Native production renderer -> Host -> pinned Pi 0.87.0 entry fork/clone.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixture } from './native-smoke/fixture.mjs';
import { closeOwned, assertCleanExit } from './native-smoke/cleanup.mjs';
import { startPiModel } from './native-smoke/pi-model.mjs';
import { configurePiProfile, isolatePiPackage, verifyPiPackageCleanup } from './native-smoke/pi-package.mjs';
import { image } from './native-smoke/pi-image.mjs';

const f = await fixture();
await isolatePiPackage(f);
const model = await startPiModel();
await configurePiProfile(f, { url: model.url, modelId: 'pi-native-test', apiKey: 'fixture-not-a-secret' });
const report = { at: new Date().toISOString(), piVersion: '0.87.0', workspace: f.workspace,
  inference: 'deterministic loopback provider, not an online provider', pageErrors: [] };
const logs = [];
const jsonls = async () => {
  const root = join(f.sandbox, 'pi-profile', 'sessions');
  const found = [];
  const visit = async path => {
    for (const entry of await readdir(path, { withFileTypes: true }).catch(() => [])) {
      const target = join(path, entry.name);
      if (entry.isDirectory()) await visit(target);
      else if (entry.isFile() && entry.name.endsWith('.jsonl')) found.push(target);
    }
  };
  await visit(root);
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
  await page.getByRole('menuitem', { name: '新供应商', exact: true }).press('ArrowRight');
  await page.getByText('pi-native-test', { exact: true }).click();
  await page.keyboard.press('Escape');
  const composer = page.getByTestId('v4-composer-input').filter({ visible: true }).first();
  const send = async prompt => {
    await composer.click();
    await page.keyboard.type(prompt);
    await page.getByTestId('v4-composer-send').filter({ visible: true }).first().click();
  };
  await send('PI_READ: first branch turn');
  await page.getByText('PI_READ_COMPLETE', { exact: true }).waitFor({ timeout: 30_000 });
  await send('PI_TEXT: second branch turn');
  model.releaseText();
  await page.getByText('PI_TEXT_COMPLETE', { exact: true }).waitFor({ timeout: 30_000 });
  const beforeFiles = await jsonls();
  const sourceFile = (await Promise.all(beforeFiles.map(async path => ({ path, text: await readFile(path, 'utf8') }))))
    .find(item => item.text.includes('PI_TEXT: second branch turn'));
  assert(sourceFile, 'Pi must persist the source conversation before fork');
  await page.getByTestId('pi-tree-open').click();
  const dialog = page.getByTestId('pi-tree-dialog');
  await dialog.getByRole('treeitem').filter({ hasText: 'user: PI_TEXT: second branch turn' }).first().click();
  await page.screenshot({ path: join(f.output, 'pi-fork-source-tree.png') });
  await dialog.getByTestId('pi-tree-fork').click();
  await dialog.waitFor({ state: 'hidden', timeout: 30_000 });
  await composer.filter({ hasText: 'PI_TEXT: second branch turn' }).waitFor({ timeout: 20_000 });
  assert.equal(await readFile(sourceFile.path, 'utf8'), sourceFile.text);
  const forkFiles = await jsonls();
  const forkFile = forkFiles.find(path => !beforeFiles.includes(path));
  assert(forkFile, 'Pi fork must create a second JSONL');
  const forkText = await readFile(forkFile, 'utf8');
  assert(forkText.includes('PI_READ: first branch turn') && !forkText.includes('PI_TEXT: second branch turn'));
  report.fork = { sourcePreserved: true, childJsonl: forkFile,
    editorRestored: await composer.innerText(), childContainsEarlierTurn: true };
  await page.screenshot({ path: join(f.output, 'pi-fork-child-composer.png') });
  await composer.click(); await page.keyboard.press('ControlOrMeta+A'); await page.keyboard.press('Backspace');
  await page.getByTestId('pi-tree-open').click();
  const childTree = page.getByTestId('pi-tree-dialog');
  await childTree.getByRole('treeitem').filter({ hasText: 'user: PI_READ: first branch turn' }).first().waitFor();
  await childTree.getByTestId('pi-tree-clone').click();
  await childTree.waitFor({ state: 'hidden', timeout: 30_000 });
  const cloneFiles = await jsonls();
  const cloneFile = cloneFiles.find(path => !forkFiles.includes(path));
  assert(cloneFile, 'Pi clone must create a third JSONL');
  assert.equal(await readFile(forkFile, 'utf8'), forkText, 'Pi clone must not rewrite fork parent');
  assert((await readFile(cloneFile, 'utf8')).includes('PI_READ: first branch turn'));
  report.clone = { parentPreserved: true, childJsonl: cloneFile, childContainsEarlierTurn: true };
  await page.screenshot({ path: join(f.output, 'pi-clone-child.png') });
  const imagePrompt = 'PI_IMAGE: historical image branch';
  await composer.click();
  await page.keyboard.type(imagePrompt);
  await page.locator('.chat-composer-region input[type="file"]').first()
    .setInputFiles({ name: 'fork-source.png', mimeType: 'image/png', buffer: image });
  await page.locator('[data-composer-attachment-kind="image"][data-upload-status="ready"]')
    .filter({ visible: true }).first().waitFor({ timeout: 20_000 });
  await page.getByTestId('v4-composer-send').filter({ visible: true }).first().click();
  await page.getByText('PI_IMAGE_COMPLETE', { exact: true }).waitFor({ timeout: 30_000 });
  const imageDigest = createHash('sha256').update(image).digest('hex');
  assert(model.requests.some(request => request.scenario === 'PI_IMAGE' &&
    request.imageDigests.includes(imageDigest)), 'source image must reach the fixed Pi provider');
  const imageSourceJsonl = await readFile(cloneFile);
  await page.getByTestId('pi-tree-open').click();
  const imageTree = page.getByTestId('pi-tree-dialog');
  await imageTree.getByRole('treeitem').filter({ hasText: `user: ${imagePrompt}` }).first().click();
  await imageTree.getByTestId('pi-tree-fork').click();
  await imageTree.waitFor({ state: 'hidden', timeout: 30_000 });
  await composer.filter({ hasText: imagePrompt }).waitFor({ timeout: 20_000 });
  const imageChip = page.locator('[data-composer-attachment-kind="image"][data-upload-status="ready"]')
    .filter({ visible: true }).first();
  await imageChip.waitFor({ timeout: 20_000 });
  assert(await imageChip.locator('img').evaluate(img => img.complete && img.naturalWidth > 0),
    'forked image draft must decode in the native composer');
  assert.deepEqual(await readFile(cloneFile), imageSourceJsonl, 'image fork cannot rewrite source Pi JSONL');
  const imageForkFiles = await jsonls();
  const imageChildFile = imageForkFiles.find(path => !cloneFiles.includes(path));
  assert(imageChildFile, 'image fork must create a distinct Pi child JSONL');
  const imageChildId = JSON.parse((await readFile(imageChildFile, 'utf8')).split('\n')[0]).id;
  report.imageFork = { sourcePreserved: true, childJsonl: imageChildFile, textRestored: await composer.innerText(),
    imageReady: true, sourceRequestDigest: imageDigest };
  await page.screenshot({ path: join(f.output, 'pi-image-fork-child-composer.png') });
  const requestsBeforeRestart = model.requests.length;
  report.firstCleanup = await closeOwned(app, f);
  assertCleanExit(report.firstCleanup, logs, 'Pi image fork first GUI exit');
  app = await f.playwright._electron.launch({ executablePath: f.electronPath,
    args: [fileURLToPath(new URL('./native-smoke/bootstrap.cjs', import.meta.url)), '--lang=zh-CN'],
    cwd: f.root, env: f.env, timeout: 60_000 });
  app.process().stdout?.on('data', chunk => logs.push(String(chunk)));
  app.process().stderr?.on('data', chunk => logs.push(String(chunk)));
  const reopenedPage = await app.firstWindow();
  reopenedPage.setDefaultTimeout(15_000);
  reopenedPage.on('pageerror', error => report.pageErrors.push(error.stack || error.message));
  await reopenedPage.waitForTimeout(5000);
  for (const name of [/^(使用 API key|Use API key)$/, /^(暂时跳过|Skip for now)$/, /^(退出引导|Exit onboarding)$/]) {
    const button = reopenedPage.getByRole('button', { name, exact: true });
    if (await button.isVisible()) { await button.click(); await reopenedPage.waitForTimeout(1200); }
  }
  await reopenedPage.getByTestId(`task-item-${imageChildId}`).click();
  const reopenedComposer = reopenedPage.getByTestId('v4-composer-input').filter({ visible: true }).first();
  await reopenedComposer.filter({ hasText: imagePrompt }).waitFor({ timeout: 25_000 });
  const reopenedChip = reopenedPage.locator('[data-composer-attachment-kind="image"][data-upload-status="ready"]')
    .filter({ visible: true }).first();
  await reopenedChip.waitFor({ timeout: 25_000 });
  assert(await reopenedChip.locator('img').evaluate(img => img.complete && img.naturalWidth > 0),
    'forked image draft must decode after full app restart');
  assert.equal(model.requests.length, requestsBeforeRestart, 'restoring a fork draft must not auto-send');
  await reopenedPage.screenshot({ path: join(f.output, 'pi-image-fork-restored-after-restart.png') });
  await reopenedPage.getByTestId('v4-composer-send').filter({ visible: true }).first().click();
  await reopenedPage.getByText('PI_IMAGE_COMPLETE', { exact: true }).waitFor({ timeout: 30_000 });
  const resumedRequest = model.requests.slice(requestsBeforeRestart).find(request => request.scenario === 'PI_IMAGE' &&
    request.imageDigests.includes(imageDigest));
  assert(resumedRequest, 'sending the restored child draft must deliver original image bytes to fixed Pi');
  report.imageFork.restoredAfterRestart = true;
  report.imageFork.sentOriginalBytesAfterRestart = true;
  await verifyPiPackageCleanup(f);
  assert.deepEqual(report.pageErrors, []);
} catch (error) {
  report.error = error.stack || String(error);
  report.body = (await app?.windows()[0]?.locator('body').innerText().catch(() => ''))?.slice(-7000);
  process.exitCode = 1;
  console.error(error);
  await app?.windows()[0]?.screenshot({ path: join(f.output, 'pi-fork-clone-failure.png') }).catch(() => {});
} finally {
  try { report.cleanup = await closeOwned(app, f); assertCleanExit(report.cleanup, logs, 'Pi fork/clone GUI'); }
  catch (error) { report.cleanupError = String(error); process.exitCode = 1; }
  await model.close();
  await writeFile(join(f.output, 'pi-fork-clone-gui-report.json'), JSON.stringify(report, null, 2));
  await writeFile(join(f.output, 'pi-fork-clone-gui.log'), logs.join(''));
  console.log(JSON.stringify(report, null, 2));
}
