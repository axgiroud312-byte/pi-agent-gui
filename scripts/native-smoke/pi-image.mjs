import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

export const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC', 'base64');
export const unsentImage = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNgYPgPAAEDAQAIicLsAAAAAElFTkSuQmCC', 'base64');
const prompt = 'PI_IMAGE: describe the attached pixel';
const unsentPrompt = 'PI_IMAGE: unsent draft survives restart';
const rootPrompt = 'PI_IMAGE_ROOT: retain this unsent image';
const unsentImageDigest = createHash('sha256').update(unsentImage).digest('hex');

function imageTurn(page) {
  return page.locator('section[data-turn-id]').filter({ hasText: prompt }).first();
}

async function assertImageVisible(page) {
  const preview = imageTurn(page).locator('[data-v4-user-input-media-attachments="true"] img').first();
  await preview.waitFor({ timeout: 15_000 });
  await page.waitForFunction(() => {
    const img = [...document.querySelectorAll('section[data-turn-id]')]
      .find(section => section.textContent?.includes('PI_IMAGE: describe the attached pixel'))
      ?.querySelector('[data-v4-user-input-media-attachments="true"] img');
    return img instanceof HTMLImageElement && img.complete && img.naturalWidth > 0;
  });
  return preview.evaluate(img => img.complete && img.naturalWidth > 0);
}

export async function sendPiImage(page, model, output) {
  const input = page.getByTestId('v4-composer-input').filter({ visible: true }).first();
  await input.click();
  await page.keyboard.type(prompt);
  await page.locator('.chat-composer-region input[type="file"]').first()
    .setInputFiles({ name: '截图.png', mimeType: 'image/png', buffer: image });
  await page.locator('[data-composer-attachment-kind="image"][data-upload-status="ready"]').first().waitFor();
  await page.screenshot({ path: join(output, 'pi-native-image-draft.png') });
  await page.getByTestId('v4-composer-send').filter({ visible: true }).first().click();
  await page.getByText('PI_IMAGE_COMPLETE', { exact: true }).waitFor({ timeout: 30_000 });
  const modelRequest = model.requests.find(request => request.scenario === 'PI_IMAGE');
  assert(modelRequest?.imageMimeTypes.includes('image/png'),
    'Pinned Pi must deliver the GUI-selected image to the controlled model');
  assert(await assertImageVisible(page), 'Pi history image must be previewable in the native timeline');
  await page.screenshot({ path: join(output, 'pi-native-image-sent.png') });
  return modelRequest;
}

export async function verifyBusyImageIsNotLost(page, model, output) {
  const input = page.getByTestId('v4-composer-input').filter({ visible: true }).first();
  await input.click();
  await page.keyboard.type('PI_QUEUE_IMAGE: keep the unsent image');
  await page.locator('.chat-composer-region input[type="file"]').first()
    .setInputFiles({ name: 'busy-image.png', mimeType: 'image/png', buffer: image });
  const chip = page.locator('[data-composer-attachment-kind="image"][data-upload-status="ready"]').first();
  await chip.waitFor();
  const requestsBefore = model.requests.length;
  await page.getByTestId('v4-composer-send').filter({ visible: true }).first().click();
  const details = page.getByTestId('chat-error-details-button');
  await details.waitFor({ timeout: 15_000 });
  await details.click();
  await page.getByText('pi.queueImagesRequireLosslessRecovery', { exact: true }).waitFor();
  assert(await chip.isVisible() && (await input.innerText()).includes('PI_QUEUE_IMAGE'),
    'A refused image queue admission must keep both text and image in the composer');
  assert.equal(model.requests.length, requestsBefore, 'Refused image must not reach the model');
  assert.equal(await page.locator('[data-queue-read-only="true"]').count(), 0,
    'Refused image must never appear as a text-only Pi queue item');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '停止生成', exact: true }).waitFor({ timeout: 10_000 });
  assert(await chip.isVisible(), 'Stop must remain reachable without discarding the rejected image');
  await page.screenshot({ path: join(output, 'pi-native-busy-image-refused.png') });
  // The refusal left the draft untouched. Clear it deliberately before the
  // separate queue/Stop probe, not as an automatic admission side effect.
  await chip.hover();
  await page.locator('[data-composer-attachment-remove]').first().click();
  await input.click();
  await input.press('ControlOrMeta+A');
  await input.press('Backspace');
  return true;
}

