import assert from 'node:assert/strict';
import { test } from 'node:test';
import { withPage } from './piDialogSessionScopeHarness.mjs';

test('Transfer discards A late private share token using A target, never displays it in B', async () => {
  await withPage(async page => {
    await page.evaluate(() => window.__renderTransfer('A'));
    await page.getByTestId('pi-transfer-open').click();
    await page.getByTestId('pi-transfer-last-answer').filter({ hasText: 'A_PRIVATE_REPLY' }).waitFor();
    await page.getByTestId('pi-share-preview').click();
    await page.waitForFunction(() => window.__resolveShare !== undefined);
    await page.evaluate(() => window.__renderTransfer('B'));
    await page.getByTestId('pi-transfer-open').click();
    await page.getByTestId('pi-transfer-last-answer').filter({ hasText: 'B_PUBLIC_REPLY' }).waitFor();
    await page.evaluate(() => window.__resolveShare({ token: 'TOKEN_A', revision: 'A',
      bytes: 42, html: '<html>A_PRIVATE_SECRET</html>', sessionDataJson: 'A_PRIVATE_SECRET' }));
    await page.waitForTimeout(100);
    const leaked = await page.getByTestId('pi-share-content-preview')
      .filter({ hasText: 'A_PRIVATE_SECRET' }).count();
    const discards = await page.evaluate(() => window.__discardCalls);
    assert.equal(leaked, 0, 'B must not display A full private share payload');
    assert.deepEqual(discards, [{ sessionId: 'A', workspacePath: 'C:/fixture', token: 'TOKEN_A' }],
      'late A token must be discarded using its A target');
  });
});

test('Transfer ignores A file and directory picker results after B becomes active', async () => {
  await withPage(async page => {
    await page.evaluate(() => {
      window.__testPlatform.selectDirectory = () => new Promise(resolve => { window.__resolveDirectory = resolve; });
      window.__renderTransfer('A');
    });
    await page.getByTestId('pi-transfer-open').click();
    await page.getByTestId('pi-transfer-last-answer').filter({ hasText: 'A_PRIVATE_REPLY' }).waitFor();
    await page.getByTestId('pi-export-jsonl').click();
    await page.waitForFunction(() => window.__resolveDirectory !== undefined);
    await page.evaluate(() => window.__renderTransfer('B'));
    await page.getByTestId('pi-transfer-open').click();
    await page.getByTestId('pi-transfer-last-answer').filter({ hasText: 'B_PUBLIC_REPLY' }).waitFor();
    await page.evaluate(() => window.__resolveDirectory('C:/chosen-by-A'));
    await page.waitForTimeout(100);
    assert.deepEqual(await page.evaluate(() => window.__exportCalls), [],
      'A directory picker must not export after B takes ownership');

    await page.evaluate(() => {
      window.__testPlatform.selectFile = () => new Promise(resolve => { window.__resolveFile = resolve; });
      window.__renderTransfer('A');
    });
    await page.getByTestId('pi-transfer-open').click();
    await page.getByTestId('pi-transfer-last-answer').filter({ hasText: 'A_PRIVATE_REPLY' }).waitFor();
    await page.getByTestId('pi-import-jsonl').click();
    await page.waitForFunction(() => window.__resolveFile !== undefined);
    await page.evaluate(() => window.__renderTransfer('B'));
    await page.getByTestId('pi-transfer-open').click();
    await page.getByTestId('pi-transfer-last-answer').filter({ hasText: 'B_PUBLIC_REPLY' }).waitFor();
    await page.evaluate(() => window.__resolveFile('C:/chosen-by-A.jsonl'));
    await page.waitForTimeout(100);
    assert.deepEqual(await page.evaluate(() => window.__importCalls), [],
      'A file picker must not import after B takes ownership');
    assert.deepEqual(await page.evaluate(() => window.__beforeSwitch), [],
      'stale A import must not disturb B composer');
  });
});
