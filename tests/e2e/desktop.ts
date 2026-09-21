import { _electron, expect, test as base, type ElectronApplication, type Page, type TestInfo } from '@playwright/test';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AppSnapshot, LaunchProfile, SessionSnapshot } from '../../src/shared/contracts.js';

const repository = fileURLToPath(new URL('../../', import.meta.url));
export const fixture = resolve(repository, 'tests/fixtures/workspace-pi.mjs');

interface BoundaryRecord { direction: 'in' | 'out'; record: Record<string, unknown> }

export interface Desktop {
  app: ElectronApplication;
  page: Page;
  root: string;
  workspace: string;
  profile: LaunchProfile;
  snapshot(): Promise<AppSnapshot>;
  screenshot(name: string): Promise<void>;
  release(session: SessionSnapshot, stage: 'start' | 'retry' | 'finish' | 'settle', run?: number): Promise<void>;
  boundary(session?: SessionSnapshot): Promise<BoundaryRecord[]>;
}

async function screenshot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  const path = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path, fullPage: true });
  await testInfo.attach(name, { path, contentType: 'image/png' });
}

export const test = base.extend<{ desktop: Desktop }>({
  // eslint-disable-next-line no-empty-pattern -- this fixture launches Electron, not a Playwright browser/page
  desktop: async ({}, use, testInfo) => {
    const root = testInfo.outputPath('sandbox');
    const workspace = join(root, '工作区 with spaces');
    const userData = join(root, 'electron-user-data');
    const agentDir = join(root, 'pi-agent');
    const control = join(root, 'fixture-control');
    await Promise.all([workspace, userData, agentDir, control].map((path) => mkdir(path, { recursive: true })));
    const profile: LaunchProfile = {
      executable: process.execPath,
      args: [fixture, `--fixture-control-dir=${control}`],
      agentDir,
    };
    const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined));
    // Playwright's Electron launcher must start the GUI, not Electron's Node mode.
    for (const key of Object.keys(env)) {
      if (key.toUpperCase() === 'ELECTRON_RUN_AS_NODE') delete env[key];
    }
    Object.assign(env, {
      PI_IDE_USER_DATA: userData,
      PI_IDE_TEST_PROFILE: JSON.stringify(profile),
      PI_CODING_AGENT_DIR: agentDir,
      PI_OFFLINE: '1', PI_TELEMETRY: '0',
    });

    const boundary = async (session?: SessionSnapshot): Promise<BoundaryRecord[]> => {
      const names = session ? [`${session.pid}.jsonl`] : (await readdir(control)).filter((name) => name.endsWith('.jsonl'));
      const records: BoundaryRecord[] = [];
      for (const name of names) {
        const text = await readFile(join(control, name), 'utf8').catch((error: NodeJS.ErrnoException) => {
          if (error.code === 'ENOENT') return '';
          throw error;
        });
        // Ignore an incomplete last line while the external process is writing.
        records.push(...text.split('\n').slice(0, -1).filter(Boolean).map((line) => JSON.parse(line) as BoundaryRecord));
      }
      return records;
    };
    let app: ElectronApplication | undefined;
    let page: Page | undefined;
    let tracing = false;
    const logs: string[] = [];
    try {
      app = await _electron.launch({ args: ['.'], cwd: repository, env, timeout: 30_000 });
      app.process().stdout?.on('data', (chunk: Buffer) => logs.push(`[host stdout] ${chunk}`));
      app.process().stderr?.on('data', (chunk: Buffer) => logs.push(`[host stderr] ${chunk}`));
      await app.context().tracing.start({ screenshots: true, snapshots: true, sources: true });
      tracing = true;
      page = await app.firstWindow();
      page.on('console', (message) => logs.push(`[renderer ${message.type()}] ${message.text()}`));
      page.on('pageerror', (error) => logs.push(`[renderer error] ${error.message}`));
      await page.setViewportSize({ width: 1280, height: 800 });
      expect(await app.evaluate(({ app }) => app.isPackaged)).toBe(false);
      await expect(page.getByRole('textbox', { name: '工作区路径', exact: true })).toBeVisible();
      const renderer = page;
      await use({
        app, page, root, workspace, profile,
        // Read-only public IPC is supplemental evidence; all user intents go
        // through visible controls, never API calls or injected renderer state.
        snapshot: () => renderer.evaluate(() => window.piIde.snapshot()),
        screenshot: (name) => screenshot(renderer, testInfo, name),
        release: async (session, stage, run = 1) => {
          expect(session.pid, 'a live session must expose its independent RPC PID').toBeGreaterThan(0);
          await writeFile(join(control, `${session.pid}-${run}-${stage}`), 'release\n');
        },
        boundary,
      });
    } finally {
      try {
        const failed = testInfo.status !== testInfo.expectedStatus;
        if (page && !page.isClosed()) {
          try {
            await screenshot(page, testInfo, failed ? 'failure' : 'final');
            await testInfo.attach('app-snapshot', {
              body: JSON.stringify(await page.evaluate(() => window.piIde.snapshot()), null, 2),
              contentType: 'application/json',
            });
          } catch (error) {
            logs.push(`[evidence capture] ${String(error)}`);
          }
        }
        if (app && tracing) {
          const path = testInfo.outputPath('trace.zip');
          await app.context().tracing.stop(failed ? { path } : {});
          if (failed) await testInfo.attach('trace', { path, contentType: 'application/zip' });
        }
      } finally {
        try { await app?.close(); }
        finally {
          const path = testInfo.outputPath('rpc-boundary.json');
          await writeFile(path, JSON.stringify(await boundary(), null, 2));
          await testInfo.attach('rpc-boundary', { path, contentType: 'application/json' });
          await testInfo.attach('electron-log', { body: logs.join('\n'), contentType: 'text/plain' });
          await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
        }
      }
    }
  },
});

