// Native Settings -> Pi models.json/auth.json -> original model menu -> fixed Pi RPC.
import assert from 'node:assert/strict';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixture } from './native-smoke/fixture.mjs';
import { closeOwned, assertCleanExit } from './native-smoke/cleanup.mjs';
import { startPiModel } from './native-smoke/pi-model.mjs';
import { isolatePiPackage } from './native-smoke/pi-package.mjs';

const f = await fixture();
await isolatePiPackage(f);
const packaged = process.env.NATIVE_PI_PACKAGED_EXE;
if (packaged) {
  f.electronPath = packaged;
  f.workspace = join(f.home, '.zcode/workspace/default');
  await mkdir(f.workspace, { recursive: true });
  f.env.ZCODE_DESKTOP_PROFILE_HOME = f.home;
  delete f.env.NODE_OPTIONS;
}
const model = await startPiModel();
const profile = join(f.sandbox, 'pi-profile');
await mkdir(profile);
Object.assign(f.env, { PI_CODING_AGENT_DIR: profile, PI_OFFLINE: '1', PI_SKIP_VERSION_CHECK: '1' });
await writeFile(join(profile, 'settings.json'), JSON.stringify({ cacheWarming: 'off', enableInstallTelemetry: false }));
const modelsPath = join(profile, 'models.json');
const secret = 'fixture-only-unified-model-settings-key';
const logs = [];
const report = { at: new Date().toISOString(), executable: f.electronPath, packaged: Boolean(packaged),
  boundary: 'native GUI -> Host -> fixed Pi 0.87.0; controlled local provider, no online provider', stages: {}, pageErrors: [] };
