// Focused production-entry GUI proof for Issue #14: Pi file references and native previews.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixture } from './native-smoke/fixture.mjs';
import { assertCleanExit, closeOwned } from './native-smoke/cleanup.mjs';
import { startPiModel } from './native-smoke/pi-model.mjs';
import { image } from './native-smoke/pi-image.mjs';
import { configurePiProfile, isolatePiPackage, verifyPiPackageCleanup } from './native-smoke/pi-package.mjs';

const f = await fixture();
const textPath = join(f.workspace, '中文 空格.md');
const imagePath = join(f.workspace, '图 像.png');
const binaryPath = join(f.workspace, '未知.bin');
const largePath = join(f.workspace, '大文件.txt');
await writeFile(textPath, '# 中文预览\n\nPI14_MARKDOWN_PREVIEW\n', 'utf8');
await writeFile(imagePath, image);
await writeFile(binaryPath, Buffer.from([0, 1, 2, 3]));
await writeFile(largePath, 'x'.repeat(257 * 1024));
await isolatePiPackage(f);
const model = await startPiModel();
await configurePiProfile(f, { url: model.url, modelId: 'pi-native-test', apiKey: 'fixture-not-a-secret' });
const launchArgs = [fileURLToPath(new URL('./native-smoke/bootstrap.cjs', import.meta.url)), '--lang=zh-CN'];
const report = { at: new Date().toISOString(), workspace: f.workspace, pageErrors: [],
  modelBoundary: 'real pinned Pi 0.87.0 RPC + deterministic loopback Chat Completions model' };
const logs = [];
let app;

async function launch() {
  const application = await f.playwright._electron.launch({ executablePath: f.electronPath,
    args: launchArgs, cwd: f.root, env: f.env, timeout: 60_000 });
  app = application;
  application.process().stdout?.on('data', chunk => logs.push(String(chunk)));
  application.process().stderr?.on('data', chunk => logs.push(String(chunk)));
  const page = await application.firstWindow();
  page.setDefaultTimeout(15_000);
  page.on('pageerror', error => report.pageErrors.push(error.stack || error.message));
  await page.waitForTimeout(6000);
  for (const name of [/^(使用 API key|Use API key)$/, /^(暂时跳过|Skip for now)$/, /^(退出引导|Exit onboarding)$/]) {
    const button = page.getByRole('button', { name, exact: true });
    if (await button.isVisible()) { await button.click(); await page.waitForTimeout(1500); }
  }
  return page;
}

async function sessionJsonl() {
  const profile = f.env.PI_CODING_AGENT_DIR;
  const files = (await readdir(profile, { recursive: true })).filter(name => name.endsWith('.jsonl'));
  assert.equal(files.length, 1, 'The one GUI conversation must have one real Pi JSONL');
  return readFile(join(profile, files[0]), 'utf8');
}

async function chooseNativeProvider(page) {
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
}

async function openTreeFile(page, name) {
  if (!await page.getByTestId('workspace-file-tree-panel').isVisible()) {
    await page.getByText('parity-workspace', { exact: true }).first().hover();
    await page.locator('[data-testid^="workspace-file-tree-button"]').click();
  }
  await page.getByTestId('workspace-file-tree-panel').getByText(name, { exact: true }).first().dblclick();
  await page.locator('[data-side-pane-tab-id]').filter({ hasText: name }).waitFor();
}

