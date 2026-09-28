import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const source = `
  import React, { useState } from 'react';
  import { createRoot } from 'react-dom/client';
  import { currentSessionSnapshot } from '../packages/ui/src/v4/currentSessionSnapshot.ts';

  let changeSession;
  let deliverSnapshot;
  function App() {
    const [sessionId, setSessionId] = useState('A');
    const [snapshot, setSnapshot] = useState({ sessionId: 'A',
      extensionText: 'A PRIVATE EXTENSION TEXT', queueText: 'A PRIVATE QUEUED MESSAGE' });
    changeSession = setSessionId;
    deliverSnapshot = setSnapshot;
    const current = currentSessionSnapshot(sessionId, snapshot);
    return React.createElement('main', { 'data-active-session': sessionId },
      current && React.createElement('section', { 'data-testid': 'extension-text' }, current.extensionText),
      current && React.createElement('section', { 'data-testid': 'queue-text' }, current.queueText));
  }
  createRoot(document.getElementById('root')).render(React.createElement(App));
  window.snapshotScope = {
    changeSession: value => changeSession(value),
    deliverSnapshot: value => deliverSnapshot(value),
  };
`;
const built = await build({ stdin: { contents: source, resolveDir: join(root, 'scripts'),
  sourcefile: 'pi-session-snapshot-scope-harness.tsx', loader: 'tsx' }, bundle: true,
  write: false, format: 'iife', platform: 'browser', target: 'es2022' });
const candidate = [
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
].find(path => path && existsSync(path));
assert(candidate, 'A local Chromium executable is required for the React DOM contract');
const browser = await chromium.launch({ executablePath: candidate, headless: true });
const page = await browser.newPage();
const server = createServer((_request, response) => {
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  response.end('<div id="root"></div>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
try {
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.addScriptTag({ content: built.outputFiles[0].text });
  await page.getByText('A PRIVATE EXTENSION TEXT').waitFor();
  await page.evaluate(() => window.snapshotScope.changeSession('B'));
  await page.waitForFunction(() => document.querySelector('main')?.dataset.activeSession === 'B');
  const stale = await page.locator('main').innerText();
  assert(!stale.includes('A PRIVATE EXTENSION TEXT'), 'A extension text must not appear in B');
  assert(!stale.includes('A PRIVATE QUEUED MESSAGE'), 'A queue text must not appear in B');
  await page.evaluate(() => window.snapshotScope.deliverSnapshot({ sessionId: 'B',
    extensionText: 'B extension text', queueText: 'B queued message' }));
  await page.getByText('B extension text').waitFor();
  assert.equal(await page.getByText('B queued message').count(), 1);
  console.log('PASS: stale A projection hidden in B; B projection displayed after delivery');
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
