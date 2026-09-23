import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { PiSessionCatalog } from '../src/pi-agent/pi-session-catalog.js';

test('app bookmarks index only existing Pi JSONL histories and never copy their contents', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-catalog-'));
  const catalog = new PiSessionCatalog(join(root, 'app', 'pi-sessions'));
  const sessionId = '96951d0a-977b-409b-8e67-cb38396ccce4';
  const sessionFile = join(root, 'pi-profile', 'session.jsonl');
  const bookmark = {
    sessionId, sessionFile, workspacePath: root, workspaceKey: root,
    workspaceId: root, createdAt: 100, lastActivityAt: 200,
  };
  try {
    assert.equal(await catalog.save(bookmark), false, 'empty drafts without JSONL stay out of the index');
    assert.deepEqual(await catalog.list(root), []);
    await mkdir(join(root, 'pi-profile'));
    await writeFile(sessionFile, '{"type":"session","id":"96951d0a-977b-409b-8e67-cb38396ccce4"}\n');
    assert.equal(await catalog.save(bookmark), true);
    assert.deepEqual(await catalog.list(root), [bookmark]);
    assert.deepEqual(await catalog.list(join(root, 'other')), []);
    assert.deepEqual(JSON.parse(await readFile(join(root, 'app', 'pi-sessions', `${sessionId}.json`), 'utf8')), bookmark);
    await rm(sessionFile);
    assert.deepEqual(await catalog.list(root), [], 'missing Pi JSONL cannot masquerade as restored history');
  } finally { await rm(root, { recursive: true, force: true }); }
});