/** Delay only browser file reads, then attempt send before the image is admitted. */
export async function probeImageAdmissionRace(page, model) {
  await page.evaluate(() => {
    const original = File.prototype.arrayBuffer;
    File.prototype.arrayBuffer = function delayedDraftRead() {
      if (this.name !== 'pending-admission.png') return original.call(this);
      return new Promise(resolve => setTimeout(resolve, 2000)).then(() => original.call(this));
    };
  });
  const input = page.getByTestId('v4-composer-input').filter({ visible: true }).first();
  await input.click();
  await page.keyboard.type('PI_ADMISSION_IMAGE: wait for selected bytes');
  const requestsBefore = model.requests.length;
  await page.locator('.chat-composer-region input[type="file"]').first()
    .setInputFiles({ name: 'pending-admission.png', mimeType: 'image/png', buffer: unsentImage });
  await input.press('Enter');
  await page.waitForTimeout(500);
  assert.equal(model.requests.length, requestsBefore,
    'Send while image bytes are still being saved must not submit text alone');
  await page.locator('[data-composer-attachment-kind="image"][data-upload-status="ready"]')
    .filter({ visible: true }).first().waitFor({ timeout: 15_000 });
  await page.locator('[data-composer-attachment-remove]').first().click();
  await input.click();
  await input.press('ControlOrMeta+A');
  await input.press('Backspace');
  return true;
}

export async function verifyRestoredPiImage(page) {
  await page.getByText('PI_IMAGE_COMPLETE', { exact: true }).waitFor();
  assert(await assertImageVisible(page), 'Pi JSONL must restore the native image preview after restart');
  return true;
}

export async function stageUnsentPiImage(page, output) {
  const input = page.getByTestId('v4-composer-input').filter({ visible: true }).first();
  await input.click();
  await page.keyboard.type(unsentPrompt);
  await page.locator('.chat-composer-region input[type="file"]').first()
    .setInputFiles({ name: 'unsent-draft.png', mimeType: 'image/png', buffer: unsentImage });
  await page.locator('[data-composer-attachment-kind="image"][data-upload-status="ready"]').first().waitFor();
  await page.screenshot({ path: join(output, 'pi-native-unsent-image-before-restart.png') });
}

export async function verifyRestoredUnsentPiImage(page, model, output) {
  const input = page.getByTestId('v4-composer-input').filter({ visible: true }).first();
  const chip = page.locator('[data-composer-attachment-kind="image"]').filter({ visible: true }).first();
  await page.locator('[data-composer-attachment-kind="image"][data-upload-status="ready"]')
    .filter({ visible: true }).first().waitFor({ timeout: 15_000 });
  await page.waitForFunction(expected => document.querySelector('[data-testid="v4-composer-input"]')
    ?.textContent?.includes(expected), unsentPrompt);
  assert((await input.innerText()).includes(unsentPrompt), 'Unsent image text must survive app restart');
  assert.equal(await chip.locator('img').getAttribute('alt'), 'unsent-draft.png',
    'Unsent image chip must preserve its filename after app restart');
  assert(await chip.locator('img').evaluate(img => img.complete && img.naturalWidth > 0),
    'Restored unsent image preview must decode');
  await page.screenshot({ path: join(output, 'pi-native-unsent-image-after-restart.png') });
  const requestsBeforeSend = model.requests.length;
  const responseCount = await page.getByText('PI_IMAGE_COMPLETE', { exact: true }).count();
  await page.getByTestId('v4-composer-send').filter({ visible: true }).first().click();
  await page.getByText('PI_IMAGE_COMPLETE', { exact: true }).nth(responseCount).waitFor({ timeout: 30_000 });
  const request = model.requests.slice(requestsBeforeSend).find(candidate => candidate.scenario === 'PI_IMAGE'
    && candidate.imageDigests.includes(unsentImageDigest) && candidate.imageMimeTypes.includes('image/png'));
  assert(request, `Restored draft must deliver its own PNG bytes through pinned Pi: ${JSON.stringify(
    model.requests.slice(requestsBeforeSend).map(candidate => ({
      scenario: candidate.scenario, imageDigests: candidate.imageDigests,
    })),
  )}`);
  return request;
}

