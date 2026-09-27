import assert from 'node:assert/strict';
import { join } from 'node:path';
import { verifyBusyImageIsNotLost } from './pi-image.mjs';

const queuedText = 'PI_QUEUE_TEXT: keep this message on Stop';

export async function probeBusyImageAndQueue(page, model, output) {
  await verifyBusyImageIsNotLost(page, model, output);
  return { busyImageRejectedWithoutLoss: true,
    queuedText: await enqueueTextBeforeStop(page, model, output) };
}

export async function enqueueTextBeforeStop(page, model, output) {
  const input = page.getByTestId('v4-composer-input').filter({ visible: true }).first();
  await input.click();
  await page.keyboard.type(queuedText);
  const requestsBefore = model.requests.length;
  await page.getByTestId('v4-composer-send').filter({ visible: true }).first().click();
  const queue = page.getByTestId('v4-queue');
  await queue.locator('[data-kind="sendText"]').filter({ hasText: queuedText }).waitFor({ timeout: 10_000 });
  assert.equal(await queue.getAttribute('data-queue-read-only'), 'true');
  assert.equal(model.requests.length, requestsBefore, 'Pi must hold the follow-up while its current run is active');
  assert(await page.getByRole('button', { name: '停止生成', exact: true }).isVisible(),
    'A Pi queued item must not hide the native Stop control');
  await page.screenshot({ path: join(output, 'pi-native-queued-text.png') });
  return queuedText;
}

export async function verifyStoppedQueue(page, text, output, label = 'stopped') {
  const queue = page.getByTestId('v4-queue');
  await queue.locator('[data-kind="sendText"]').filter({ hasText: text }).waitFor({ timeout: 10_000 });
  assert.equal(await queue.getAttribute('data-queue-auto-drain'), 'false');
  assert.equal(await queue.getAttribute('data-queue-read-only'), 'true');
  assert.equal(await queue.getByRole('button').count(), 0,
    'A returned Pi text cannot offer unsupported delete/reorder/resume actions');
  await page.screenshot({ path: join(output, `pi-native-${label}-queue.png`) });
  return true;
}
