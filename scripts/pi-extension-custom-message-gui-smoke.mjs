// #25/P27: real Pi extension custom message survives native GUI and a cold restart.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import { fixture } from './native-smoke/fixture.mjs';
import { assertCleanExit, closeOwned } from './native-smoke/cleanup.mjs';
import { startPiModel } from './native-smoke/pi-model.mjs';
import { configurePiProfile, isolatePiPackage, verifyPiPackageCleanup } from './native-smoke/pi-package.mjs';

const f = await fixture();
const model = await startPiModel();
const report = { at: new Date().toISOString(), piVersion: '0.87.0', phases: [], pageErrors: [],
  boundary: 'native Electron GUI -> Host -> fixed Pi RPC extension -> Pi JSONL; deterministic loopback model is available but unused' };
let app;

async function openHistory(phase, sessionId, sendCommand) {
  const logs = [];
  app = await f.playwright._electron.launch({ executablePath: f.electronPath,
    args: [fileURLToPath(new URL('./native-smoke/bootstrap.cjs', import.meta.url)), '--lang=zh-CN'],
    cwd: f.root, env: f.env, timeout: 60_000 });
  app.process().stdout?.on('data', chunk => logs.push(String(chunk)));
  app.process().stderr?.on('data', chunk => logs.push(String(chunk)));
  const page = await app.firstWindow();
  page.setDefaultTimeout(20_000);
  page.on('pageerror', error => report.pageErrors.push(error.stack || error.message));
  await page.waitForTimeout(6000);
  for (const name of [/^(使用 API key|Use API key)$/, /^(暂时跳过|Skip for now)$/, /^(退出引导|Exit onboarding)$/]) {
    const button = page.getByRole('button', { name, exact: true });
    if (await button.isVisible()) { await button.click(); await page.waitForTimeout(1200); }
  }
  const addProject = page.getByRole('button', { name: '添加项目', exact: true });
  if (await addProject.isVisible()) {
    await addProject.click();
    await page.getByRole('menuitem', { name: '打开文件夹', exact: true }).click();
  }
  await page.getByTestId('composer-workspace-trigger').filter({ hasText: 'parity-workspace' }).waitFor();
  await page.locator(`[data-testid="task-item-${sessionId}"]`).click();
  await page.getByText('PI25_BASELINE', { exact: true }).waitFor();
  if (sendCommand) {
    const composer = page.getByTestId('v4-composer-input').filter({ visible: true }).first();
    await composer.click();
    await page.keyboard.type('/gui-compat-image');
    await page.getByTestId('v4-composer-send').filter({ visible: true }).first().click();
  }
  const row = page.locator('[data-pi-extension-message="pi-gui-compat.image"]').first();
  await row.waitFor({ timeout: 30_000 });
  const rowText = await row.innerText();
  assert.match(rowText, /before image[\s\S]*after image/u,
    'the extension message must preserve text order around its image');
  const image = row.locator('img').first();
  await image.waitFor({ timeout: 15_000 });
  await page.waitForFunction(() => {
    const img = document.querySelector('[data-pi-extension-message="pi-gui-compat.image"] img');
    return img?.complete && img.naturalWidth > 0;
  });
  await row.locator('summary').filter({ hasText: '原始扩展详情' }).click();
  assert.match(await row.innerText(), /"image": "sample"[\s\S]*"source": "Pi"/u,
    'the renderer-independent original details must remain accessible');
  const phaseReport = { phase, orderedTextVisible: true, imageDecoded: true, detailsVisible: true };
  report.phases.push(phaseReport);
  await page.screenshot({ path: join(f.output, `pi-custom-message-${phase}.png`) });
  phaseReport.cleanup = await closeOwned(app, f);
  app = undefined;
  assertCleanExit(phaseReport.cleanup, logs, `#25 custom message ${phase}`);
}

