import assert from 'node:assert/strict';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { isolatePiPackage } from './pi-package.mjs';

test('isolated PI_PACKAGE_DIR contains the pinned Pi theme needed during RPC startup', async () => {
  const sandbox = await mkdtemp(join(tmpdir(), 'pi-package-layout-'));
  try {
    const fixture = { sandbox, env: {} };
    await isolatePiPackage(fixture);
    assert.equal((await stat(join(fixture.env.PI_PACKAGE_DIR,
      'dist/modes/interactive/theme/dark.json'))).isFile(), true);
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});
