// Test-only OS setup. No application data/profile env is supplied; package.main must select it.
const { app, shell, utilityProcess } = require('electron');
const fs = require('node:fs');
const { homedir } = require('node:os');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');
const { record } = require('./profile-file-guard.cjs');
const root = process.env.PROFILE_ENTRY_APP_ROOT;
const home = process.env.HOME;
if (process.env.ZCODE_DATA_BASE_DIR || process.env.ZCODE_DESKTOP_PROFILE_HOME) throw new Error('Default entry test received a data-root override');
process.env.NODE_OPTIONS = `--require=${JSON.stringify(join(__dirname, 'profile-file-guard.cjs').replaceAll('\\', '/'))}`;
app.setAppPath(root);
for (const [key, value] of Object.entries({ home, appData: process.env.APPDATA, userData: join(home, 'electron'), sessionData: join(home, 'electron-session'), logs: join(home, 'logs'), crashDumps: join(home, 'crashDumps'), temp: process.env.TEMP })) app.setPath(key, value);
for (const name of ['setAsDefaultProtocolClient', 'removeAsDefaultProtocolClient', 'setLoginItemSettings', 'clearRecentDocuments', 'addRecentDocument', 'setJumpList']) app[name] = (...args) => { record('os-registration-intercepted', { name, args }); return true; };
shell.openExternal = async (url) => { record('open-external-intercepted', { url }); };
const fork = utilityProcess.fork.bind(utilityProcess);
utilityProcess.fork = (entry, args, options = {}) => {
  const child = fork(join(__dirname, 'profile-utility-bootstrap.cjs'), [entry, ...(args || [])], {
    ...options, env: { ...(options.env ?? process.env), NODE_OPTIONS: process.env.NODE_OPTIONS,
      ...Object.fromEntries(Object.entries(process.env).filter(([key]) => key.startsWith('NATIVE_SMOKE_'))) },
  });
  child.on('spawn', () => record('utility-child', { pid: child.pid, modulePath: entry }));
  return child;
};
app.on('session-created', session => session.webRequest.onBeforeRequest((details, callback) => {
  const url = new URL(details.url);
  const cancel = ['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol) && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (cancel) record('chromium-network-blocked', { origin: url.origin, path: url.pathname });
  callback({ cancel });
}));
globalThis.__profileEntryFacts = async () => {
  const sdkRoots = [];
  for (const name of fs.readdirSync(join(root, 'out/main')).filter(name => /^chunk-.*\.js$/.test(name))) {
    const file = join(root, 'out/main', name);
    if (!fs.readFileSync(file, 'utf8').includes('getDataBaseDir')) continue;
    const chunk = await import(pathToFileURL(file).href);
    for (const [exportName, value] of Object.entries(chunk)) {
      if (typeof value === 'function' && value.name === 'getDataBaseDir') sdkRoots.push({ chunk: name, exportName, value: value() });
    }
  }
  return { home: homedir(), userProfile: process.env.USERPROFILE, profile: globalThis[Symbol.for('pi-agent-ide.desktop-profile')], envDataBaseDir: process.env.ZCODE_DATA_BASE_DIR, sdkRoots };
};
const pkg = JSON.parse(fs.readFileSync(join(root, 'package.json'), 'utf8'));
import(pathToFileURL(join(root, pkg.main)).href).then(() => { globalThis.__profileEntryLoaded = true; }).catch(error => { console.error(error); app.exit(1); });
