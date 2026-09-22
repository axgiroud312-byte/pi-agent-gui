const fs = require('node:fs');
const fsp = require('node:fs/promises');
const net = require('node:net');
const { resolve, relative, isAbsolute } = require('node:path');
const { fileURLToPath } = require('node:url');

module.exports = function install(record) {
  const env = process.env;
  const inside = (root, path) => { const rel = relative(root, path); return !rel.startsWith('..') && !isAbsolute(rel); };
  const readRoots = [env.NATIVE_SMOKE_ROOT, env.NATIVE_SMOKE_HARNESS, env.NATIVE_SMOKE_OUTPUT].filter(Boolean);
  function check(value, method, write = false) {
    if (typeof value !== 'string' && !(value instanceof URL)) return;
    const path = resolve(value instanceof URL ? fileURLToPath(value) : value);
    if (path.startsWith('\\\\.\\pipe\\')) return;
    const forbiddenRead = env.NATIVE_SMOKE_FORBIDDEN_HOME && inside(env.NATIVE_SMOKE_FORBIDDEN_HOME, path)
      && !readRoots.some(root => inside(root, path));
    const forbiddenWrite = write && !inside(env.NATIVE_SMOKE_OUTPUT, path);
    if (forbiddenRead && method === 'existsSync') {
      record('filesystem-probe-denied', { method, path });
      return false;
    }
    if (forbiddenRead || forbiddenWrite) {
      record('filesystem-blocked', { method, path, write });
      throw Object.assign(new Error(`Native smoke blocked out-of-fixture filesystem access: ${method}`), { code: 'EACCES' });
    }
    return true;
  }
  for (const target of [fs, fsp]) {
    for (const name of ['readFile', 'readdir', 'stat', 'lstat', 'realpath', 'access', 'exists',
      'open', 'writeFile', 'appendFile', 'mkdir', 'rm', 'rmdir', 'unlink', 'rename', 'copyFile',
      'createReadStream', 'createWriteStream']) {
      for (const method of [name, `${name}Sync`]) {
        if (typeof target[method] !== 'function') continue;
        const original = target[method];
        target[method] = function (...args) {
          const write = /write|append|mkdir|rm|unlink|rename/i.test(name)
            || (name === 'open' && (typeof args[1] === 'number'
              ? Boolean(args[1] & (fs.constants.O_WRONLY | fs.constants.O_RDWR)) : /[wa+]/.test(String(args[1]))));
          if (check(args[0], method, write) === false) return false;
          if (name === 'rename' || name === 'copyFile') check(args[1], method, true);
          return original.apply(this, args);
        };
        Object.assign(target[method], original);
        if (typeof original.native === 'function') target[method].native = (...args) => {
          check(args[0], `${method}.native`); return original.native(...args);
        };
      }
    }
  }
  const connect = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function (...args) {
    const options = Array.isArray(args[0]) ? args[0][0] : args[0];
    const host = typeof options === 'object' ? options?.host : typeof args[1] === 'string' ? args[1] : null;
    if (host && !['localhost', '127.0.0.1', '::1', '[::1]'].includes(host)) {
      record('node-network-blocked', { host, port: options?.port });
      throw Object.assign(new Error('Native smoke permits loopback network only'), { code: 'ENETUNREACH' });
    }
    return connect.apply(this, args);
  };
  record('guard-active', { home: require('node:os').homedir(), envKeys: Object.keys(env).sort() });
};
