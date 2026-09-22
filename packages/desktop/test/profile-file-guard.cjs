// Test-only guard shared by main, utility hosts and their Node children.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const cp = require('node:child_process');
const { isAbsolute, join, relative, resolve, sep } = require('node:path');
const { fileURLToPath } = require('node:url');
const { syncBuiltinESMExports } = require('node:module');
const { record } = require(join(process.env.NATIVE_SMOKE_HARNESS, 'guard.cjs'));
const legacyRoot = resolve(process.env.HOME, '.zcode');

function check(file, operation) {
  if (typeof file !== 'string' && !(file instanceof URL) && !Buffer.isBuffer(file)) return;
  const path = resolve(file instanceof URL ? fileURLToPath(file) : String(file));
  const rel = relative(legacyRoot, path);
  if (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)) {
    record('legacy-profile-access', { operation, path });
    throw new Error('Original ZCode profile accessed by production entry');
  }
}

for (const target of [fs, fsp]) {
  for (const name of ['readFile', 'writeFile', 'appendFile', 'exists', 'stat', 'lstat', 'realpath',
    'access', 'open', 'readdir', 'mkdir', 'rm', 'rmdir', 'unlink', 'rename', 'copyFile', 'cp',
    'link', 'symlink', 'watch', 'createReadStream', 'createWriteStream']) {
    for (const method of [name, `${name}Sync`]) {
      const original = target[method];
      if (typeof original !== 'function') continue;
      target[method] = function (...args) {
        check(args[0], method);
        if (['rename', 'copyFile', 'cp', 'link', 'symlink'].includes(name)) check(args[1], method);
        return original.apply(this, args);
      };
      Object.assign(target[method], original);
      if (typeof original.native === 'function') target[method].native = (...args) => {
        check(args[0], `${method}.native`);
        return original.native(...args);
      };
    }
  }
}
// App-server/tool launchers can sanitize NODE_OPTIONS. Reapply only this test preload
// at the process boundary so a legacy read in an actual Agent child is observable too.
const preload = `--require=${JSON.stringify(__filename.replaceAll('\\', '/'))}`;
for (const method of ['spawn', 'exec', 'execFile', 'fork', 'spawnSync', 'execSync', 'execFileSync']) {
  const original = cp[method];
  cp[method] = function (...args) {
    const index = Array.isArray(args[1]) ? 2 : 1;
    const options = args[index] && typeof args[index] === 'object' ? args[index] : {};
    const env = { ...(options.env ?? process.env) };
    for (const [key, value] of Object.entries(process.env)) {
      if (key.startsWith('NATIVE_SMOKE_') || ['HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'TEMP', 'TMP'].includes(key)) env[key] = value;
    }
    if (!(env.NODE_OPTIONS ?? '').includes(preload)) env.NODE_OPTIONS = `${env.NODE_OPTIONS ?? ''} ${preload}`;
    if (typeof args[index] === 'function') args.splice(index, 0, { ...options, env });
    else args[index] = { ...options, env };
    return original.apply(this, args);
  };
  Object.assign(cp[method], original);
}
syncBuiltinESMExports();
record('profile-guard-active', { legacyRoot });
module.exports = { record };
