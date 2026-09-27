import assert from 'node:assert/strict';
import { join } from 'node:path';

const queuedText = 'PI_QUEUE_TEXT: keep this message on Stop';

export async function enqueueTextBeforeStop(page, model, output) {
  const input = page.getByTestId('v4-composer-input').filter({ visible: true }).first();
  await input.click();
  await page.keyboard.type(queuedText);
  const requestsBefore = model.requests.length;
  await page.getByTestId('v4-composer-send').filter({ visible: true }).first().click();
  const queue = page.getByTestId('v4-queue');
  await queue.locator('[data-kind="sendText"]').filter({ hasText: queuedText }).waitFor({ timeout: 10_000 });
  assert.equal(await queue.getAttribute('data-queue-read-only'), 'false');
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
  assert.equal(await queue.getAttribute('data-queue-read-only'), 'false');
  await queue.getByTestId('v4-queue-resume').waitFor();
  assert(await queue.getByRole('button').count() > 0,
    'A paused live Pi queue must expose native edit and resume actions');
  await page.screenshot({ path: join(output, `pi-native-${label}-queue.png`) });
  return true;
}

export async function verifyInterruptedQueueRecovery(page, output) {
  await page.getByText(/previously queued Pi inputs survived as recovery copies/u).waitFor({ timeout: 15_000 });
  const queue = page.getByTestId('v4-queue');
  assert.equal(await queue.count(), 0,
    'A restarted Pi session must not present its interrupted recovery copy as a live Pi queue');
  await page.screenshot({ path: join(output, 'pi-native-interrupted-queue-recovery.png') });
  return true;
}
