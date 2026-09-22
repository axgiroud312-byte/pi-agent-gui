import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixture } from './fixture.mjs';
import { scenarios } from './scenarios.mjs';
import { startModel } from './model.mjs';
import { Evidence } from './evidence.mjs';
import { provenance } from './provenance.mjs';
import { closeOwned } from './cleanup.mjs';
import { finishReport, sanitize } from './report.mjs';

export async function run() {
  const f = await fixture();
  f.model = await startModel(f);
  let application;
  const log = [];
  const report = { baseline: f.baseline, sandbox: f.sandbox, started: new Date().toISOString(),
    fullIssue32Passed: false, pageErrors: [], network: [] };
  try {
    report.provenance = await provenance(f);
    if (f.baseline === 'original') {
      assert(report.provenance.sourceFiles > 0, 'Original source identity must be verified');
      assert(report.provenance.pinnedSourceVerified, 'Original upstream Git objects must be available');
      assert.deepEqual(report.provenance.sourceMismatches, [], 'Original runtime sources differ from pinned upstream');
    }
    application = await f.playwright._electron.launch({ executablePath: f.electronPath,
      args: [fileURLToPath(new URL('./bootstrap.cjs', import.meta.url)), '--lang=zh-CN'], cwd: f.root, env: f.env, timeout: 60_000 });
    application.process().stdout?.on('data', chunk => log.push(String(chunk)));
    application.process().stderr?.on('data', chunk => log.push(String(chunk)));
    report.paths = await application.evaluate(({ app }) => ({
      home: app.getPath('home'), userData: app.getPath('userData'), sessionData: app.getPath('sessionData'),
      appPath: app.getAppPath(), name: app.getName(), versions: process.versions,
      pid: process.pid,
    }));
    assert.match(report.paths.versions.electron, /^41\./, 'Use the prepared Electron 41 runtime');
    for (const key of ['home', 'userData', 'sessionData']) {
      const rel = relative(f.sandbox, report.paths[key]);
      assert(!rel.startsWith('..') && !isAbsolute(rel), `${key} escaped fixture`);
    }
    const page = await application.firstWindow();
    page.setDefaultTimeout(10_000);
    page.on('pageerror', error => { report.pageErrors.push(sanitize(error.message)); log.push(`PAGE ERROR: ${error.message}`); });
    const safeUrl = url => { try { const parsed = new URL(url); return `${parsed.origin}${parsed.pathname}`; } catch { return '[invalid URL]'; } };
    page.on('requestfailed', req => report.network.push({ url: safeUrl(req.url()), failure: req.failure()?.errorText }));
    await application.context().tracing.start({ screenshots: true, snapshots: true, sources: false });
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.waitForTimeout(6000);
    report.initialTitle = await page.title();
    report.rendererUrl = page.url();
    assert.match(report.rendererUrl, /^file:/, 'Smoke must use the actual production renderer');
    report.window = await application.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows().find(w => w.isVisible());
      return window && { visible: window.isVisible(), contentBounds: window.getContentBounds(), zoom: window.webContents.getZoomFactor() };
    });
    assert(report.window?.visible, 'The native GUI must actually be shown');
    const evidence = new Evidence(page, application, f, report);
    evidence.theme = await page.evaluate(() => document.documentElement.classList.contains('dark') ? 'dark' : 'light');
    await evidence.shot('first-window');
    for (const name of [/^(使用 API key|Use API key)$/, /^(暂时跳过|Skip for now)$/, /^(退出引导|Exit onboarding)$/]) {
      const button = page.getByRole('button', { name, exact: true });
      if (await button.isVisible()) await evidence.action(`Onboarding: ${await button.getAttribute('aria-label') || await button.innerText()}`, async () => {
        await button.click(); await page.waitForTimeout(1800);
      });
    }
    await evidence.action('Settings: select Chinese UI locale through the native selector', async () => {
      await page.getByTestId('task-settings-button').filter({ visible: true }).click();
      await page.getByTestId('settings-locale-select-trigger').click();
      await page.getByTestId('settings-locale-select-item-zh-CN').click();
      await page.getByTestId('settings-back-button').click();
      await page.getByTestId('settings-page').waitFor({ state: 'hidden' });
    });
    await evidence.shot('startup');
    await evidence.branding();
    if (f.baseline === 'product') await evidence.action('Native footer keeps preferences without vendor account actions', async () => {
      await page.getByTestId('login-trigger').filter({ visible: true }).click();
      await page.getByRole('menuitem', { name: /语言|Language/ }).waitFor({ state: 'visible' });
      assert.equal(await page.getByTestId('login-menu-item').isVisible(), false);
      assert.doesNotMatch(await page.getByRole('menu').last().innerText(), /Coding\s*Plan|充值|登录|Log\s*in/i);
      await evidence.shot('preferences-menu');
      await page.keyboard.press('Escape');
    });
    await scenarios(page, f, evidence);
    for (const state of ['empty', 'running', 'waiting', 'error', 'file-preview']) {
      assert.equal(report.screenshots.filter(s => s.state === state).length, 4, `${state} needs all four theme/size variants`);
    }
    const after = await provenance(f, 'provenance-after.json');
    assert.equal(after.artifactDigest, report.provenance.artifactDigest, 'Prepared application output changed during smoke');
    assert.equal(after.sourceDigest, report.provenance.sourceDigest, 'Application source changed during smoke');
    report.buildUnchanged = true;
  } catch (error) {
    report.error = error.stack; console.error(error); process.exitCode = 1;
    const failedPage = application?.windows()[0];
    if (failedPage && !failedPage.isClosed()) {
      await failedPage.screenshot({ path: join(f.output, 'failure.png') }).catch(() => {});
      await writeFile(join(f.output, 'failure.html'), await failedPage.content()).catch(() => {});
    }
  } finally {
    await application?.context().tracing.stop({ path: join(f.output, 'trace.zip') }).catch(() => {});
    try { report.cleanup = await closeOwned(application, f); }
    catch (error) { report.cleanupError = error.message; report.error ??= error.stack; await application?.close().catch(() => {}); }
    await f.model.close();
    await finishReport(f, report, log);
    if (!report.nativeSmokePassed) process.exitCode = 1;
  }
}
