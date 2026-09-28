import assert from 'node:assert/strict';
import { test } from 'node:test';
import { withPage } from './piDialogSessionScopeHarness.mjs';

test('A confirmed publish stays discoverable in A after B is selected, without leaking to B or retrying', async () => {
  await withPage(async page => {
    const viewerUrl = 'https://gist.github.com/example/PRIVATE_A';
    const gistUrl = 'https://gist.github.com/example/PRIVATE_A';
    await page.evaluate(() => window.__renderTransfer('A'));
    await page.getByTestId('pi-transfer-open').click();
    await page.getByTestId('pi-transfer-last-answer').filter({ hasText: 'A_PRIVATE_REPLY' }).waitFor();
    await page.getByTestId('pi-share-preview').click();
    await page.waitForFunction(() => window.__resolveShare !== undefined);
    await page.evaluate(() => window.__resolveShare({ token: 'TOKEN_A', revision: 'A',
      bytes: 42, html: '<html>A_PRIVATE_SECRET</html>', sessionDataJson: 'A_PRIVATE_SECRET' }));
    await page.getByTestId('pi-share-content-preview').filter({ hasText: 'A_PRIVATE_SECRET' }).waitFor();
    await page.getByTestId('pi-share-confirm-checkbox').check();
    await page.evaluate(() => {
      const button = document.querySelector('[data-testid="pi-share-publish"]');
      button.click(); button.click();
    });
    await page.waitForFunction(() => window.__publishCalls.length === 1);
    assert.deepEqual(await page.evaluate(() => window.__publishCalls), [{
      workspacePath: 'C:/fixture', sessionId: 'A', token: 'TOKEN_A', confirmed: true,
    }], 'one explicitly confirmed call must target A');

    await page.evaluate(() => window.__renderTransfer('B'));
    await page.getByTestId('pi-transfer-open').click();
    await page.getByTestId('pi-transfer-last-answer').filter({ hasText: 'B_PUBLIC_REPLY' }).waitFor();
    assert.deepEqual(await page.evaluate(() => window.__discardCalls), [],
      'navigation must not discard the token already owned by the pending publisher');
    await page.evaluate(result => window.__resolvePublish(result), { viewerUrl, gistUrl });
    await page.waitForTimeout(100);
    assert.equal(await page.getByText(viewerUrl, { exact: false }).count(), 0,
      'B must never show A private link');

    const bUrl = 'https://gist.github.com/example/PUBLIC_B';
    await page.getByTestId('pi-share-preview').click();
    await page.evaluate(() => window.__resolveShare({ token: 'TOKEN_B', revision: 'B',
      bytes: 41, html: '<html>B_PUBLIC</html>', sessionDataJson: 'B_PUBLIC' }));
    await page.getByTestId('pi-share-content-preview').filter({ hasText: 'B_PUBLIC' }).waitFor();
    await page.getByTestId('pi-share-confirm-checkbox').check();
    await page.getByTestId('pi-share-publish').click();
    await page.waitForFunction(() => window.__publishCalls.length === 2);
    await page.evaluate(result => window.__resolvePublish(result), { viewerUrl: bUrl, gistUrl: bUrl });
    await page.getByTestId('pi-share-receipts').getByRole('status')
      .filter({ hasText: bUrl }).waitFor();

    await page.evaluate(() => { window.__removeTransfer(); window.__renderTransfer('A'); });
    await page.getByTestId('pi-transfer-open').click();
    await page.getByTestId('pi-share-receipts').getByRole('status')
      .filter({ hasText: viewerUrl }).waitFor({ timeout: 2000 });
    assert.deepEqual(await page.evaluate(() => window.__publishCalls.map(call => call.sessionId)), ['A', 'B'],
      'returning to A must only read the receipt, not publish again');
    await page.getByRole('button', { name: '清除本地收据' }).click();
    assert.equal(await page.getByTestId('pi-share-receipts').count(), 0,
      'the user can clear the private link from renderer memory');
    await page.evaluate(() => window.__renderTransfer('B'));
    await page.getByTestId('pi-transfer-open').click();
    await page.getByTestId('pi-share-receipts').getByRole('status')
      .filter({ hasText: bUrl }).waitFor();
    assert.equal(await page.getByText(viewerUrl, { exact: false }).count(), 0,
      'clearing A must leave B receipt intact and never reveal A in B');
  });
});

test('A publisher failure after navigation is visible only when returning to A', async () => {
  await withPage(async page => {
    await page.evaluate(() => window.__renderTransfer('A'));
    await page.getByTestId('pi-transfer-open').click();
    await page.getByTestId('pi-transfer-last-answer').filter({ hasText: 'A_PRIVATE_REPLY' }).waitFor();
    await page.getByTestId('pi-share-preview').click();
    await page.evaluate(() => window.__resolveShare({ token: 'TOKEN_A_FAIL', revision: 'A',
      bytes: 42, html: '<html>A_PRIVATE_SECRET</html>', sessionDataJson: 'A_PRIVATE_SECRET' }));
    await page.getByTestId('pi-share-content-preview').waitFor();
    await page.getByTestId('pi-share-confirm-checkbox').check();
    await page.getByTestId('pi-share-publish').click();
    await page.waitForFunction(() => window.__publishCalls.length === 1);
    await page.evaluate(() => window.__renderTransfer('B'));
    await page.getByTestId('pi-transfer-open').click();
    await page.getByTestId('pi-transfer-last-answer').filter({ hasText: 'B_PUBLIC_REPLY' }).waitFor();
    await page.evaluate(() => window.__rejectPublish(new Error('FAKE_GH_UNCERTAIN')));
    await page.waitForTimeout(100);
    assert.equal(await page.getByText('FAKE_GH_UNCERTAIN', { exact: false }).count(), 0);
    await page.evaluate(() => window.__renderTransfer('A'));
    await page.getByTestId('pi-transfer-open').click();
    await page.getByTestId('pi-share-publish-error').filter({ hasText: 'FAKE_GH_UNCERTAIN' }).waitFor();
    assert.equal(await page.evaluate(() => window.__publishCalls.length), 1,
      'failure notice must not cause an automatic retry');
    await page.getByRole('button', { name: '清除发布提示' }).click();
    assert.equal(await page.getByTestId('pi-share-publish-error').count(), 0);
  });
});
