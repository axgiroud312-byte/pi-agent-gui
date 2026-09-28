/* oxlint-disable eslint(max-lines) -- One production-entry GUI lifecycle proves queue ownership and restart recovery. */
// Issue #4: native renderer -> Host -> pinned Pi 0.87.0. Run alone after desktop build.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixture } from './native-smoke/fixture.mjs';
import { assertCleanExit, closeOwned } from './native-smoke/cleanup.mjs';
import { image, unsentImage } from './native-smoke/pi-image.mjs';
import { startPiModel } from './native-smoke/pi-model.mjs';
import { configurePiProfile, isolatePiPackage, verifyPiPackageCleanup } from './native-smoke/pi-package.mjs';
import { drag } from './native-smoke/panels.mjs';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const composer = page => page.getByTestId('v4-composer-input').filter({ visible: true }).first();
const sendButton = page => page.getByTestId('v4-composer-send').filter({ visible: true }).first();
const queue = page => page.getByTestId('v4-queue');
const rows = page => queue(page).locator('li[data-queue-item-id]');
const row = (page, id) => queue(page).locator(`li[data-queue-item-id="${id}"]`);
const editRecovery = page => page.getByTestId('pi-queue-edit-recovery');
async function editRecoveryEntries(page) {
  return page.evaluate(() => Object.keys(window.localStorage)
    .filter(key => key.startsWith('zcode-v4-pi-queue-edit-recovery:v2:'))
    .map(key => JSON.parse(window.localStorage.getItem(key))));
}

async function until(check, message, attempts = 100) {
  for (let index = 0; index < attempts; index++) {
    const result = await check();
    if (result) return result;
    await sleep(150);
  }
  throw new Error(message);
}

async function queueCount(page, count) {
  await page.waitForFunction(expected => {
    const actual = document.querySelector('[data-testid="v4-queue"]');
    return expected === 0 ? actual === null : actual?.getAttribute('data-queue-count') === String(expected);
  }, count, { timeout: 20_000 });
}

async function bookmark(f) {
  const directory = join(f.home, '.zcode', 'v2', 'pi-sessions');
  const files = (await readdir(directory)).filter(name => name.endsWith('.json'));
  assert.equal(files.length, 1, 'The GUI must have one real Pi session bookmark');
  return JSON.parse(await readFile(join(directory, files[0]), 'utf8'));
}

async function recovery(f, count) {
  return until(async () => {
    try {
      const current = await bookmark(f);
      return current.queueRecovery?.length === count ? current.queueRecovery : null;
    } catch { return null; }
  }, `Pi-owned queue readback did not persist ${count} recovery references`);
}

async function assertMedia(entry, expectedBytes) {
  assert.equal(entry.attachments.length, 1, 'Queue item must retain one image attachment');
  const actual = await readFile(entry.attachments[0].ref);
  assert.equal(digest(actual), digest(expectedBytes), 'Recovery media must preserve the exact selected bytes');
  assert.equal(entry.attachments[0].mime, 'image/png');
}

async function send(page, text, bytes) {
  const input = composer(page);
  await input.click();
  await page.keyboard.type(text);
  if (bytes) {
    await page.locator('.chat-composer-region input[type="file"]').first()
      .setInputFiles({ name: 'queue-smoke.png', mimeType: 'image/png', buffer: bytes });
    await page.locator('[data-composer-attachment-kind="image"][data-upload-status="ready"]')
      .filter({ visible: true }).first().waitFor();
  }
  await sendButton(page).click();
}

async function setInteractionBehavior(page, option) {
  await page.getByTestId('sidebar').getByTestId('task-settings-button').click();
  await page.getByTestId('settings-section-nav-general').click();
  await page.getByText('交互行为', { exact: true }).locator('xpath=../..').getByRole('combobox').click();
  await page.getByRole('option', { name: option, exact: true }).click();
  await page.getByTestId('settings-back-button').click();
  await page.getByTestId('settings-page').waitFor({ state: 'hidden' });
}

