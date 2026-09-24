import assert from 'node:assert/strict';

export async function composer(page, f, e) {
  const input = page.getByTestId('v4-composer-input');
  await e.action('Lexical: keyboard typing, Shift+Enter, browser IME composition/commit, draft/focus', async () => {
    assert.equal(await input.getAttribute('data-lexical-editor'), 'true');
    await input.click();
    await page.keyboard.type('Native keyboard draft');
    await page.keyboard.press('Shift+Enter');
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.imeSetComposition', { text: '中文输入', selectionStart: 4, selectionEnd: 4 });
    await e.shot('ime-composition');
    assert.equal(f.model.requests.length, 0, 'Composition must not send a model request');
    await cdp.send('Input.insertText', { text: '中文输入' });
    await cdp.detach();
    assert.match(await input.innerText(), /Native keyboard draft\n.*中文输入/s);
    await e.setTheme('light');
    assert.match(await input.innerText(), /中文输入/, 'Draft survives settings and theme navigation');
    await input.click();
    assert(await input.evaluate(node => node === document.activeElement));
    await e.shot('lexical-draft');
    await page.keyboard.press('ControlOrMeta+A');
    await page.keyboard.press('Backspace');
  });
  if (f.baseline === 'original') {
    await e.action('Lexical: / suggestions → keyboard navigation → Escape', async () => {
      await input.click(); await page.keyboard.type('/');
      await page.waitForTimeout(700);
      await page.getByText('/compact', { exact: true }).waitFor();
      await e.shot('slash-suggestions');
      await page.keyboard.press('ArrowDown'); await page.keyboard.press('Escape');
      await page.keyboard.press('ControlOrMeta+A'); await page.keyboard.press('Backspace');
    });
  } else {
    // Pi's TUI /compact is not get_commands or a GUI compaction implementation.
    // Real RPC semantics are tested by pi-rpc-commands.test.ts, not an empty UI list.
    e.report.unavailable ??= [];
    e.report.unavailable.push({ action: 'Pi resource-command suggestions and GUI compaction',
      reason: 'get_commands is not yet projected to the native menu; an empty menu is NOT an empty Pi command directory.',
      issues: '#10 / #12', contract: 'packages/services/test/pi-rpc-commands.test.ts' });
    await e.action('Pi composer: slash draft / Escape do not send or pretend to compact', async () => {
      const requestsBefore = f.model.requests.length;
      await input.click(); await page.keyboard.type('/');
      await page.waitForTimeout(700);
      assert.equal(await page.getByText('/compact', { exact: true }).isVisible(), false);
      assert.equal((await input.innerText()).trim(), '/');
      await e.shot('slash-draft-not-a-command-directory');
      await page.keyboard.press('Escape');
      assert.equal((await input.innerText()).trim(), '/');
      assert.equal(f.model.requests.length, requestsBefore);
      await input.click();
      assert(await input.evaluate(node => node === document.activeElement));
      await page.keyboard.press('ControlOrMeta+A'); await page.keyboard.press('Backspace');
    });
  }
  await e.action('Lexical: @ local file suggestions → visible README selection', async () => {
    await page.keyboard.type('@README');
    await page.getByText('README.md', { exact: true }).first().waitFor();
    await e.shot('mention-suggestions');
    await page.getByText('README.md', { exact: true }).first().click();
    assert.match(await input.innerText(), /README/);
    await e.shot('mention-selected');
    await input.click(); await page.keyboard.press('ControlOrMeta+A'); await page.keyboard.press('Backspace');
  });
}