export async function stageRootUnsentPiImage(page, output, nativePicker) {
  const input = page.getByTestId('v4-composer-input').filter({ visible: true }).first();
  await input.click();
  await page.keyboard.type(rootPrompt);
  if (nativePicker) {
    await page.getByTestId('chat-attachment-button').filter({ visible: true }).first().click();
    await page.getByTestId('chat-attachment-menu-item').filter({ visible: true }).first().click();
  } else await page.locator('.chat-composer-region input[type="file"]').first()
    .setInputFiles({ name: 'root-unsent.png', mimeType: 'image/png', buffer: unsentImage });
  await page.locator('[data-composer-attachment-kind="image"][data-upload-status="ready"]')
    .filter({ visible: true }).first().waitFor();
  await page.locator('.chat-composer-region input[type="file"]').first()
    .setInputFiles({ name: 'corrupt-sibling.png', mimeType: 'image/png', buffer: image });
  await page.locator('[data-composer-attachment-kind="image"][data-upload-status="ready"]')
    .filter({ visible: true }).nth(1).waitFor();
  await page.evaluate(async () => {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open('zcode-v4-composer-images');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const transaction = database.transaction('images', 'readwrite');
    const store = transaction.objectStore('images');
    const rows = await new Promise((resolve, reject) => {
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const sibling = rows.find(row => row.fileName === 'corrupt-sibling.png');
    if (!sibling) throw new Error('The sibling image was not saved before fault injection');
    sibling.sha256 = '0'.repeat(64);
    store.put(sibling);
    await new Promise((resolve, reject) => {
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
    database.close();
  });
  await page.screenshot({ path: join(output, 'pi-native-root-image-before-restart.png') });
}

export async function verifyRestoredRootUnsentPiImage(page, model, output) {
  const input = page.getByTestId('v4-composer-input').filter({ visible: true }).first();
  await page.locator('[data-composer-attachment-kind="image"][data-upload-status="ready"]')
    .filter({ visible: true }).first().waitFor({ timeout: 15_000 });
  const damaged = page.locator('[data-composer-attachment-kind="image"][data-upload-status="failed"]')
    .filter({ visible: true }).first();
  await damaged.waitFor({ timeout: 15_000 });
  assert.equal(await damaged.getAttribute('title'), 'corrupt-sibling.png',
    'Only the damaged sibling should be blocked, retaining its filename');
  assert((await input.innerText()).includes(rootPrompt),
    'New-task root text must survive app restart');
  const chip = page.locator('[data-composer-attachment-kind="image"]').filter({ visible: true }).first();
  assert.equal(await chip.locator('img').getAttribute('alt'), 'root-unsent.png');
  assert(await chip.locator('img').evaluate(img => img.complete && img.naturalWidth > 0),
    'New-task root image must decode after restart');
  await page.screenshot({ path: join(output, 'pi-native-root-image-after-restart.png') });
  await damaged.locator('[data-composer-attachment-remove]').click();
  const requestsBeforeSend = model.requests.length;
  const responseCount = await page.getByText('PI_IMAGE_COMPLETE', { exact: true }).count();
  await page.getByTestId('v4-composer-send').filter({ visible: true }).first().click();
  await page.getByText('PI_IMAGE_COMPLETE', { exact: true }).nth(responseCount).waitFor({ timeout: 30_000 });
  const request = model.requests.slice(requestsBeforeSend).find(candidate => candidate.scenario === 'PI_IMAGE'
    && candidate.imageDigests.includes(unsentImageDigest));
  assert(request, 'Root draft must deliver the originally selected bytes through pinned Pi');
  return { restored: true, sentOriginalBytes: true };
}
