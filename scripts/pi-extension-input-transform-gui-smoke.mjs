// Native GUI -> Host -> pinned Pi input event; two sessions, reload and images.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixture } from './native-smoke/fixture.mjs';
import { assertCleanExit, closeOwned } from './native-smoke/cleanup.mjs';
import { image, unsentImage } from './native-smoke/pi-image.mjs';
import { startPiModel } from './native-smoke/pi-model.mjs';
import { configurePiProfile, isolatePiPackage, verifyPiPackageCleanup } from './native-smoke/pi-package.mjs';

const f = await fixture();
await isolatePiPackage(f);
const model = await startPiModel();
await configurePiProfile(f, { url: model.url, modelId: 'pi-native-test', apiKey: 'fixture-not-a-secret' });
const extensionDir = join(f.env.PI_CODING_AGENT_DIR, 'extensions');
await mkdir(extensionDir, { recursive: true });
const sample = await readFile(fileURLToPath(new URL('../examples/pi-gui-compat/extension.ts', import.meta.url)), 'utf8');
await writeFile(join(extensionDir, 'pi-gui-compat.ts'), sample
  .replace('"@earendil-works/pi-ai"', JSON.stringify(import.meta.resolve('@earendil-works/pi-ai')))
  .replace('"@earendil-works/pi-tui"', JSON.stringify(import.meta.resolve('@earendil-works/pi-tui'))));
