import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { WorkspaceHost } from './workspace-host.js';
import { diagnosticText, errorMessage, launchProfile } from './validation.js';
import { openLoginTerminal } from './login-terminal.js';

const selectedDataDirectory = app.commandLine.getSwitchValue('user-data-dir');
if (selectedDataDirectory) app.setPath('userData', selectedDataDirectory);
else if (!app.isPackaged && process.env.PI_IDE_USER_DATA) app.setPath('userData', process.env.PI_IDE_USER_DATA);
let host: WorkspaceHost;
let window: BrowserWindow | undefined;
let quitting = false;

async function start(): Promise<void> {
  await app.whenReady();
  const applicationRoot = app.getAppPath();
  const piPath = join(applicationRoot, 'node_modules', '@earendil-works', 'pi-coding-agent', 'dist', 'bundle', 'cli.js');
  host = new WorkspaceHost({
    version: app.getVersion(), settingsPath: join(app.getPath('userData'), 'workbench.json'),
    profile: { executable: process.execPath, args: [piPath] },
  });
  const override = !app.isPackaged && process.env.PI_IDE_TEST_PROFILE ? launchProfile(JSON.parse(process.env.PI_IDE_TEST_PROFILE)) : undefined;
  await host.initialize(override);
  const devUrl = !app.isPackaged ? process.env.PI_IDE_RENDERER_URL : undefined;
  if (devUrl && new URL(devUrl).hostname !== '127.0.0.1') throw new Error('开发界面必须来自 127.0.0.1');
  const pageUrl = devUrl ?? pathToFileURL(join(applicationRoot, 'dist', 'index.html')).href;
  window = new BrowserWindow({
    title: 'Pi Agent IDE', width: 1440, height: 940, minWidth: 1000, minHeight: 680, backgroundColor: '#fafaf8',
    webPreferences: { preload: join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webviewTag: false },
  });
  window.removeMenu();
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  const handle = (channel: string, operation: (...args: unknown[]) => unknown) => {
    ipcMain.handle(channel, async (event, ...args: unknown[]) => {
      if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || event.senderFrame.url !== pageUrl) throw new Error('无效的宿主请求来源');
      try { return await operation(...args); }
      catch (error) { throw new Error(diagnosticText(errorMessage(error))); }
    });
  };
  handle('ide:snapshot', () => host.snapshot());
  handle('ide:open-workspace', path => host.openWorkspace(path));
  handle('ide:choose-workspace', async () => {
    const result = await dialog.showOpenDialog(window!, { title: '选择工作区', properties: ['openDirectory'] });
    return result.canceled || !result.filePaths[0] ? null : host.openWorkspace(result.filePaths[0]);
  });
  handle('ide:save-profile', profile => host.saveProfile(profile));
  handle('ide:create-session', workspaceId => host.createSession(workspaceId));
  handle('ide:send-prompt', (sessionId, message) => host.sendPrompt(sessionId, message));
  handle('ide:close-session', sessionId => host.closeSession(sessionId));
  handle('ide:open-pi-login', workspaceId => openLoginTerminal(host.snapshot().profile, host.getWorkspace(workspaceId).path));
  host.on('change', () => { if (window && !window.isDestroyed()) window.webContents.send('ide:changed', host.snapshot()); });
  await window.loadURL(pageUrl);
}

app.on('window-all-closed', () => app.quit());
app.on('before-quit', event => {
  if (quitting || !host) return;
  event.preventDefault(); quitting = true;
  void host.dispose().catch(error => { console.error(diagnosticText(errorMessage(error))); }).finally(() => app.quit());
});
void start().catch(error => { dialog.showErrorBox('Pi Agent IDE 启动失败', diagnosticText(errorMessage(error))); app.quit(); });
