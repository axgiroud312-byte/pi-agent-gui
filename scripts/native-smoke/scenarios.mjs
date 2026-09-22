import assert from 'node:assert/strict';
import { composer } from './composer.mjs';
import { panels } from './panels.mjs';
import { navigation } from './navigation.mjs';

async function configureModel(page, f, e) {
  await page.getByTestId('task-settings-button').filter({ visible: true }).click();
  await page.getByRole('button', { name: '模型设置', exact: true }).click();
  await e.branding();
  if (f.baseline === 'product') {
    // Keeping a user's provider API key is distinct from retaining a vendor app account.
    await page.getByRole('button', { name: 'BigModel Coding Plan', exact: true }).click();
    await page.getByTestId('model-provider-api-key-input').waitFor({ state: 'visible' });
    assert.equal(await page.getByTestId('model-provider-api-key-input').isEditable(), true);
    assert.equal(await page.getByTestId('login-menu-item').isVisible(), false);
    await e.branding();
    await e.shot('provider-byok-preserved');
  }
  await page.getByTestId('model-provider-add-provider-button').click();
  await e.branding();
  await e.shot('model-templates');
  await page.getByRole('button', { name: '创建自定义供应商', exact: true }).click();
  await page.getByTestId('model-provider-base-url-input').fill(f.model.url);
  await page.getByTestId('model-provider-api-key-input').fill('parity-fixture-not-a-secret');
  await page.getByTestId('model-provider-api-format-trigger').click();
  await page.getByRole('option', { name: /Chat Completions/ }).click();
  await page.getByTestId('model-provider-add-model-button').click();
  await page.getByPlaceholder('模型 ID', { exact: true }).fill('parity-controlled');
  await page.getByRole('dialog').getByRole('button', { name: '保存', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  await page.getByText('parity-controlled', { exact: true }).waitFor();
  await e.shot('model-settings');
  await page.getByTestId('settings-back-button').click();
  await page.getByTestId('settings-page').waitFor({ state: 'hidden' });
  await page.getByTestId('chat-model-select-trigger').click();
  await page.getByRole('menuitem', { name: '新供应商', exact: true }).hover();
  await page.getByText('parity-controlled', { exact: true }).click();
  assert.match(await page.getByTestId('chat-model-select-trigger').innerText(), /parity-controlled/);
}

export async function send(page, text) {
  const input = page.getByTestId('v4-composer-input').filter({ visible: true }).first();
  await input.click();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.type(text);
  await page.getByTestId('v4-composer-send').filter({ visible: true }).first().click();
}

export async function scenarios(page, f, e) {
  await e.action('Workspace: Add project → Open folder → isolated OS chooser → real Git workspace', async () => {
    await page.getByRole('button', { name: '添加项目', exact: true }).click();
    await page.getByRole('menuitem', { name: '打开文件夹', exact: true }).click();
    await page.getByTestId('composer-workspace-trigger').filter({ hasText: 'parity-workspace' }).waitFor();
    await e.shot('workspace');
  });
  await e.action('Settings: generic provider → loopback URL/key → Chat Completions → model → composer selection', () => configureModel(page, f, e));
  await e.action('Empty workbench and appearance: native theme controls, both window sizes', async () => {
    await e.matrix('empty', async () => assert.equal((await page.getByTestId('v4-composer-input').innerText()).trim(), ''));
  });
  await composer(page, f, e);
  await e.action('Native Agent: send → controlled SSE → running timeline, both themes/sizes', async () => {
    await send(page, 'PARITY_RUNNING');
    await page.getByText('CONTROLLED_NATIVE_REPLY:', { exact: false }).first().waitFor({ timeout: 45_000 });
    await e.matrix('running', async () => assert(await page.getByRole('button', { name: '停止生成', exact: true }).isVisible()));
    assert(f.model.requests.some(r => r.scenario === 'PARITY_RUNNING' && r.stream));
    f.model.release();
    await page.getByRole('button', { name: '停止生成', exact: true }).waitFor({ state: 'hidden', timeout: 20_000 });
    await e.shot('settled');
  });
  await panels(page, f, e);
  await e.action('Native Agent: controlled Read tool → real file result → native tool timeline', async () => {
    await send(page, 'PARITY_READ');
    await page.getByText('PARITY_READ_COMPLETE', { exact: false }).first().waitFor({ timeout: 30_000 });
    await page.getByRole('button', { name: '停止生成', exact: true }).waitFor({ state: 'hidden' });
    assert(f.model.requests.some(r => r.toolResults?.some(t => t.content.includes('NATIVE_PARITY_PREVIEW'))), 'Native Read returns real fixture content');
    const history = page.locator('[data-testid^="chat-assistant-history-trigger-"]').last();
    await page.waitForTimeout(350);
    if (await history.getAttribute('data-history-open') === 'true') await history.click();
    await history.and(page.locator('[data-history-open="false"]')).waitFor();
    await page.getByText('读取', { exact: true }).waitFor({ state: 'hidden' });
    await history.click();
    await history.and(page.locator('[data-history-open="true"]')).waitFor();
    await page.getByText('读取', { exact: true }).waitFor();
    await page.waitForTimeout(350);
    await e.shot('read-tool-expanded');
    await history.click();
    await history.and(page.locator('[data-history-open="false"]')).waitFor();
    await page.getByText('读取', { exact: true }).waitFor({ state: 'hidden' });
    await e.shot('read-tool-collapsed');
  });
  await e.action('Native Agent: AskUserQuestion → real waiting UI → choose answer', async () => {
    await send(page, 'PARITY_WAIT');
    await page.getByText('PARITY_QUESTION: choose a fixture option?', { exact: true }).waitFor({ timeout: 30_000 });
    await e.matrix('waiting', async () => assert(await page.getByText('PARITY_QUESTION: choose a fixture option?', { exact: true }).isVisible()));
    await page.getByText('Fixture A', { exact: true }).click();
    await page.getByText('PARITY_WAIT_COMPLETE', { exact: true }).waitFor({ timeout: 20_000 });
    assert(f.model.requests.some(r => r.toolResults?.some(t => t.content.includes('Fixture A'))));
    await e.shot('wait-answered');
  });
  await e.action('Native Agent: controlled HTTP 400 → visible error → recovery by a fresh prompt', async () => {
    await send(page, 'PARITY_ERROR');
    await page.getByText(/PARITY_CONTROLLED_ERROR/).first().waitFor({ timeout: 25_000 });
    await e.matrix('error', async () => assert(await page.getByText(/PARITY_CONTROLLED_ERROR/).first().isVisible()));
    await send(page, 'PARITY_RECOVER');
    await page.getByText('PARITY_RECOVER_COMPLETE', { exact: true }).waitFor({ timeout: 25_000 });
    await e.shot('error-recovered');
  });
  await e.action('Native stop button → abort held loopback stream → composer ready', async () => {
    await send(page, 'PARITY_RUNNING_STOP');
    for (let i = 0; i < 80 && f.model.held === 0; i++) await page.waitForTimeout(100);
    assert(f.model.held > 0, 'Native request must reach the controlled held stream');
    await e.shot('before-stop');
    await page.getByRole('button', { name: '停止生成', exact: true }).click();
    await page.getByRole('button', { name: '停止生成', exact: true }).waitFor({ state: 'hidden' });
    for (let i = 0; i < 50 && f.model.held > 0; i++) await page.waitForTimeout(100);
    assert.equal(f.model.held, 0, 'Stopping in the GUI must cancel the HTTP stream');
    await e.shot('stopped');
  });
  await navigation(page, f, e);
}
