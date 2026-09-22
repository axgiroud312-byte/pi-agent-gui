import { join } from 'node:path';
import {
  createSession, expect, finishRun, openWorkspace, saveProfile, sendPrompt,
  sessionSnapshot, test,
} from './desktop.js';

test('text acceptance and agent_end stay unfinished until agent_settled; final Unicode message wins', async ({ desktop }) => {
  const { page } = desktop;
  await openWorkspace(desktop);
  const session = await createSession(desktop);
  expect(session.piVersion).toBe('0.87.0');
  const text = '请回答：你好🌍\n第二行\u2028分隔\u2029尾声';
  await sendPrompt(desktop, text);
  await expect(page.getByTestId('run-phase')).toHaveText('已接收');
  await expect(page.getByText('流式片段：', { exact: false })).not.toBeVisible();
  await desktop.screenshot('01-accepted-not-settled');

  await desktop.release(session, 'start');
  await expect(page.getByTestId('run-phase')).toHaveText('运行中');
  await expect(page.getByText('流式片段：', { exact: false })).toBeVisible();
  await desktop.screenshot('02-streaming');

  await desktop.release(session, 'finish');
  await expect(page.getByText('权威回复：', { exact: false })).toBeVisible();
  await expect(page.getByText('流式片段：', { exact: false })).not.toBeVisible();
  await expect.poll(async () => (await desktop.boundary(session)).some(({ record }) => record.type === 'agent_end')).toBe(true);
  await expect(page.getByTestId('run-phase')).toHaveText('运行中');
  expect((await desktop.boundary(session)).some(({ record }) => record.type === 'agent_settled')).toBe(false);
  await desktop.screenshot('03-agent-end-not-settled');

  await desktop.release(session, 'settle');
  await expect(page.getByTestId('run-phase')).toHaveText('已完成');
  const result = await sessionSnapshot(desktop, session.id);
  expect(result.phase).toBe('settled');
  const users = result.messages.filter((message) => message.role === 'user');
  const assistants = result.messages.filter((message) => message.role === 'assistant');
  expect(users).toHaveLength(1);
  expect(users[0]!.content).toEqual([{ type: 'text', text }]);
  expect(assistants).toHaveLength(1);
  expect(assistants[0]!.content).toEqual([{ type: 'text', text: `权威回复：${text} · 中文🙂\u2028行\u2029段 · 已校正 ✓` }]);
  expect((await desktop.boundary(session)).filter(({ direction, record }) => direction === 'in' && record.type === 'prompt')).toHaveLength(1);
  await desktop.screenshot('04-settled');
});

test('authentication failure is visible and a corrected prompt recovers without replay', async ({ desktop }) => {
  await openWorkspace(desktop);
  const session = await createSession(desktop);
  await sendPrompt(desktop, 'fail');
  await expect(desktop.page.getByTestId('session-error')).toContainText(/API key|认证|auth/i);
  await expect(desktop.page.getByTestId('run-phase')).not.toHaveText('已完成');
  await desktop.screenshot('authentication-error');

  await sendPrompt(desktop, '修正输入后继续');
  await finishRun(desktop, session);
  await expect(desktop.page.getByText('权威回复：修正输入后继续', { exact: false })).toBeVisible();
  expect((await sessionSnapshot(desktop, session.id)).error).toBeFalsy();
  const prompts = (await desktop.boundary(session)).filter(({ direction, record }) => direction === 'in' && record.type === 'prompt');
  expect(prompts.map(({ record }) => record.message)).toEqual(['fail', '修正输入后继续']);
  await desktop.screenshot('recovered-after-rejection');
});

test('automatic retry and its successful reply remain unfinished until settlement', async ({ desktop }) => {
  await openWorkspace(desktop);
  const session = await createSession(desktop);
  await sendPrompt(desktop, 'retry');
  await desktop.release(session, 'start');
  await expect.poll(async () => (await sessionSnapshot(desktop, session.id)).phase).toBe('retrying');
  await expect(desktop.page.getByTestId('run-phase')).not.toHaveText('已完成');
  await desktop.screenshot('automatic-retry');

  await desktop.release(session, 'retry');
  await expect(desktop.page.getByText('流式片段：', { exact: false })).toBeVisible();
  await desktop.release(session, 'finish');
  await expect(desktop.page.getByText('权威回复：', { exact: false })).toBeVisible();
  await expect.poll(async () => (await desktop.boundary(session)).some(({ record }) => record.type === 'auto_retry_end')).toBe(true);
  await expect(desktop.page.getByTestId('run-phase')).not.toHaveText('已完成');
  await desktop.screenshot('retry-ended-not-settled');
  await desktop.release(session, 'settle');
  await expect(desktop.page.getByTestId('run-phase')).toHaveText('已完成');
});