try {
  await isolatePiPackage(f);
  await configurePiProfile(f, { url: model.url, modelId: 'pi-native-test', apiKey: 'fixture-not-a-secret' });
  const extensionDir = join(f.env.PI_CODING_AGENT_DIR, 'extensions');
  await mkdir(extensionDir, { recursive: true });
  const extensionPath = fileURLToPath(new URL('../examples/pi-gui-compat/extension.ts', import.meta.url));
  const extensionSource = (await readFile(extensionPath, 'utf8'))
    .replace('"@earendil-works/pi-ai"', JSON.stringify(import.meta.resolve('@earendil-works/pi-ai')))
    .replace('"@earendil-works/pi-tui"', JSON.stringify(import.meta.resolve('@earendil-works/pi-tui')));
  await writeFile(join(extensionDir, 'pi-gui-compat.ts'), extensionSource);
  const originalImage = /const sampleImage = "([^"]+)"/u.exec(extensionSource)?.[1];
  assert(originalImage, 'representative extension must contain its fixed PNG fixture');
  f.env.PI_CODING_AGENT_SESSION_DIR = join(f.sandbox, 'pi-sessions');
  await mkdir(f.env.PI_CODING_AGENT_SESSION_DIR);
  const cli = SessionManager.create(f.workspace, f.env.PI_CODING_AGENT_SESSION_DIR);
  cli.appendMessage({ role: 'user', timestamp: Date.now(), content: 'PI25_BASELINE' });
  // Pi 0.87.0 deliberately keeps a user-only session in memory. A completed
  // fixture turn flushes it to JSONL so the GUI can discover the CLI history.
  cli.appendMessage({ role: 'assistant', timestamp: Date.now(),
    content: [{ type: 'text', text: 'PI25_FIXTURE_READY' }],
    api: 'openai-completions', provider: 'new-provider', model: 'pi-native-test',
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: 'stop' });
  cli.appendSessionInfo('Pi custom message GUI fixture');
  const sessionId = cli.getSessionId();
  const sessionFile = cli.getSessionFile();
  assert(sessionFile);
  const originalJsonl = await readFile(sessionFile);
  report.sessionId = sessionId;
  await openHistory('live', sessionId, true);
  const generatedJsonl = await readFile(sessionFile);
  assert(generatedJsonl.subarray(0, originalJsonl.length).equals(originalJsonl),
    'extension command must append to the same Pi JSONL without rewriting its prefix');
  const entries = generatedJsonl.toString('utf8').trim().split(/\r?\n/u).map(JSON.parse);
  // Pi stores sendMessage() as a custom_message entry. get_messages projects it
  // as role=custom, which is what the native timeline renders above.
  const custom = entries.filter(entry => entry.type === 'custom_message' &&
    entry.customType === 'pi-gui-compat.image');
  assert.equal(custom.length, 1, 'Pi must own exactly one persisted custom message');
  assert.equal(custom[0].display, true);
  assert.deepEqual(custom[0].content.map(part => part.type), ['text', 'image', 'text']);
  assert.deepEqual(custom[0].content.filter(part => part.type === 'text').map(part => part.text),
    ['before image', 'after image']);
  assert.equal(custom[0].content[1].mimeType, 'image/png');
  assert.equal(custom[0].content[1].data, originalImage,
    'Pi JSONL must retain the original PNG base64 without a host substitute');
  assert.deepEqual(custom[0].details, { image: 'sample', source: 'Pi' });
  report.jsonl = { oneCustomMessage: true, prefixUnchanged: true,
    imageSha256: createHash('sha256').update(Buffer.from(originalImage, 'base64')).digest('hex'),
    rawBytes: generatedJsonl.length };
  await openHistory('cold-restart', sessionId, false);
  assert((await readFile(sessionFile)).equals(generatedJsonl),
    'cold Electron restart must preserve every original Pi JSONL byte');
  await verifyPiPackageCleanup(f);
  assert.equal(model.requests.length, 0, 'extension command must not fabricate a model run');
  assert.deepEqual(report.pageErrors, []);
  report.ok = true;
} catch (error) {
  report.error = error instanceof Error ? error.stack : String(error);
  process.exitCode = 1;
  console.error(error);
  const page = app?.windows()[0];
  report.body = (await page?.locator('body').innerText().catch(() => ''))?.slice(-7000);
  await page?.screenshot({ path: join(f.output, 'pi-custom-message-failure.png') }).catch(() => {});
} finally {
  if (app) report.cleanupAfterFailure = await closeOwned(app, f).catch(error => ({ error: String(error) }));
  await model.close();
  await writeFile(join(f.output, 'pi-extension-custom-message-gui-report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