async function openNative(f, logs, report) {
  const app = await f.playwright._electron.launch({ executablePath: f.electronPath,
    args: [fileURLToPath(new URL('./native-smoke/bootstrap.cjs', import.meta.url)), '--lang=zh-CN'],
    cwd: f.root, env: f.env, timeout: 60_000 });
  try {
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
    if (await page.getByRole('button', { name: '添加项目', exact: true }).isVisible()) {
      await page.getByRole('button', { name: '添加项目', exact: true }).click();
      await page.getByRole('menuitem', { name: '打开文件夹', exact: true }).click();
    }
    await composer(page).waitFor();
    assert.match(page.url(), /^file:/, 'Use the packaged production renderer entry, not Vite dev server');
    return { app, page };
  } catch (error) {
    // openNative can fail before returning app to the caller. The launch still
    // belongs to this fixture and must be closed before a second GUI run.
    try { report.startupCleanup = await closeOwned(app, f); }
    catch (cleanupError) {
      report.startupCleanupError = String(cleanupError);
      await app.close().catch(() => {});
    }
    throw error;
  }
}

async function selectControlledModel(page, f, model) {
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
  assert(JSON.stringify(JSON.parse(await readFile(join(f.home, '.zcode', 'v2', 'provider_config.json'), 'utf8')))
    .includes('new-provider'), 'Native UI and Pi profile must select the same controlled provider');
  await page.getByTestId('settings-back-button').click();
  await page.getByTestId('settings-page').waitFor({ state: 'hidden' });
  await page.getByTestId('chat-model-select-trigger').click();
  await page.getByTestId('chat-model-select-search').fill('pi-native-test');
  await page.getByRole('menuitemradio', { name: /pi-native-test/ }).first().click();
}

const f = await fixture();
await isolatePiPackage(f);
const model = await startPiModel();
await configurePiProfile(f, { url: model.url, modelId: 'pi-native-test', apiKey: 'fixture-not-a-secret' });
const logs = [];
const report = { at: new Date().toISOString(), piVersion: '0.87.0',
  boundary: 'native production renderer -> Host -> pinned Pi RPC -> deterministic loopback provider',
  onlineProvider: 'not tested', pageErrors: [], sandbox: f.sandbox, stages: {} };