test('an invalid workspace is diagnosed and the path can be corrected', async ({ desktop }) => {
  const { page } = desktop;
  await page.getByRole('textbox', { name: '工作区路径', exact: true }).fill(join(desktop.root, 'does-not-exist'));
  await page.getByRole('button', { name: '打开工作区', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: /目录|工作区|ENOENT|directory/i })).toBeVisible();
  expect((await desktop.snapshot()).workspaces).toHaveLength(0);
  await desktop.screenshot('invalid-workspace');
  await openWorkspace(desktop);
  const session = await createSession(desktop);
  await sendPrompt(desktop, '目录修正后继续');
  await finishRun(desktop, session);
  await expect(page.getByText('权威回复：目录修正后继续', { exact: false })).toBeVisible();
});

for (const problem of ['missing-executable', 'incompatible-version'] as const) {
  test(`${problem} is diagnosed; saving a corrected launch profile restores sessions`, async ({ desktop }) => {
    await openWorkspace(desktop);
    const invalid = problem === 'missing-executable'
      ? { ...desktop.profile, executable: join(desktop.root, 'missing-pi.exe') }
      : { ...desktop.profile, args: [...desktop.profile.args, '--fixture-version=0.86.0'] };
    await saveProfile(desktop, invalid);
    await desktop.page.getByRole('button', { name: '新建会话', exact: true }).click();
    const diagnostic = problem === 'missing-executable' ? /ENOENT|可执行|启动|spawn|找不到/i : /0\.86\.0|版本|version/i;
    await expect(desktop.page.getByRole('alert').filter({ hasText: diagnostic })).toBeVisible();
    await desktop.screenshot(problem);

    await saveProfile(desktop, desktop.profile);
    const session = await createSession(desktop);
    await sendPrompt(desktop, `配置已修正：${problem}`);
    await finishRun(desktop, session);
    await expect(desktop.page.getByText(`权威回复：配置已修正：${problem}`, { exact: false })).toBeVisible();
    await desktop.screenshot(`${problem}-recovered`);
  });
}

test('one RPC process crash leaves an independent background session running and able to settle', async ({ desktop }) => {
  await openWorkspace(desktop);
  const healthy = await createSession(desktop);
  await sendPrompt(desktop, '独立会话继续工作');
  await desktop.release(healthy, 'start');
  await expect(desktop.page.getByText('流式片段：独立会话继续工作', { exact: false })).toBeVisible();

  const crashing = await createSession(desktop);
  expect(crashing.pid).not.toBe(healthy.pid);
  expect(crashing.generation).not.toBe(healthy.generation);
  await sendPrompt(desktop, 'crash');
  await expect(desktop.page.getByTestId('session-error')).toContainText(/退出|崩溃|exit|crash|43/i);
  await expect.poll(async () => (await sessionSnapshot(desktop, crashing.id)).phase).toMatch(/error|exited/);
  expect((await sessionSnapshot(desktop, healthy.id)).phase).toBe('running');
  expect((await sessionSnapshot(desktop, healthy.id)).error).toBeFalsy();
  await desktop.screenshot('crash-isolated');

  await desktop.release(healthy, 'finish');
  await desktop.release(healthy, 'settle');
  await expect.poll(async () => (await sessionSnapshot(desktop, healthy.id)).phase).toBe('settled');
  const result = await sessionSnapshot(desktop, healthy.id);
  expect(result.messages.filter((message) => message.role === 'assistant')).toHaveLength(1);
  expect(result.messages.some((message) => message.content.some((part) => part.text?.includes('crash')))).toBe(false);
  expect(desktop.app.process().exitCode).toBeNull();
  await expect(desktop.page.getByTestId('session-error')).toBeVisible();
  expect((await sessionSnapshot(desktop, crashing.id)).generation).toBe(crashing.generation);
  const crashedPrompts = (await desktop.boundary()).filter(({ direction, record }) => direction === 'in' && record.type === 'prompt' && record.message === 'crash');
  expect(crashedPrompts.map(({ record }) => record.message)).toEqual(['crash']);
});

test('handled extension input remains usable and credential errors are redacted over IPC', async ({ desktop }) => {
  await openWorkspace(desktop);
  const session = await createSession(desktop);
  await sendPrompt(desktop, '/handled');
  await expect(desktop.page.getByTestId('run-phase')).toHaveText('就绪');
  await sendPrompt(desktop, 'secret-error');
  await expect(desktop.page.getByTestId('session-error')).toContainText('[redacted]');
  await expect(desktop.page.getByTestId('session-error')).not.toContainText('SYNTHETIC_');
  expect((await sessionSnapshot(desktop, session.id)).canSubmit).toBe(true);
  await desktop.screenshot('handled-input-and-redacted-error');
});