try {
  let page = await launch();
  await page.getByRole('button', { name: '添加项目', exact: true }).click();
  await page.getByRole('menuitem', { name: '打开文件夹', exact: true }).click();
  await page.getByTestId('composer-workspace-trigger').filter({ hasText: 'parity-workspace' }).waitFor();
  await chooseNativeProvider(page);

  const input = page.getByTestId('v4-composer-input').filter({ visible: true }).first();
  await input.click();
  await page.keyboard.type('PI_FILE: 检查 @中文');
  const option = page.locator('[data-section-id="files"][data-option-id="file:中文 空格.md"]');
  await option.waitFor();
  await option.click();
  report.pickerText = await input.innerText();
  assert.match(report.pickerText, /中文 空格\.md/);
  await page.keyboard.type(' 和 [图 像.png](<./图 像.png>)');
  await page.screenshot({ path: join(f.output, 'pi-file-reference-draft.png') });
  await page.getByTestId('v4-composer-send').filter({ visible: true }).first().click();
  await page.getByText('PI_TEXT_COMPLETE', { exact: true }).waitFor({ timeout: 30_000 });
  const request = model.requests.find(item => item.scenario === 'other' && item.promptText.includes('PI14_MARKDOWN_PREVIEW'));
  assert(request, 'The deterministic model must receive text captured from the GUI file picker');
  assert(request.imageMimeTypes.includes('image/png'), 'Pinned Pi must deliver the referenced image as a real image part');
  assert(request.imageDigests.includes(createHash('sha256').update(image).digest('hex')),
    'Referenced image bytes must reach the model unchanged');
  report.pinnedPiRequest = { scenario: request.scenario, textCaptured: request.promptText.includes('PI14_MARKDOWN_PREVIEW'),
    imageMimeTypes: request.imageMimeTypes, imageDigests: request.imageDigests };
  const turn = page.locator('section[data-turn-id]').filter({ hasText: 'PI_FILE: 检查' }).first();
  report.collapsedSnapshot = await turn.getByRole('button', { name: '发送时固定的文件内容' }).isVisible();
  assert(report.collapsedSnapshot, 'Pi snapshot must be available in a collapsed disclosure');
  report.sessionTitle = await page.getByText(/^PI_FILE: 检查/u).first().innerText();
  assert(!report.sessionTitle.includes('Pi file snapshots'), 'Native session title must omit Pi file payload');
  assert(!await turn.getByText('PI14_MARKDOWN_PREVIEW', { exact: false }).isVisible(),
    'Captured file bytes must not flood the conversation row by default');
  await page.screenshot({ path: join(f.output, 'pi-file-reference-sent.png') });
  let jsonl = await sessionJsonl();
  assert(jsonl.includes('PI14_MARKDOWN_PREVIEW') && jsonl.includes(image.toString('base64')),
    'Fixed Pi JSONL must contain both captured text and the image bytes');
  await writeFile(textPath, '# Changed after send\n');
  await writeFile(imagePath, Buffer.from('changed after send'));
  jsonl = await sessionJsonl();
  assert(jsonl.includes('PI14_MARKDOWN_PREVIEW') && !jsonl.includes('Changed after send'),
    'A later workspace edit must not rewrite Pi history');
  report.persistedOriginalBytes = true;
  await writeFile(textPath, '# 中文预览\n\nPI14_MARKDOWN_PREVIEW\n', 'utf8');
  await writeFile(imagePath, image);

  const requestsBeforeMissing = model.requests.length;
  await input.click();
  await page.keyboard.type('PI_FILE: [不存在.md](./不存在.md)');
  await page.getByTestId('v4-composer-send').filter({ visible: true }).first().click();
  await page.getByText('引用文件不存在或已移动。草稿已保留，请重新选择后发送。', { exact: true }).waitFor();
  report.missingReferenceFeedback = true;
  await page.waitForFunction(() => document.querySelector('[data-testid="v4-composer-input"]')
    ?.textContent?.includes('不存在.md'), null, { timeout: 10_000 });
  report.missingReferenceDraftRetained = (await input.innerText()).includes('不存在.md');
  report.missingReferenceNotDelivered = model.requests.length === requestsBeforeMissing;
  assert(report.missingReferenceFeedback && report.missingReferenceDraftRetained && report.missingReferenceNotDelivered,
    'Missing reference must give visible feedback and retain the draft before Pi admission');
  await page.screenshot({ path: join(f.output, 'pi-file-missing-reference.png') });

  await openTreeFile(page, '中文 空格.md');
  await page.getByText('PI14_MARKDOWN_PREVIEW', { exact: true }).waitFor();
  report.markdownPreview = true;
  await page.screenshot({ path: join(f.output, 'pi-file-markdown-preview.png') });
  await openTreeFile(page, '图 像.png');
  const previewImage = page.locator('img[alt="图 像.png"]').filter({ visible: true }).last();
  await previewImage.waitFor();
  report.imagePreview = await previewImage.evaluate(node => node.complete && node.naturalWidth > 0);
  assert(report.imagePreview, 'Native image preview must decode the real workspace image');
  await page.screenshot({ path: join(f.output, 'pi-file-image-preview.png') });
  await openTreeFile(page, '未知.bin');
  await page.getByText('当前文件看起来像二进制内容，暂不支持代码预览。', { exact: true }).waitFor();
  report.binaryFeedback = true;
  await openTreeFile(page, '大文件.txt');
  await page.getByText('文件超过 256 KB 预览上限，请使用其他编辑器打开以查看完整内容。', { exact: true }).waitFor();
  report.largeFileFeedback = true;
  await page.screenshot({ path: join(f.output, 'pi-file-preview-limits.png') });

  report.firstCleanup = await closeOwned(app, f);
  assertCleanExit(report.firstCleanup, logs, 'First');
  app = null;
  page = await launch();
  if (await page.getByRole('button', { name: '添加项目', exact: true }).isVisible()) {
    await page.getByRole('button', { name: '添加项目', exact: true }).click();
    await page.getByRole('menuitem', { name: '打开文件夹', exact: true }).click();
  }
  const coldTitle = page.getByText(/^PI_FILE: 检查/u).first();
  report.coldSessionTitle = await coldTitle.innerText();
  assert(!report.coldSessionTitle.includes('Pi file snapshots'), 'Cold Pi session list must omit file payload');
  await coldTitle.click();
  await page.getByText('PI_TEXT_COMPLETE', { exact: true }).waitFor({ timeout: 30_000 });
  const restored = page.locator('section[data-turn-id]').filter({ hasText: 'PI_FILE: 检查' }).first();
  report.restoredCollapsedSnapshot = await restored.getByRole('button', { name: '发送时固定的文件内容' }).isVisible();
  assert(report.restoredCollapsedSnapshot, 'Restart must restore Pi snapshot disclosure from JSONL');
  await page.screenshot({ path: join(f.output, 'pi-file-reference-restored.png') });
  await verifyPiPackageCleanup(f);
  report.piPrivatePackageCleanupVerified = true;
  const boundaries = (await readFile(f.env.NATIVE_SMOKE_BOUNDARY_LOG, 'utf8')).split('\n').filter(Boolean).map(JSON.parse);
  report.filesystemBlocked = boundaries.filter(entry => entry.type === 'filesystem-blocked');
  assert.deepEqual(report.filesystemBlocked, []);
  assert.deepEqual(report.pageErrors, []);
  report.ok = true;
} catch (error) {
  report.error = error.stack || String(error);
  process.exitCode = 1;
  console.error(error);
  const page = app?.windows()[0];
  report.body = (await page?.locator('body').innerText().catch(() => ''))?.slice(-7000);
  await page?.screenshot({ path: join(f.output, 'pi-file-reference-failure.png') }).catch(() => {});
} finally {
  try { report.cleanup = await closeOwned(app, f); assertCleanExit(report.cleanup, logs, 'Final'); }
  catch (error) { report.cleanupError = String(error); process.exitCode = 1; }
  await model.close();
  await mkdir(f.output, { recursive: true });
  await writeFile(join(f.output, 'pi-file-reference-gui-report.json'), JSON.stringify(report, null, 2));
  await writeFile(join(f.output, 'pi-file-reference-gui.log'), logs.join(''));
  console.log(JSON.stringify(report, null, 2));
}
