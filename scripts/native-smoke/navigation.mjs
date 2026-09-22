import assert from 'node:assert/strict';
import { drag } from './panels.mjs';

export async function navigation(page, f, e) {
  await e.action('Task sidebar: right-click native context menu, inspect split entry', async () => {
    await page.locator('[data-testid^="task-item-"]').first().click({ button: 'right' });
    await e.branding();
    await e.shot('task-context-menu');
    const split = page.getByTestId('v4-task-open-in-split');
    if (await split.isVisible() && await split.isEnabled()) {
      await split.click();
      await page.getByTestId('v4-split-divider').waitFor();
      const before = await page.getByTestId('v4-split-divider').boundingBox();
      await drag(page, page.getByTestId('v4-split-divider'), 75, 0);
      assert.notEqual((await page.getByTestId('v4-split-divider').boundingBox()).x, before.x);
      await e.shot('split-resized');
      await page.getByTestId('v4-split-close').click();
    } else {
      e.report.unavailable ??= [];
      e.report.unavailable.push({ action: 'Conversation split create/drag/resize/focus/restore',
        reason: 'No enabled native task-menu split entry in this build; no hidden component/store activation attempted.',
        source: 'packages/ui/src/v4/ConversationHeader.tsx:64 and native task-menu feature gate' });
      await page.keyboard.press('Escape');
    }
  });
  await e.action('New-task navigation, command search shortcut/Escape, sidebar session restore', async () => {
    await page.keyboard.press('ControlOrMeta+n');
    await page.waitForTimeout(400);
    if (!await page.getByTestId('composer-workspace-trigger').isVisible()) {
      await e.application.evaluate(({ BrowserWindow }) => {
        const contents = BrowserWindow.getAllWindows().find(w => w.isVisible()).webContents;
        contents.sendInputEvent({ type: 'keyDown', keyCode: 'N', modifiers: ['control'] });
        contents.sendInputEvent({ type: 'keyUp', keyCode: 'N', modifiers: ['control'] });
      });
      await page.waitForTimeout(400);
    }
    if (!await page.getByTestId('composer-workspace-trigger').isVisible()) {
      e.report.unavailable ??= [];
      e.report.unavailable.push({ action: 'Ctrl+N native accelerator', reason: 'Neither Playwright nor Electron key events opened a draft; new-task button is tested separately.' });
      await page.getByText('新建任务', { exact: true }).first().click();
    }
    await page.getByTestId('composer-workspace-trigger').waitFor();
    await e.shot('new-task');
    await page.keyboard.press('ControlOrMeta+k');
    await page.getByRole('dialog').waitFor();
    await page.getByText('切换侧边栏', { exact: true }).waitFor();
    await e.shot('command-search');
    await page.keyboard.press('Escape');
    await page.locator('[data-testid^="task-item-"]').first().click();
    await page.getByText('PARITY_RECOVER_COMPLETE', { exact: true }).waitFor();
    await e.shot('session-restored');
  });
}