export { expect };

export async function openWorkspace(desktop: Desktop, path = desktop.workspace): Promise<void> {
  await desktop.page.getByRole('textbox', { name: '工作区路径', exact: true }).fill(path);
  await desktop.page.getByRole('button', { name: '打开工作区', exact: true }).click();
  await expect.poll(async () => (await desktop.snapshot()).workspaces.some((workspace) => workspace.path === path)).toBe(true);
}

export async function createSession(desktop: Desktop): Promise<SessionSnapshot> {
  const before = (await desktop.snapshot()).sessions.map((session) => session.id);
  await desktop.page.getByRole('button', { name: '新建会话', exact: true }).click();
  await expect.poll(async () => (await desktop.snapshot()).sessions.filter((session) => !before.includes(session.id)).length).toBe(1);
  const session = (await desktop.snapshot()).sessions.find((session) => !before.includes(session.id))!;
  await expect.poll(async () => (await sessionSnapshot(desktop, session.id)).phase).toBe('idle');
  return sessionSnapshot(desktop, session.id);
}

export async function sessionSnapshot(desktop: Desktop, id: string): Promise<SessionSnapshot> {
  const session = (await desktop.snapshot()).sessions.find((session) => session.id === id);
  if (!session) throw new Error(`Session ${id} disappeared from the public snapshot`);
  return session;
}

export async function sendPrompt(desktop: Desktop, message: string): Promise<void> {
  await desktop.page.getByRole('textbox', { name: '消息', exact: true }).fill(message);
  await desktop.page.getByRole('button', { name: '发送', exact: true }).click();
}

export async function saveProfile(desktop: Desktop, profile: LaunchProfile): Promise<void> {
  const executable = desktop.page.getByRole('textbox', { name: 'Pi 可执行文件', exact: true });
  if (!await executable.isVisible()) {
    await desktop.page.getByText('运行配置', { exact: true }).click();
  }
  await executable.fill(profile.executable);
  await desktop.page.getByRole('textbox', { name: 'Pi 参数（JSON 数组）', exact: true }).fill(JSON.stringify(profile.args));
  await desktop.page.getByRole('textbox', { name: 'Pi 配置目录', exact: true }).fill(profile.agentDir ?? '');
  await desktop.page.getByRole('button', { name: '保存启动配置', exact: true }).click();
  await expect.poll(async () => (await desktop.snapshot()).profile).toEqual(profile);
}

export async function finishRun(desktop: Desktop, session: SessionSnapshot): Promise<void> {
  for (const stage of ['start', 'finish', 'settle'] as const) await desktop.release(session, stage);
  await expect(desktop.page.getByTestId('run-phase')).toHaveText('已完成');
  await expect.poll(async () => (await sessionSnapshot(desktop, session.id)).phase).toBe('settled');
}
