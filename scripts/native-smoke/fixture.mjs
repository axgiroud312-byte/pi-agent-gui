import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { parseArgs } from 'node:util';
import { execFileSync } from 'node:child_process';

export async function fixture() {
  if (process.platform !== 'win32') throw new Error('Native parity smoke currently requires Windows');
  const { values } = parseArgs({ options: {
    'app-root': { type: 'string', default: resolve(dirname(fileURLToPath(import.meta.url)), '../..') },
    baseline: { type: 'string', default: 'product' }, output: { type: 'string' },
  } });
  if (!['original', 'product'].includes(values.baseline)) throw new Error('--baseline must be original or product');
  const root = resolve(values['app-root']);
  const output = resolve(values.output ?? join(root, 'test-results/native-parity', values.baseline));
  await mkdir(output, { recursive: true });
  const sandbox = await mkdtemp(join(output, 'fixture-'));
  const home = join(sandbox, 'home');
  const workspace = join(sandbox, 'parity-workspace');
  const allowed = new Set(['PATH', 'SYSTEMROOT', 'SYSTEMDRIVE', 'WINDIR', 'PATHEXT', 'COMSPEC', 'TEMP', 'TMP']);
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => allowed.has(key.toUpperCase())));
  const realHome = (process.env.USERPROFILE ?? process.env.HOME ?? '').toLowerCase();
  for (const key of Object.keys(env)) {
    if (key.toUpperCase() === 'PATH') env[key] = env[key].split(';').filter(p => !realHome || !p.toLowerCase().startsWith(realHome)).join(';');
  }
  Object.assign(env, {
    HOME: home, USERPROFILE: home, APPDATA: join(home, 'AppData/Roaming'),
    LOCALAPPDATA: join(home, 'AppData/Local'), TEMP: join(sandbox, 'tmp'), TMP: join(sandbox, 'tmp'),
    PROGRAMDATA: join(sandbox, 'ProgramData'), ALLUSERSPROFILE: join(sandbox, 'ProgramData'),
    ZCODE_DATA_BASE_DIR: home, ZCODE_DESKTOP_HOME_DIR: home,
    ZCODE_DESKTOP_USER_DATA_DIR: join(home, 'electron'),
    ZCODE_DESKTOP_SESSION_DATA_DIR: join(home, 'electron-session'),
    ZCODE_DESKTOP_APPLICATION_NAME: `Native parity ${values.baseline} ${process.pid}-${Date.now()}`,
    NATIVE_SMOKE_ROOT: root, NATIVE_SMOKE_SANDBOX: sandbox, NATIVE_SMOKE_WORKSPACE: workspace,
    NATIVE_SMOKE_OUTPUT: output, NATIVE_SMOKE_HARNESS: dirname(fileURLToPath(import.meta.url)),
    NATIVE_SMOKE_FORBIDDEN_HOME: process.env.USERPROFILE ?? process.env.HOME,
    NATIVE_SMOKE_BOUNDARY_LOG: join(output, 'boundaries.jsonl'),
    NODE_OPTIONS: `--require=${JSON.stringify(fileURLToPath(new URL('./guard.cjs', import.meta.url)).replaceAll('\\', '/'))}`,
  });
  await Promise.all([home, workspace, env.APPDATA, env.LOCALAPPDATA, env.TEMP, env.PROGRAMDATA,
    env.ZCODE_DESKTOP_USER_DATA_DIR, env.ZCODE_DESKTOP_SESSION_DATA_DIR].map(p => mkdir(p, { recursive: true })));
  await writeFile(join(workspace, 'README.md'), '# Native parity fixture\n\nReal local workspace for Issue #32.\n\n**Preview marker: NATIVE_PARITY_PREVIEW**\n');
  await writeFile(join(workspace, 'hello.txt'), 'Native parity file content\n');
  execFileSync('git', ['init', '-q', workspace], { env, windowsHide: true });
  await writeFile(join(output, 'boundaries.jsonl'), '');
  const require = createRequire(join(root, 'package.json'));
  const desktopRequire = createRequire(join(root, 'packages/desktop/package.json'));
  const dependency = name => { try { return require(name); } catch { return desktopRequire(name); } };
  const dependencies = Object.fromEntries(['electron', 'playwright-core', 'vite', 'tsup'].map(name => {
    try { return [name, dependency(`${name}/package.json`).version]; } catch { return [name, 'not resolved']; }
  }));
  return { root, output, sandbox, home, workspace, env, baseline: values.baseline,
    dependencies, electronPath: dependency('electron'), playwright: dependency('playwright-core') };
}
