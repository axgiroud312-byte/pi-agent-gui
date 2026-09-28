import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const desktopRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));

async function javascriptFiles(dir) {
  const files = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await javascriptFiles(path));
    else if (entry.isFile() && entry.name.endsWith('.js')) files.push(path);
  }
  return files;
}

test('production Host bundles the storage startup workspace package', async () => {
  const hostDir = join(desktopRoot, 'out', 'host');
  const files = await javascriptFiles(hostDir);
  assert(files.length > 0, 'build the desktop before checking its production Host');
  const danglingImports = [];
  for (const path of files) {
    const source = await readFile(path, 'utf8');
    if (source.includes('"@zcode/services/storage-startup"') ||
        source.includes("'@zcode/services/storage-startup'")) danglingImports.push(path);
  }
  assert.deepEqual(danglingImports, [],
    'Electron Host cannot resolve the services source export without a TypeScript loader');
});