let app;
try {
  let page;
  ({ app, page } = await openNative(f, logs, report));
  await selectControlledModel(page, f, model);
  await send(page, 'PI_STOP: hold first foreground turn');
  await until(() => model.held > 0, 'Pinned Pi must have an active provider stream');
  await page.getByRole('button', { name: '停止生成', exact: true }).waitFor({ state: 'visible' });

  const duplicate = 'PI_IMAGE: duplicate queued input';
  await send(page, duplicate, image);
  await queueCount(page, 1);
  const first = (await recovery(f, 1))[0];
  assert.equal(first.lane, 'followUp');
  await assertMedia(first, image);
  await send(page, duplicate, unsentImage);
  await queueCount(page, 2);
  let stored = await recovery(f, 2);
  const second = stored.find(item => item.id !== first.id);
  assert(second && second.lane === 'followUp');
  await assertMedia(second, unsentImage);
  assert.equal(await queue(page).getAttribute('data-queue-read-only'), 'false');
  assert.deepEqual(await rows(page).evaluateAll(items => items.map(item => item.dataset.queueItemId)),
    [first.id, second.id], 'Native queue rows must use stable pinned Pi item identities');
  await page.screenshot({ path: join(f.output, 'pi-queue-two-images.png') });
  report.stages.duplicateTextDistinctImages = [first.id, second.id];

  const firstHandle = row(page, first.id).locator('[data-v4-queue-drag-handle]');
  const secondHandle = row(page, second.id).locator('[data-v4-queue-drag-handle]');
  const firstBox = await firstHandle.boundingBox(), secondBox = await secondHandle.boundingBox();
  assert(firstBox && secondBox, 'Both Pi queue drag handles must be visible');
  await drag(page, secondHandle, 0, firstBox.y - secondBox.y - 8);
  stored = await until(async () => {
    const value = await recovery(f, 2);
    return value[0].id === second.id ? value : null;
  }, 'Drag must reorder the authoritative Pi follow-up lane');
  assert.deepEqual(stored.map(item => item.id), [second.id, first.id]);
  report.stages.followUpReordered = stored.map(item => item.id);

  await page.getByTestId(`v4-queue-item-edit-${first.id}`).click();
  await until(async () => (await composer(page).innerText()).includes(duplicate),
    'Pi take ACK must restore queued text into the native composer');
  await page.locator('[data-composer-attachment-kind="image"][data-upload-status="ready"]')
    .filter({ visible: true }).first().waitFor();
  await queueCount(page, 1);
  assert.deepEqual((await recovery(f, 1)).map(item => item.id), [second.id]);
  const restoredImage = page.locator('[data-composer-attachment-kind="image"] img').filter({ visible: true }).first();
  assert(await restoredImage.evaluate(img => img.complete && img.naturalWidth > 0),
    'Native editor must decode the queued image recovered from Pi readback');
  await page.screenshot({ path: join(f.output, 'pi-queue-image-taken-for-edit.png') });
  await composer(page).click();
  await composer(page).press('ControlOrMeta+A');
  await composer(page).press('Backspace');
  await page.keyboard.type('PI_IMAGE: edited queued input');
  await sendButton(page).click();
  await queueCount(page, 2);
  stored = await recovery(f, 2);
  const edited = stored.find(item => item.text === 'PI_IMAGE: edited queued input');
  assert(edited && edited.id !== first.id && edited.lane === 'followUp');
  await assertMedia(edited, image);
  report.stages.editRetainedImage = edited.id;

  await setInteractionBehavior(page, '引导');
  await send(page, 'PI_IMAGE: steering queued input', image);
  await queueCount(page, 3);
  await page.locator('[data-v4-pending-guide-list="true"]')
    .filter({ hasText: 'PI_IMAGE: steering queued input' }).waitFor();
  stored = await recovery(f, 3);
  const steer = stored.find(item => item.text === 'PI_IMAGE: steering queued input');
  assert(steer && steer.lane === 'steering', 'GUI guide mode must enter the real Pi steering lane');
  await assertMedia(steer, image);
  assert.equal(await row(page, steer.id).getAttribute('data-queue-lane'), 'guide');
  assert(await page.getByTestId(`v4-queue-item-edit-${steer.id}`).isVisible());
  assert(await page.getByTestId(`v4-queue-item-send-now-${steer.id}`).isVisible());
  assert.deepEqual(stored.map(item => item.id), [steer.id, second.id, edited.id]);
  await page.screenshot({ path: join(f.output, 'pi-queue-steering-follow-up.png') });

  await page.getByTestId(`v4-queue-item-edit-${steer.id}`).click();
  await until(async () => (await composer(page).innerText()).includes('PI_IMAGE: steering queued input'),
    'The pinned Pi steering item must be taken back into the composer');
  await page.locator('[data-composer-attachment-kind="image"][data-upload-status="ready"]')
    .filter({ visible: true }).first().waitFor();
  await queueCount(page, 2);
  assert.deepEqual((await recovery(f, 2)).map(item => item.id), [second.id, edited.id]);
  await composer(page).click();
  await composer(page).press('ControlOrMeta+A');
  await composer(page).press('Backspace');
  await page.keyboard.type('PI_IMAGE: edited steering input');
  await sendButton(page).click();
  await queueCount(page, 3);
  stored = await recovery(f, 3);
  const editedSteer = stored.find(item => item.text === 'PI_IMAGE: edited steering input');
  assert(editedSteer && editedSteer.lane === 'steering' && editedSteer.id !== steer.id);
  await assertMedia(editedSteer, image);
  report.stages.steeringEditRetainedImage = editedSteer.id;

  await send(page, 'PI_IMAGE: second steering input', unsentImage);
  await queueCount(page, 4);
  stored = await recovery(f, 4);
  const secondSteer = stored.find(item => item.text === 'PI_IMAGE: second steering input');
  assert(secondSteer && secondSteer.lane === 'steering');
  await assertMedia(secondSteer, unsentImage);
  const earlierHandle = row(page, editedSteer.id).locator('[data-v4-queue-drag-handle]');
  const laterHandle = row(page, secondSteer.id).locator('[data-v4-queue-drag-handle]');
  const earlierBox = await earlierHandle.boundingBox(), laterBox = await laterHandle.boundingBox();
  assert(earlierBox && laterBox, 'Both Pi steering drag handles must be visible');
  await drag(page, laterHandle, 0, earlierBox.y - laterBox.y - 8);
  stored = await until(async () => {
    const value = await recovery(f, 4);
    return value[0].id === secondSteer.id ? value : null;
  }, 'Drag must reorder the authoritative Pi steering lane');
  assert.deepEqual(stored.map(item => item.id), [secondSteer.id, editedSteer.id, second.id, edited.id]);
  report.stages.doubleLane = stored.map(item => ({ id: item.id, lane: item.lane }));
  await page.screenshot({ path: join(f.output, 'pi-queue-both-lanes-reordered.png') });

  await page.getByRole('button', { name: '停止生成', exact: true }).click();
  await page.getByRole('button', { name: '停止生成', exact: true }).waitFor({ state: 'hidden', timeout: 30_000 });
  await until(() => model.held === 0, 'Stop must close the real Pi provider stream');
  await queueCount(page, 4);
  assert.equal(await queue(page).getAttribute('data-queue-auto-drain'), 'false');
  await page.getByTestId('v4-queue-paused-banner').waitFor();
  report.stages.stopPreserved = (await recovery(f, 4)).map(item => item.id);
  await page.screenshot({ path: join(f.output, 'pi-queue-stopped-preserved.png') });

  const requestsBeforePromotion = model.requests.length;
  await page.getByTestId(`v4-queue-item-send-now-${secondSteer.id}`).click();
  await until(() => model.requests.length > requestsBeforePromotion,
    'Send now must dispatch the selected Pi item to the controlled provider');
  await queueCount(page, 3);
  assert(model.requests.slice(requestsBeforePromotion).some(request =>
    request.promptText.includes('PI_IMAGE: second steering input') &&
      request.imageDigests.includes(digest(unsentImage))),
  'Send now must deliver the selected text and exact image bytes through pinned Pi');
  assert.deepEqual((await recovery(f, 3)).map(item => item.id), [editedSteer.id, second.id, edited.id]);
  report.stages.sendNow = secondSteer.id;
  await page.screenshot({ path: join(f.output, 'pi-queue-send-now.png') });

  const requestsBeforeResume = model.requests.length;
  await page.getByTestId('v4-queue-resume').click();
  await queueCount(page, 0);
  await until(() => model.requests.slice(requestsBeforeResume).some(request =>
    request.promptText.includes('PI_IMAGE: edited steering input') && request.imageDigests.includes(digest(image))) &&
    model.requests.slice(requestsBeforeResume).some(request =>
      request.promptText.includes(duplicate) && request.imageDigests.includes(digest(unsentImage))) &&
    model.requests.slice(requestsBeforeResume).some(request =>
      request.promptText.includes('PI_IMAGE: edited queued input') && request.imageDigests.includes(digest(image))),
  'Resume must drain Pi steering and follow-up lanes with exact image bytes');
  await page.getByRole('button', { name: '停止生成', exact: true }).waitFor({ state: 'hidden', timeout: 30_000 });
  report.stages.resumeDrained = [editedSteer.id, second.id, edited.id];
  await page.screenshot({ path: join(f.output, 'pi-queue-resumed.png') });

  await setInteractionBehavior(page, '队列');
  await send(page, 'PI_STOP: hold recovery turn');
  await until(() => model.held > 0, 'Second Pi stream must be active before queue recovery test');
  await send(page, 'PI_IMAGE: queued before app restart', unsentImage);
  await queueCount(page, 1);
  const pending = (await recovery(f, 1))[0];
  await assertMedia(pending, unsentImage);
  await page.getByRole('button', { name: '停止生成', exact: true }).click();
  await page.getByTestId('v4-queue-paused-banner').waitFor();
  assert.equal(await queue(page).getAttribute('data-queue-auto-drain'), 'false');
  const requestsBeforeRestart = model.requests.length;
  report.firstCleanup = await closeOwned(app, f);
  assertCleanExit(report.firstCleanup, logs, 'Queue recovery restart');
  app = undefined;

  ({ app, page } = await openNative(f, logs, report));
  const initialTurn = page.locator('section[data-turn-id]')
    .filter({ hasText: 'PI_STOP: hold first foreground turn' }).first();
  if (!await initialTurn.isVisible()) {
    await page.locator('[data-testid^="task-item-"]')
      .filter({ hasText: 'PI_STOP: hold first foreground turn' }).first().click();
  }
  await initialTurn.waitFor({ timeout: 30_000 });
  await queueCount(page, 0);
  assert.equal(model.requests.length, requestsBeforeRestart, 'Restart must never replay queued input');
  const restored = await bookmark(f);
  const lostRuntimeQueue = restored.interruptedQueueRecovery?.find(item => item.id === pending.id);
  assert(lostRuntimeQueue, 'App must preserve a recovery copy when Pi loses its in-memory queue on restart');
  await assertMedia(lostRuntimeQueue, unsentImage);
  const body = await page.locator('body').innerText();
  report.stages.restart = { noReplay: true, runtimeQueueEmpty: true, recoveryId: pending.id,
    recoveryNoticeVisible: body.includes('previously queued Pi inputs survived as recovery copies') };
  assert(report.stages.restart.recoveryNoticeVisible,
    'Native GUI must explain that recovered media is evidence, not an executable Pi queue');
  await page.screenshot({ path: join(f.output, 'pi-queue-recovery-after-restart.png') });

  // A deleted queued image must also survive a restart as a composer recovery
  // copy. Pi's queue stays the only executable queue throughout this path.
  const heldBeforeWithdrawal = model.held;
  await send(page, 'PI_STOP: hold withdrawal recovery turn');
  await until(() => model.held > heldBeforeWithdrawal,
    'Pinned Pi must be running before the image withdrawal');
  const withdrawalText = 'PI_IMAGE: withdrawn across app restart';
  await send(page, withdrawalText, image);
  await queueCount(page, 1);
  await page.getByRole('button', { name: '停止生成', exact: true }).click();
  await page.getByTestId('v4-queue-paused-banner').waitFor();
  const withdrawnId = await rows(page).first().getAttribute('data-queue-item-id');
  assert(withdrawnId);
  await page.getByTestId(`v4-queue-item-edit-${withdrawnId}`).click();
  await until(async () => (await editRecoveryEntries(page)).some(entry =>
    entry.queueItemId === withdrawnId && entry.state === 'restored'),
  'Withdrawal must publish a durable restorable image copy before Pi deletion');
  await queueCount(page, 0);
  await editRecovery(page).waitFor();
  await page.screenshot({ path: join(f.output, 'pi-queue-withdrawn-durable-copy.png') });
  report.stages.withdrawnBeforeRestart = { queueItemId: withdrawnId, imageDigest: digest(image) };
  report.withdrawalCleanup = await closeOwned(app, f);
  assertCleanExit(report.withdrawalCleanup, logs, 'Withdrawal recovery restart');
  app = undefined;

  ({ app, page } = await openNative(f, logs, report));
  const targetTurn = page.locator('section[data-turn-id]')
    .filter({ hasText: 'PI_STOP: hold withdrawal recovery turn' }).first();
  if (!await targetTurn.isVisible()) {
    await page.locator('[data-testid^="task-item-"]')
      .filter({ hasText: 'PI_STOP: hold first foreground turn' }).first().click();
  }
  await targetTurn.waitFor({ timeout: 30_000 });
  await editRecovery(page).waitFor();
  const afterRestartCopies = await editRecoveryEntries(page);
  assert(afterRestartCopies.some(entry => entry.queueItemId === withdrawnId &&
    entry.text === withdrawalText && entry.attachments.length === 1));
  await composer(page).click();
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Backspace');
  const oldChips = page.locator('[data-composer-attachment-kind="image"][data-upload-status="ready"]');
  while (await oldChips.count()) {
    await oldChips.first().locator('[data-composer-attachment-remove]').click({ force: true });
  }
  await editRecovery(page).locator(`[data-queue-recovery-id="${withdrawnId}"]`)
    .getByTestId('pi-queue-recovery-restore').click();
  await until(async () => (await composer(page).innerText()).includes(withdrawalText),
    'Recovered Pi queue text must return to the original composer');
  await page.locator('[data-composer-attachment-kind="image"][data-upload-status="ready"]')
    .filter({ visible: true }).first().waitFor();
  await editRecovery(page).locator(`[data-queue-recovery-id="${withdrawnId}"]`)
    .getByRole('button', { name: '删除备份' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: '删除备份' }).click();
  assert((await editRecoveryEntries(page)).some(entry => entry.queueItemId === withdrawnId),
    'A restored composer image cannot lose its only durable backup before send');
  await page.getByText('为防止重启后丢图', { exact: false }).first().waitFor();
  const requestsBeforeRecoveredSend = model.requests.length;
  await sendButton(page).click();
  await until(() => model.requests.slice(requestsBeforeRecoveredSend).some(request =>
    request.promptText.includes(withdrawalText) && request.imageDigests.includes(digest(image))),
  'The fixed Pi model request must receive the exact restarted image bytes');
  assert((await editRecoveryEntries(page)).some(entry => entry.queueItemId === withdrawnId),
    'Pi acceptance alone cannot retire the image copy before durable history is proven');
  report.stages.withdrawnAfterRestart = { restored: true, prematureDiscardBlocked: true,
    exactImageSent: true, backupRetainedAfterAcceptedSend: true };
  await page.screenshot({ path: join(f.output, 'pi-queue-withdrawal-recovered-and-sent.png') });

  await verifyPiPackageCleanup(f);
  const boundaries = (await readFile(f.env.NATIVE_SMOKE_BOUNDARY_LOG, 'utf8'))
    .split('\n').filter(Boolean).map(JSON.parse);
  assert.deepEqual(boundaries.filter(entry => entry.type === 'filesystem-blocked'), []);
  assert.deepEqual(report.pageErrors, [], 'Native renderer must not throw');
} catch (error) {
  report.error = error.stack || String(error);
  report.body = (await app?.windows()[0]?.locator('body').innerText().catch(() => ''))?.slice(0, 7000);
  process.exitCode = 1;
  console.error(error);
  await app?.windows()[0]?.screenshot({ path: join(f.output, 'pi-queue-failure.png') }).catch(() => {});
} finally {
  try {
    report.cleanup = app ? await closeOwned(app, f) : report.startupCleanup;
    if (report.cleanup) assertCleanExit(report.cleanup, logs, 'Final');
  }
  catch (error) { report.cleanupError = String(error); process.exitCode = 1; }
  await model.close();
  report.modelRequests = model.requests;
  await writeFile(join(f.output, 'pi-queue-gui-report.json'), JSON.stringify(report, null, 2));
  await writeFile(join(f.output, 'pi-queue-gui.log'), logs.join(''));
  console.log(JSON.stringify(report, null, 2));
}
