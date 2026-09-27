import assert from 'node:assert/strict';
import { join } from 'node:path';

const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC', 'base64');
const prompt = 'PI_IMAGE: describe the attached pixel';

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

export async function verifyRestoredPiImage(page) {
  await page.getByText('PI_IMAGE_COMPLETE', { exact: true }).waitFor();
  assert(await assertImageVisible(page), 'Pi JSONL must restore the native image preview after restart');
  return true;
}
