// External OS boundaries only. Loaded before the original main and inherited by Node hosts.
const cp = require('node:child_process');
const fs = require('node:fs');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { syncBuiltinESMExports } = require('node:module');
const { promisify } = require('node:util');
const { createHash } = require('node:crypto');
const append = fs.appendFileSync.bind(fs);

function record(type, detail) {
  append(process.env.NATIVE_SMOKE_BOUNDARY_LOG,
    JSON.stringify({ at: new Date().toISOString(), pid: process.pid, type, detail }) + '\n');
}
require('./guard-boundaries.cjs')(record);

const registry = command => /\breg(?:\.exe)?\b|regedit|Register-ScheduledTask|Set-ItemProperty|New-ItemProperty/i.test(String(command));
function fakeGhPublish(args) {
  const command = args[1];
  if (!Array.isArray(command) || command.length !== 4 ||
    command[0] !== 'gist' || command[1] !== 'create' || command[2] !== '--public=false') {
    throw new Error('Native smoke fake publisher refused an unexpected gh command');
  }
  const callback = args.findLast(arg => typeof arg === 'function');
  if (!callback) throw new Error('Native smoke fake publisher requires an execFile callback');
  const child = new EventEmitter();
  child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.stdin = new PassThrough();
  let done = false;
  let timer;
  const finish = (error, stdout = '', stderr = '') => {
    if (done) return;
    done = true;
    clearInterval(timer);
    child.stdout.end(stdout); child.stderr.end(stderr);
    callback(error, stdout, stderr);
    child.emit('exit', error ? 1 : 0, null);
    child.emit('close', error ? 1 : 0, null);
  };
  child.kill = () => { finish(new Error('Native smoke fake publisher cancelled')); return true; };
  process.nextTick(() => {
    try {
      const bytes = fs.readFileSync(command[3]);
      const encoded = /<script id="session-data" type="application\/json">([A-Za-z0-9+/=]+)<\/script>/u
        .exec(bytes.toString('utf8'))?.[1];
      const reviewedData = encoded ? Buffer.from(encoded, 'base64').toString('utf8') : '';
      const detail = { args: command.slice(0, 3), sha256: createHash('sha256').update(bytes).digest('hex'),
        bytes: bytes.length, containsA: reviewedData.includes('A_PRIVATE_SHARE_RECEIPT'),
        containsB: reviewedData.includes('B_PUBLIC_SHARE_RECEIPT') };
      fs.appendFileSync(process.env.NATIVE_SMOKE_FAKE_GH_CALLED, JSON.stringify(detail) + '\n');
      record('fake-gh-publish', { sha256: detail.sha256, bytes: detail.bytes });
      const started = Date.now();
      timer = setInterval(() => {
        if (fs.existsSync(process.env.NATIVE_SMOKE_FAKE_GH_RELEASE)) {
          fs.writeFileSync(process.env.NATIVE_SMOKE_FAKE_GH_COMPLETED, 'completed');
          finish(null, process.env.NATIVE_SMOKE_FAKE_GH_URL + '\n');
        } else if (Date.now() - started > 30_000) {
          finish(new Error('Native smoke fake publisher was not released'));
        }
      }, 30);
    } catch (error) { finish(error); }
  });
  return child;
}
for (const method of ['spawn', 'exec', 'execFile', 'fork', 'spawnSync', 'execSync', 'execFileSync']) {
  const original = cp[method];
  cp[method] = function (...args) {
    if (method === 'execFile' && args[0] === 'gh' && process.env.NATIVE_SMOKE_FAKE_GH_CALLED) {
      return fakeGhPublish(args);
    }
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
