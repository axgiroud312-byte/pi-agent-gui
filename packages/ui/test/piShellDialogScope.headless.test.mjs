import assert from 'node:assert/strict';
import { test } from 'node:test';
import { withPage } from './piDialogSessionScopeHarness.mjs';

test('Shell A command, in-flight Stop, and late result never belong to B', async () => {
  await withPage(async page => {
    await page.evaluate(() => window.__renderShell('A'));
    await page.getByTestId('pi-shell-open').click();
    await page.getByTestId('pi-shell-command').fill('echo A_PRIVATE_COMMAND');
    await page.getByRole('button', { name: '运行', exact: true }).click();
    await page.waitForFunction(() => window.__shellCalls.length === 1);
    await page.getByRole('button', { name: 'Stop shell' }).click();
    await page.evaluate(() => window.__renderShell('B'));
    await page.getByTestId('pi-shell-open').click();
    const dialog = page.getByTestId('pi-shell-dialog');
    const bCommand = await dialog.getByTestId('pi-shell-command').inputValue();
    const stop = dialog.getByRole('button', { name: 'Stop shell' });
    const bHadStop = await stop.count();
    if (bHadStop) await stop.click();
    await page.evaluate(() => window.__resolveShell({ cancelled: false,
      exitCode: 0, output: 'A_PRIVATE_OUTPUT', truncated: false }));
    await page.waitForTimeout(100);
    const bHadOldResult = await dialog.getByText('A_PRIVATE_OUTPUT').count();
    const stops = await page.evaluate(() => window.__stops);
    assert.equal(bCommand, '', 'B shell must start with its own empty command');
    assert.equal(bHadStop, 0, 'B must not offer Stop for A shell');
    assert.equal(bHadOldResult, 0, 'A late shell result must not render in B');
    assert.deepEqual(stops, ['A'], 'A may stop its own shell; B must never stop A work');
  });
});