const report = { at: new Date().toISOString(), piVersion: '0.87.0', pageErrors: [],
  inference: 'isolated deterministic loopback provider; no online provider' };
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
    if (await button.isVisible()) { await button.click(); await page.waitForTimeout(1600); }
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
  const send = async (text, bytes) => {
    await composer.click();
    await page.keyboard.type(text);
    if (bytes) {
      await page.locator('.chat-composer-region input[type="file"]').first()
        .setInputFiles({ name: `${text.includes('first') ? 'first' : 'second'}.png`,
          mimeType: 'image/png', buffer: bytes });
      await page.locator('[data-composer-attachment-kind="image"][data-upload-status="ready"]').first().waitFor();
    }
    await page.getByTestId('v4-composer-send').filter({ visible: true }).first().click();
  };
  await send('PI_GUI_INPUT_HANDLED');
  await page.getByText('PI_GUI_INPUT_HANDLED_BY_EXTENSION', { exact: true }).first().waitFor({ timeout: 25_000 });
  assert.equal(model.requests.length, 0, 'handled input must not call the model');
  await page.waitForFunction(() => document.querySelector('[data-testid="v4-composer-input"]')
    ?.getAttribute('contenteditable') === 'true');
  const firstSessionId = await page.locator('[data-testid^="v4-session-pane"]').filter({ visible: true }).first()
    .getAttribute('data-session-id');
  assert(firstSessionId);
  await send('PI_GUI_INPUT_TRANSFORM first session', image);
  await page.getByText('PI_IMAGE_COMPLETE', { exact: true }).last().waitFor({ timeout: 30_000 });
  await page.getByText('PI_IMAGE transformed by Pi GUI compatibility extension: first session',
    { exact: false }).first().waitFor();
  const digest = bytes => createHash('sha256').update(bytes).digest('hex');
  assert.equal(model.requests[0]?.imageDigests?.[0], digest(image));
  assert.deepEqual(model.requests[0]?.imageMimeTypes, ['image/png']);
  await page.screenshot({ path: join(f.output, 'pi-input-transformed-first.png') });

  await page.getByTestId('pi-tree-open').click();
  const tree = page.getByTestId('pi-tree-dialog');
  await tree.waitFor();
  const generation = await tree.getAttribute('data-generation');
  assert(generation);
  await tree.getByRole('button', { name: '重载扩展' }).click();
  await page.waitForFunction(previous => document.querySelector('[data-testid="pi-tree-dialog"]')
    ?.getAttribute('data-generation') !== previous, generation, { timeout: 20_000 });
  await page.keyboard.press('Escape');
  const countBeforeReloadHandled = model.requests.length;
  await send('PI_GUI_INPUT_HANDLED');
  await page.waitForTimeout(500);
  assert.equal(model.requests.length, countBeforeReloadHandled);
  assert(await composer.isEnabled());

  await page.getByText('新建任务', { exact: true }).first().click();
  await send('PI_GUI_INPUT_HANDLED');
  await page.getByText('PI_GUI_INPUT_HANDLED_BY_EXTENSION', { exact: true }).first().waitFor();
  assert.equal(model.requests.length, 1, 'second session handled input must not call the model');
  const secondSessionId = await page.locator('[data-testid^="v4-session-pane"]').filter({ visible: true }).first()
    .getAttribute('data-session-id');
  assert(secondSessionId && secondSessionId !== firstSessionId);
  await send('PI_GUI_INPUT_TRANSFORM second session', unsentImage);
  await page.getByText('PI_IMAGE_COMPLETE', { exact: true }).last().waitFor({ timeout: 30_000 });
  assert.equal(model.requests[1]?.imageDigests?.[0], digest(unsentImage));
  assert.deepEqual(model.requests[1]?.imageMimeTypes, ['image/png']);
  const files = (await readdir(f.env.PI_CODING_AGENT_DIR, { recursive: true })).filter(file => file.endsWith('.jsonl'));
  const histories = await Promise.all(files.map(async file => ({ file,
    text: await readFile(join(f.env.PI_CODING_AGENT_DIR, file), 'utf8') })));
  const first = histories.find(item => item.text.includes('first session') && item.text.includes(image.toString('base64')));
  const second = histories.find(item => item.text.includes('second session') &&
    item.text.includes(unsentImage.toString('base64')));
  assert(first && second && first.file !== second.file, 'two Pi sessions must own separate original image histories');
  await page.screenshot({ path: join(f.output, 'pi-input-transformed-second.png') });
  await send('PI_STOP: hold for handled queue');
  for (let attempt = 0; attempt < 100 && model.held === 0; attempt++) {
    await page.waitForTimeout(100);
  }
  assert(model.held > 0, 'Pi must be running before the GUI chooses follow-up delivery');
  const handledBefore = model.requests.length;
  await send('PI_GUI_INPUT_HANDLED_IMAGE', image);
  await page.getByText('Pi 扩展已立即处理这条输入，没有加入队列。', { exact: true })
    .waitFor({ timeout: 20_000 });
  await page.getByText(`PI_GUI_INPUT_HANDLED_IMAGE:image/png:${digest(image)}`, { exact: true })
    .waitFor({ timeout: 20_000 });
  await page.waitForFunction(() => !document.querySelector('[data-testid="v4-queue"]'));
  assert.equal((await composer.innerText()).trim(), '', 'handled input must not remain a retryable draft');
  assert.equal(await page.locator('[data-composer-attachment-kind="image"]').count(), 0,
    'the exact image was delivered to Pi handler before the composer clears it');
  assert.equal(model.requests.length, handledBefore, 'handled follow-up starts no second model request');
  await page.getByRole('button', { name: '停止生成', exact: true }).click();
  await send('after handled queue admission');
  await page.getByText('PI_TEXT_COMPLETE', { exact: true }).last().waitFor({ timeout: 30_000 });
  assert.equal(model.requests.length, handledBefore + 1,
    'the same Pi session accepts one next model run after handled queue input');
  report.immediateHandledQueue = { originalImageDigest: digest(image), queueItems: 0,
    additionalModelRunsBeforeNextPrompt: 0, nextPromptRuns: 1 };
  await page.screenshot({ path: join(f.output, 'pi-input-handled-queue-image.png') });
  report.input = { handledNoModel: true, transformedTextVisible: true, originalImageBytesInPiJsonl: true,
    modelImageDigests: [model.requests[0]?.imageDigests?.[0], model.requests[1]?.imageDigests?.[0]],
    reloadGenerationChanged: true, firstSessionId, secondSessionId, separateJsonl: true };
  await verifyPiPackageCleanup(f);
  assert.deepEqual(report.pageErrors, []);
  report.ok = true;
} catch (error) {
  report.error = error.stack || String(error);
  process.exitCode = 1;
  console.error(error);
  const page = app?.windows()[0];
  report.body = (await page?.locator('body').innerText().catch(() => ''))?.slice(-7000);
  await page?.screenshot({ path: join(f.output, 'pi-input-transform-failure.png') }).catch(() => {});
} finally {
  report.modelRequests = model.requests;
  try { report.cleanup = await closeOwned(app, f); assertCleanExit(report.cleanup, logs, 'Pi input transform GUI'); }
  catch (error) { report.cleanupError = String(error); process.exitCode = 1; }
  await model.close();
  await writeFile(join(f.output, 'pi-extension-input-transform-gui-report.json'), JSON.stringify(report, null, 2));
  await writeFile(join(f.output, 'pi-extension-input-transform-gui.log'), logs.join(''));
  console.log(JSON.stringify(report, null, 2));
}
