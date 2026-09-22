import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export class Evidence {
  constructor(page, application, f, report) {
    Object.assign(this, { page, application, f, report });
    this.theme = 'dark'; this.size = { width: 1280, height: 800 };
    this.report.screenshots = []; this.report.actions = [];
  }
  async action(name, operation) {
    const item = { name, started: new Date().toISOString(), status: 'running' };
    this.report.actions.push(item);
    try { const result = await operation(); item.status = 'passed'; console.log(`PASS ${name}`); return result; }
    catch (error) { item.status = 'failed'; item.error = error.message; throw error; }
  }
  async shot(state) {
    await this.page.mouse.move(5, 795);
    await this.page.waitForTimeout(250);
    const filename = `${this.size.width}x${this.size.height}-${this.theme}-${state}.png`;
    await mkdir(join(this.f.output, 'screenshots'), { recursive: true });
    await this.page.screenshot({ path: join(this.f.output, 'screenshots', filename), timeout: 30_000, scale: 'css' });
    this.report.screenshots.push({ state, theme: this.theme, viewport: this.size, file: `screenshots/${filename}` });
    await writeFile(join(this.f.output, 'screenshots', filename.replace('.png', '.txt')), await this.page.locator('body').innerText());
  }
  async resize(size) {
    await this.application.evaluate(({ BrowserWindow }, size) => {
      const window = BrowserWindow.getAllWindows().find(w => w.isVisible());
      window.setContentSize(size.width, size.height); window.focus();
    }, size);
    await this.page.setViewportSize(size);
    this.size = size;
  }
  async setTheme(theme, captureSettings = false) {
    const returnTasks = this.page.getByRole('button', { name: '返回任务', exact: true });
    if (await returnTasks.isVisible()) await returnTasks.click();
    await this.page.getByTestId('task-settings-button').filter({ visible: true }).click();
    await this.page.getByRole('button', { name: '外观', exact: true }).click();
    const settings = this.page.getByTestId('settings-page');
    await settings.getByRole('combobox').first().click();
    await this.page.getByRole('option', { name: theme === 'dark' ? '深色' : '浅色', exact: true }).click();
    await this.page.waitForFunction(dark => document.documentElement.classList.contains('dark') === dark, theme === 'dark');
    this.theme = theme;
    if (captureSettings) await this.shot('appearance');
    await this.page.getByTestId('settings-back-button').click();
    await this.page.getByTestId('settings-page').waitFor({ state: 'hidden' });
  }
  async matrix(state, assertion) {
    for (const size of [{ width: 1280, height: 800 }, { width: 1920, height: 1080 }]) {
      await this.resize(size);
      for (const theme of ['light', 'dark']) {
        await this.setTheme(theme, state === 'empty');
        await assertion();
        await this.branding();
        await this.shot(state);
      }
    }
    await this.resize({ width: 1280, height: 800 });
  }
  async branding() {
    if (this.f.baseline === 'original') return;
    assert.match(await this.page.title(), /Pi/i, 'Product renderer title must carry Pi branding');
    const text = await this.page.locator('body').innerText();
    // BYOK provider templates may legitimately name a Coding Plan endpoint.
    // Excluded product-account, purchase and entitlement actions must not exist.
    assert.doesNotMatch(text, /连接 (?:Z\.?ai|BigModel)|(?:购买|升级|订阅|开通|Buy|Upgrade|Subscribe)[^\n]*Coding\s*Plan|Start Plan|编程套餐|闲时任务|充值|云分享/i,
      'A vendor product entry remains visible');
    // Upstream's login-trigger is also the native preferences-menu trigger.
    // Preserve that menu; the excluded login action must be absent when opened.
    for (const tid of ['login-menu-item', 'coding-plan-upgrade-surface',
      'sidebar-coding-plan-usage-button', 'offpeak-create-button', 'conversation-share-trigger']) {
      assert.equal(await this.page.getByTestId(tid).isVisible(), false, `${tid} must be absent`);
    }
  }
}
