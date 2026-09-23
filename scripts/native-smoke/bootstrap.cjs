const { app, dialog, shell, utilityProcess } = require('electron');
const { join } = require('node:path');
const { readFileSync } = require('node:fs');
const { pathToFileURL } = require('node:url');
const allowed = new Set(['PATH', 'SYSTEMROOT', 'WINDIR', 'PATHEXT', 'COMSPEC', 'TEMP', 'TMP',
  'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'NODE_OPTIONS',
  'PI_CODING_AGENT_DIR', 'PI_OFFLINE']);
for (const key of Object.keys(process.env)) {
  if (!allowed.has(key.toUpperCase()) && !key.startsWith('NATIVE_SMOKE_') && !key.startsWith('ZCODE_')) delete process.env[key];
}
const { record } = require('./guard.cjs');
const home = process.env.HOME;
// This controlled parity fixture deliberately pins app data; the default-entry regression does not.
process.env.ZCODE_DESKTOP_PROFILE_HOME ??= home;
const fork = utilityProcess.fork.bind(utilityProcess);
utilityProcess.fork = (modulePath, args, options = {}) => {
  const child = fork(join(__dirname, 'utility-bootstrap.cjs'), [modulePath, ...(args ?? [])], { ...options,
    execArgv: options.execArgv,
    env: { ...options.env, ...Object.fromEntries(Object.entries(process.env).filter(([key]) => key.startsWith('NATIVE_SMOKE_'))) },
  });
  child.on('spawn', () => record('utility-child', { pid: child.pid, modulePath }));
  return child;
};
app.setName(process.env.ZCODE_DESKTOP_APPLICATION_NAME);
app.setAppPath(join(process.env.NATIVE_SMOKE_ROOT, 'packages/desktop'));
for (const [name, path] of Object.entries({ home, appData: process.env.APPDATA,
  userData: process.env.ZCODE_DESKTOP_USER_DATA_DIR, sessionData: process.env.ZCODE_DESKTOP_SESSION_DATA_DIR,
  temp: process.env.TEMP, logs: join(home, 'logs'), crashDumps: join(home, 'crashDumps') })) app.setPath(name, path);
for (const method of ['setAsDefaultProtocolClient', 'removeAsDefaultProtocolClient',
  'setLoginItemSettings', 'clearRecentDocuments', 'addRecentDocument', 'setJumpList']) {
  app[method] = (...args) => { record('os-registration-intercepted', { method, args }); return true; };
}
shell.openExternal = async url => { record('open-external-intercepted', { url }); };
dialog.showOpenDialog = async (...args) => {
  const options = args.at(-1);
  if (!options?.properties?.includes('openDirectory')) throw new Error('Unexpected non-directory chooser');
  record('directory-chooser', { properties: options.properties, selected: process.env.NATIVE_SMOKE_WORKSPACE });
  return { canceled: false, filePaths: [process.env.NATIVE_SMOKE_WORKSPACE] };
};
app.on('session-created', ses => {
  ses.webRequest.onBeforeRequest((details, callback) => {
    const url = new URL(details.url);
    const cancel = ['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol)
      && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (cancel) record('chromium-network-blocked', { origin: url.origin, path: url.pathname });
    callback({ cancel });
  });
});
// Do not await ready, and do not bypass the actual production package entry.
const { main } = JSON.parse(readFileSync(join(app.getAppPath(), 'package.json'), 'utf8'));
import(pathToFileURL(join(app.getAppPath(), main)).href).catch(error => {
  console.error(error); app.exit(1);
});
