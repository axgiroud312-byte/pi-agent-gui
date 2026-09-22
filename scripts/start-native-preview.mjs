import { access, mkdir, open, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

const root = resolve(import.meta.dirname, '..');
const { values } = parseArgs({ options: { detach: { type: 'boolean' }, 'data-dir': { type: 'string' } } });
const data = resolve(values['data-dir'] ?? join(process.env.LOCALAPPDATA ?? homedir(), 'PiAgentIDE', 'native-preview'));
const desktop = join(root, 'packages', 'desktop');
const require = createRequire(join(desktop, 'package.json'));
const electronRoot = dirname(require.resolve('electron/package.json'));
const executable = join(electronRoot, 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron');
const { main } = JSON.parse(await readFile(join(desktop, 'package.json'), 'utf8'));
for (const path of [executable, join(desktop, main), join(desktop, 'out/main/index.js'), join(desktop, 'out/renderer/index.html')]) {
  await access(path).catch(() => { throw new Error(`Missing native build: ${path}. Run frozen pnpm installation, prepare:desktop-runtime and the desktop build first.`); });
}
const inherited = new Set(['PATH', 'SYSTEMROOT', 'WINDIR', 'PATHEXT', 'COMSPEC', 'SYSTEMDRIVE']);
const env = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => value !== undefined && inherited.has(key.toUpperCase())));
Object.assign(env, {
  HOME: data, USERPROFILE: data, APPDATA: join(data, 'AppData', 'Roaming'), LOCALAPPDATA: join(data, 'AppData', 'Local'),
  TEMP: join(data, 'Temp'), TMP: join(data, 'Temp'), PROGRAMDATA: join(data, 'ProgramData'), ALLUSERSPROFILE: join(data, 'ProgramData'),
  ZCODE_DATA_BASE_DIR: data, ZCODE_DESKTOP_HOME_DIR: data, ZCODE_DESKTOP_PROFILE_HOME: data,
  ZCODE_DESKTOP_APPLICATION_NAME: 'Pi Agent IDE Native Preview',
  ZCODE_DESKTOP_USER_DATA_DIR: join(data, 'electron'), ZCODE_DESKTOP_SESSION_DATA_DIR: join(data, 'electron-session'),
});
for (const path of [data, env.APPDATA, env.LOCALAPPDATA, env.TEMP, env.PROGRAMDATA, env.ZCODE_DESKTOP_USER_DATA_DIR, env.ZCODE_DESKTOP_SESSION_DATA_DIR]) await mkdir(path, { recursive: true });
const log = values.detach ? await open(join(data, 'preview.log'), 'a') : null;
const child = spawn(executable, [desktop], {
  cwd: desktop, env, detached: !!values.detach,
  stdio: log ? ['ignore', log.fd, log.fd] : 'inherit',
});
await new Promise((resolveSpawn, reject) => { child.once('spawn', resolveSpawn); child.once('error', reject); });
console.log(`Native UI preview pid=${child.pid}; profile=${data}`);
console.log('Stage 0: native ZCode workbench with Pi branding. Pi RPC replacement starts only after issue #33 confirmation.');
if (values.detach) { child.unref(); await log.close(); }
else {
  child.once('exit', code => { process.exitCode = code ?? 1; });
  process.once('SIGINT', () => child.kill());
}
