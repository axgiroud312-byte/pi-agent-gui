// External OS boundaries only. Loaded before the original main and inherited by Node hosts.
const cp = require('node:child_process');
const fs = require('node:fs');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { syncBuiltinESMExports } = require('node:module');
const { promisify } = require('node:util');
const append = fs.appendFileSync.bind(fs);

function record(type, detail) {
  append(process.env.NATIVE_SMOKE_BOUNDARY_LOG,
    JSON.stringify({ at: new Date().toISOString(), pid: process.pid, type, detail }) + '\n');
}
require('./guard-boundaries.cjs')(record);

const registry = command => /\breg(?:\.exe)?\b|regedit|Register-ScheduledTask|Set-ItemProperty|New-ItemProperty/i.test(String(command));
for (const method of ['spawn', 'exec', 'execFile', 'fork', 'spawnSync', 'execSync', 'execFileSync']) {
  const original = cp[method];
  cp[method] = function (...args) {
    if (!registry(args.slice(0, 2).flat().join(' '))) {
      if (['spawn', 'fork', 'execFile'].includes(method)) {
        const index = Array.isArray(args[1]) ? 2 : 1;
        const options = typeof args[index] === 'object' ? args[index] : {};
        const env = { ...(options.env ?? process.env) };
        for (const [key, value] of Object.entries(process.env)) {
          if (key.startsWith('NATIVE_SMOKE_') || ['HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'TEMP', 'TMP'].includes(key)) env[key] = value;
        }
        const preload = `--require=${JSON.stringify(__filename.replaceAll('\\', '/'))}`;
        env.NODE_OPTIONS = (env.NODE_OPTIONS ?? '').includes(preload) ? env.NODE_OPTIONS : `${env.NODE_OPTIONS ?? ''} ${preload}`;
        if (typeof args[index] === 'function') args.splice(index, 0, { ...options, env });
        else args[index] = { ...options, env };
      }
      const child = original.apply(this, args);
      const logChild = () => record('child', { method, pid: child.pid, executable: String(args[0]) });
      if (child?.pid) logChild(); else child?.once?.('spawn', logChild);
      return child;
    }
    record('registry-intercepted', { method, command: args.slice(0, 2) });
    if (method.endsWith('Sync')) return method === 'spawnSync'
      ? { status: 0, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) } : Buffer.alloc(0);
    const child = new EventEmitter();
    child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.stdin = new PassThrough();
    child.kill = () => true;
    process.nextTick(() => {
      child.stdout.end(); child.stderr.end();
      const callback = args.findLast(arg => typeof arg === 'function');
      callback?.(null, '', ''); child.emit('exit', 0, null); child.emit('close', 0, null);
    });
    return child;
  };
  if (['exec', 'execFile'].includes(method)) {
    cp[method][promisify.custom] = (...args) => {
      let child;
      const promise = new Promise((resolve, reject) => {
        child = cp[method](...args, (error, stdout, stderr) => {
          if (error) reject(Object.assign(error, { stdout, stderr })); else resolve({ stdout, stderr });
        });
      });
      promise.child = child;
      return promise;
    };
  }
}
syncBuiltinESMExports();
module.exports = { record };
