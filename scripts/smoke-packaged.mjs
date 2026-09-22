import { _electron, expect } from '@playwright/test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

if (process.platform !== 'win32') throw new Error('This acceptance checks the Windows package on Windows.');
const output = resolve('test-results/package');
await mkdir(output, { recursive: true });
const sandbox = await mkdtemp(join(output, 'smoke-'));
const userData = join(sandbox, 'user-data');
const workspace = join(sandbox, '工作区 with spaces');
const agentDir = join(sandbox, 'pi');
await Promise.all([userData, workspace, agentDir].map(path => mkdir(path, { recursive: true })));
const allowed = new Set(['PATH', 'SYSTEMROOT', 'WINDIR', 'PATHEXT', 'COMSPEC', 'TEMP', 'TMP']);
const env = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => allowed.has(key.toUpperCase()) && value !== undefined));
Object.assign(env, { HOME: sandbox, USERPROFILE: sandbox, APPDATA: join(sandbox, 'AppData'), LOCALAPPDATA: join(sandbox, 'LocalAppData'), PI_CODING_AGENT_DIR: agentDir, PI_OFFLINE: '1', PI_TELEMETRY: '0', AWS_EC2_METADATA_DISABLED: 'true' });
let application;
try {
  application = await _electron.launch({ executablePath: resolve('release/win-unpacked/Pi Agent IDE.exe'), args: [`--user-data-dir=${userData}`], env });
  const page = await application.firstWindow();
  await page.setViewportSize({ width: 1280, height: 800 });
  expect(await application.evaluate(({ app }) => app.isPackaged)).toBe(true);
  expect(await application.evaluate(({ app }) => app.getPath('userData'))).toBe(userData);
  await page.getByRole('textbox', { name: '工作区路径', exact: true }).fill(workspace);
  await page.getByRole('button', { name: '打开工作区', exact: true }).click();
  await page.getByRole('button', { name: '新建会话', exact: true }).click();
  await expect(page.getByTestId('run-phase')).toHaveText('就绪', { timeout: 30_000 });
  const snapshot = await page.evaluate(() => window.piIde.snapshot());
  expect(snapshot.sessions[0].piVersion).toBe('0.87.0');
  expect(snapshot.sessions[0].nativeSessionId).toBeTruthy();
  expect(snapshot.sessions[0].pid).toBeGreaterThan(0);
  expect(snapshot.profile.args[0]).toContain('app.asar');
  await page.screenshot({ path: join(output, 'real-pi-packaged-ready.png'), fullPage: true });
  await page.getByRole('textbox', { name: '消息', exact: true }).fill('Credential-free package acceptance');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect(page.getByTestId('session-error')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('run-phase')).not.toHaveText('已完成');
  await page.screenshot({ path: join(output, 'real-pi-auth-recovery.png'), fullPage: true });
  await writeFile(join(output, 'result.json'), JSON.stringify({ passed: true, platform: process.platform, node: process.version, packaged: true, realPi: true, realModel: false, snapshot: await page.evaluate(() => window.piIde.snapshot()) }, null, 2));
  console.log('PASS: packaged Windows app → bundled real Pi 0.87.0 → native session; missing authentication is recoverable. No real model call.');
} finally {
  await application?.close();
  await rm(sandbox, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
