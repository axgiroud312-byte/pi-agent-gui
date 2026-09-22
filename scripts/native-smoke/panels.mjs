import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export async function drag(page, locator, dx, dy) {
  const box = await locator.boundingBox();
  assert(box, 'Visible native drag handle required');
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  await page.mouse.move(x, y); await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 16 }); await page.mouse.up();
  await page.waitForTimeout(350);
}

export async function panels(page, f, e) {
  await e.action('Terminal: native toggle → real PTY command → file on disk', async () => {
    await page.getByTestId('terminal-toggle').click();
    await page.locator('.xterm-helper-textarea').waitFor();
    await page.locator('.xterm-helper-textarea').focus();
    await page.keyboard.type(`echo NATIVE_PARITY_PTY > "${join(f.workspace, 'pty-proof.txt')}"`);
    await page.keyboard.press('Enter');
    let content = '';
    for (let attempt = 0; attempt < 40; attempt++) {
      try {
        const bytes = await readFile(join(f.workspace, 'pty-proof.txt'));
        content = bytes.toString(bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf16le' : 'utf8');
      } catch { /* PTY startup */ }
      if (content.includes('NATIVE_PARITY_PTY')) break;
      await page.waitForTimeout(250);
    }
    assert.match(content, /NATIVE_PARITY_PTY/);
    await page.keyboard.type('echo NATIVE_PARITY_PTY_VISIBLE'); await page.keyboard.press('Enter');
    await e.shot('terminal-command');
    const height = (await page.locator('#terminal').boundingBox()).height;
    await drag(page, page.locator('[data-workspace-terminal-resize-handle]'), 0, -80);
    assert((await page.locator('#terminal').boundingBox()).height > height + 30);
    await e.shot('terminal-resized');
    await page.getByTestId('terminal-close-button').click();
  });
  await e.action('Workspace file tree → real README → native preview', async () => {
    await page.getByText('parity-workspace', { exact: true }).first().hover();
    const tree = page.locator('[data-testid^="workspace-file-tree-button"]');
    await tree.click();
    await page.getByText('README.md', { exact: true }).first().dblclick();
    await page.getByText('Preview marker: NATIVE_PARITY_PREVIEW', { exact: true }).waitFor();
    await e.shot('file-tree-preview');
    await page.getByText('hello.txt', { exact: true }).first().dblclick();
    await page.locator('[data-side-pane-tab-id]').filter({ hasText: 'hello.txt' }).waitFor();
    const tabs = page.locator('[data-side-pane-tab-id]');
    const before = await tabs.allTextContents();
    const a = await tabs.nth(0).boundingBox(), b = await tabs.nth(1).boundingBox();
    await drag(page, tabs.nth(0), b.x - a.x + 30, 0);
    assert.notDeepEqual(await tabs.allTextContents(), before, 'Native side tabs reorder after pointer drag');
    await tabs.filter({ hasText: 'README.md' }).click();
    await page.waitForTimeout(150);
    if (await tabs.filter({ hasText: 'README.md' }).getAttribute('data-state') !== 'active') {
      e.report.observations ??= [];
      e.report.observations.push('Native SidePaneTabTrigger suppresses the first post-drag activation click; a second click activates the tab.');
      await tabs.filter({ hasText: 'README.md' }).click();
    }
    await tabs.filter({ hasText: 'README.md' }).and(page.locator('[data-state="active"]')).waitFor();
    assert.equal(await tabs.filter({ hasText: 'README.md' }).getAttribute('data-state'), 'active');
    await e.shot('side-tabs-reordered');
    const width = (await page.locator('#browser').boundingBox()).width;
    await drag(page, page.locator('[data-workspace-side-pane-resize-handle]'), -75, 0);
    assert((await page.locator('#browser').boundingBox()).width > width + 30);
    await e.matrix('file-preview', async () => {
      await page.getByText('Preview marker: NATIVE_PARITY_PREVIEW', { exact: true }).waitFor();
    });
    await tabs.filter({ hasText: 'hello.txt' }).click();
    await tabs.filter({ hasText: 'hello.txt' }).getByRole('button').click();
    assert.equal(await tabs.count(), 1);
    await e.shot('side-tab-closed');
    await page.getByTestId('side-pane-toggle').click();
  });
}