let app;
const optionalRead = path => readFile(path, 'utf8').catch(error => { if (error.code === 'ENOENT') return null; throw error; });
try {
  app = await f.playwright._electron.launch({ executablePath: f.electronPath,
    args: packaged ? ['--lang=zh-CN'] : [fileURLToPath(new URL('./native-smoke/bootstrap.cjs', import.meta.url)), '--lang=zh-CN'],
    cwd: packaged ? f.sandbox : f.root, env: f.env, timeout: 60_000 });
  app.process().stdout?.on('data', data => logs.push(String(data)));
  app.process().stderr?.on('data', data => logs.push(String(data)));
  const page = await app.firstWindow();
  page.setDefaultTimeout(20_000);
  page.on('pageerror', error => report.pageErrors.push(error.message));
  await page.waitForTimeout(6000);
  for (const name of [/^(使用 API key|Use API key)$/, /^(暂时跳过|Skip for now)$/, /^(退出引导|Exit onboarding)$/]) {
    const button = page.getByRole('button', { name, exact: true });
    if (await button.isVisible()) { await button.click(); await page.waitForTimeout(1200); }
  }
  if (!packaged) {
    await page.getByRole('button', { name: '添加项目', exact: true }).click();
    await page.getByRole('menuitem', { name: '打开文件夹', exact: true }).click();
  }
  await page.getByTestId('sidebar').getByTestId('task-settings-button').click();
  await page.getByRole('button', { name: '模型设置', exact: true }).click();
  const settings = page.getByTestId('pi-model-settings-section');
  await settings.waitFor();
  assert.equal(await page.getByRole('button', { name: 'Pi 认证', exact: true }).count(), 0);
  assert.equal(await page.getByTestId('model-provider-add-provider-button').count(), 0);
  const legacyPath = join(f.home, '.zcode/v2/provider_config.json');
  const legacyBefore = await optionalRead(legacyPath);
  await settings.getByRole('button', { name: '添加提供商', exact: true }).click();
  await settings.getByLabel('提供商 ID', { exact: true }).fill('unified-fixture');
  await settings.getByLabel('API 地址', { exact: true }).fill(model.url);
  await settings.getByLabel('模型 ID（每行一个）', { exact: true }).fill('pi-native-test');
  await settings.getByRole('button', { name: '保存模型配置', exact: true }).click();
  await settings.getByRole('heading', { name: 'unified-fixture', exact: true }).waitFor();
  assert.equal(JSON.parse(await readFile(modelsPath, 'utf8')).providers['unified-fixture'].baseUrl, model.url);
  report.stages.savedToPiModels = true;
  await settings.getByRole('button', { name: /API key.*登录/i }).click();
  await settings.getByTestId('pi-auth-answer').fill(secret);
  await settings.getByRole('button', { name: '继续', exact: true }).click();
  await settings.getByText('状态：saved', { exact: true }).waitFor();
  assert((await readFile(join(profile, 'auth.json'), 'utf8')).includes(secret));
  assert(!(await page.locator('body').innerText()).includes(secret));
  await settings.getByTestId('pi-provider-model-list').getByText(/unified-fixture\/pi-native-test/).waitFor();
  report.stages.authAndCatalogUnified = true;
  await page.screenshot({ path: join(f.output, 'unified-provider.png') });

  await settings.getByRole('button', { name: '编辑模型配置', exact: true }).click();
  const original = JSON.parse(await readFile(modelsPath, 'utf8'));
  await writeFile(modelsPath, JSON.stringify({ ...original, providers: { ...original.providers,
    'unified-fixture': { ...original.providers['unified-fixture'], headers: { 'x-test': 'keep-external' } } } }));
  await settings.getByLabel('模型 ID（每行一个）', { exact: true }).fill('pi-native-test\nsecond-model');
  await settings.getByRole('button', { name: '保存模型配置', exact: true }).click();
  await settings.getByText(/Pi 模型配置已在外部改变/).waitFor();
  assert.equal(JSON.parse(await readFile(modelsPath, 'utf8')).providers['unified-fixture'].models.length, 1);
  report.stages.externalEditConflict = true;
  await settings.getByRole('button', { name: '放弃修改并重新读取', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#pi-provider-models')?.value === 'pi-native-test');
  await settings.getByLabel('模型 ID（每行一个）', { exact: true }).fill('pi-native-test\nsecond-model');
  await settings.getByRole('button', { name: '保存模型配置', exact: true }).click();
  await settings.getByRole('button', { name: '编辑模型配置', exact: true }).waitFor();
  assert.equal(JSON.parse(await readFile(modelsPath, 'utf8')).providers['unified-fixture'].headers['x-test'], 'keep-external');
  report.stages.retainedAdvancedFields = true;
  await settings.getByText('高级 Pi 设置（用户 / 项目）', { exact: true }).click();
  await settings.getByTestId('pi-settings-json').waitFor();
  report.stages.advancedSettingsAccessible = true;
  await page.getByTestId('settings-back-button').click();
  await page.getByTestId('chat-model-select-trigger').click();
  await page.getByTestId('chat-model-select-search').fill('pi-native-test');
  await page.getByRole('menuitemradio', { name: /pi-native-test/ }).first().click();
  await page.getByTestId('v4-composer-input').filter({ visible: true }).first().fill('PI_TEXT: unified model settings');
  model.releaseText();
  await page.getByTestId('v4-composer-send').filter({ visible: true }).first().click();
  await page.getByText('PI_TEXT_COMPLETE', { exact: true }).waitFor({ timeout: 30_000 });
  const sessions = join(profile, 'sessions');
  const files = (await readdir(sessions, { recursive: true })).filter(path => path.endsWith('.jsonl'));
  const history = (await Promise.all(files.map(file => readFile(join(sessions, file), 'utf8')))).join('\n');
  assert(history.includes('unified-fixture') && history.includes('PI_TEXT_COMPLETE'));
  assert.equal(await optionalRead(legacyPath), legacyBefore, 'Pi settings must not edit the old provider store');
  report.stages.piReplyAndLegacyStoreUnchanged = true;
  await page.screenshot({ path: join(f.output, 'unified-model-reply.png') });
  await page.getByTestId('chat-model-select-trigger').click();
  await page.getByRole('menuitem', { name: '管理模型', exact: true }).click();
  await settings.waitFor();
  report.stages.manageModelsSamePage = true;
  assert.deepEqual(report.pageErrors, []);
} catch (error) {
  report.error = String(error.stack || error).split(secret).join('[redacted]');
  process.exitCode = 1;
  await app?.windows()[0]?.screenshot({ path: join(f.output, 'failure.png') }).catch(() => {});
} finally {
  try { report.cleanup = await closeOwned(app, f); assertCleanExit(report.cleanup, logs, 'unified model settings'); }
  catch (error) { report.cleanupError = String(error); process.exitCode = 1; }
  await model.close();
  await writeFile(join(f.output, 'pi-model-settings-gui-report.json'), JSON.stringify(report, null, 2));
  await writeFile(join(f.output, 'runtime.log'), logs.join('\n').split(secret).join('[redacted]'));
  console.log(JSON.stringify(report, null, 2));
}
