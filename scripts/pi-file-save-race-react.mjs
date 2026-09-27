import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const ui = join(root, 'packages/ui/src');
const source = `
  import React, { useState } from 'react';
  import { createRoot } from 'react-dom/client';
  import { PreviewPaneTextEditor } from '../packages/ui/src/PreviewPaneTextEditor.tsx';

  const files = new Map([
    ['/project/a.txt', { content: 'A disk', version: 'A0' }],
    ['/project/b.txt', { content: 'B disk', version: 'B0' }],
  ]);
  const saves = [];
  const heldReads = [];
  let holdRead = false;
  const service = {
    readEditableText: ({ path }) => holdRead
      ? new Promise(resolve => { holdRead = false; heldReads.push({ path, resolve }); })
      : Promise.resolve({ path, ...files.get(path) }),
    saveEditableText: request => new Promise((resolve, reject) => saves.push({ request, resolve, reject })),
  };
  let setTarget;
  let savedCount = 0;
  function App() {
    const [target, changeTarget] = useState('/project/a.txt');
    const [editorOpen, setEditorOpen] = useState(true);
    setTarget = path => { changeTarget(path); setEditorOpen(true); };
    return editorOpen ? React.createElement(PreviewPaneTextEditor, {
      fileService: service, rootPath: '/project', path: target,
      onSaved: () => { savedCount++; setEditorOpen(false); },
    }) : React.createElement('p', { id: 'closed' }, 'editor closed');
  }
  createRoot(document.getElementById('root')).render(React.createElement(App));
  window.fileRace = {
    saves, setTarget: path => setTarget(path),
    heldReads, holdNextRead: () => { holdRead = true; },
    releaseRead: () => {
      const pending = heldReads.shift();
      if (!pending) throw new Error('No pending read');
      pending.resolve({ path: pending.path, ...files.get(pending.path) });
    },
    savedCount: () => savedCount,
    disk: path => files.get(path),
    input: value => {
      const node = document.querySelector('textarea');
      node.focus();
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
      setter.call(node, value);
      node.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
      node.dispatchEvent(new Event('change', { bubbles: true }));
    },
    clickSave: () => [...document.querySelectorAll('button')].find(node => node.textContent === 'codeViewer.edit.save').click(),
    resolveNext: () => {
      const pending = saves.shift();
      if (!pending) throw new Error('No pending save');
      const file = files.get(pending.request.path);
      const version = file.version + 'x';
      files.set(pending.request.path, { content: pending.request.content, version });
      pending.resolve({ version });
    },
    rejectNext: () => {
      const pending = saves.shift();
      if (!pending) throw new Error('No pending save');
      files.set(pending.request.path, { content: 'A external', version: 'A external version' });
      pending.reject(new Error('FILE_CHANGED'));
    },
    snapshot: () => ({
      editor: document.querySelector('textarea')?.value ?? null,
      draft: Object.values(localStorage).find(value => value.includes('A newer unsaved')) ?? null,
      allDrafts: Object.values(localStorage),
      closed: Boolean(document.querySelector('#closed')),
      error: document.querySelector('[role="alert"]')?.textContent ?? null,
      conflict: Boolean(document.querySelector('[data-testid="pi-file-save-conflict"]')),
      savedCount,
      aDisk: files.get('/project/a.txt'),
      bDisk: files.get('/project/b.txt'),
    }),
  };
`;
const stubPlugin = {
  name: 'react-test-stubs',
  setup(plugin) {
    plugin.onResolve({ filter: /^@\/components\/ui\/button\.js$/ }, () => ({ path: 'button', namespace: 'stub' }));
    plugin.onResolve({ filter: /^@\/i18n\/IntlProvider\.js$/ }, () => ({ path: 'intl', namespace: 'stub' }));
    plugin.onLoad({ filter: /.*/, namespace: 'stub' }, args => ({
      contents: args.path === 'button'
        ? `import React from 'react'; export function Button(props) { return React.createElement('button', props); }`
        : `export function useZCodeIntl() { return { intl: { formatMessage: ({ id }) => id } }; }`,
      loader: 'js', resolveDir: root,
    }));
  },
};
const built = await build({ stdin: { contents: source, resolveDir: join(root, 'scripts'),
  sourcefile: 'pi-file-save-race-harness.tsx', loader: 'tsx' }, bundle: true, write: false,
  format: 'iife', platform: 'browser', target: 'es2022',
  alias: { '@': ui }, plugins: [stubPlugin] });
const candidate = [
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
].find(path => path && existsSync(path));
assert(candidate, 'An isolated local Chromium executable is required for the React DOM contract');
const browser = await chromium.launch({ executablePath: candidate, headless: true });
const page = await browser.newPage();
const server = createServer((_request, response) => {
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  response.end('<style>textarea{display:block;width:500px;height:100px}</style><div id="root"></div>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}/`;
try {
  await page.goto(url);
  await page.addScriptTag({ content: built.outputFiles[0].text });
  await page.getByRole('textbox', { name: 'codeViewer.edit.text' }).waitFor();
  await page.evaluate(() => window.fileRace.input('A saved'));
  await page.waitForFunction(() => document.querySelector('textarea')?.value === 'A saved');
  await page.evaluate(() => window.fileRace.clickSave());
  await page.waitForFunction(() => window.fileRace.saves.length === 1);
  await page.evaluate(() => window.fileRace.input('A newer unsaved'));
  await page.waitForFunction(() => document.querySelector('textarea')?.value === 'A newer unsaved');
  await page.evaluate(() => window.fileRace.resolveNext());
  await page.waitForTimeout(80);
  const newerInput = await page.evaluate(() => window.fileRace.snapshot());

  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.addScriptTag({ content: built.outputFiles[0].text });
  await page.getByRole('textbox', { name: 'codeViewer.edit.text' }).waitFor();
  await page.evaluate(() => window.fileRace.input('A pending switch'));
  await page.waitForFunction(() => document.querySelector('textarea')?.value === 'A pending switch');
  await page.evaluate(() => window.fileRace.clickSave());
  await page.waitForFunction(() => window.fileRace.saves.length === 1);
  await page.evaluate(() => window.fileRace.setTarget('/project/b.txt'));
  await page.waitForFunction(() => document.querySelector('textarea')?.value === 'B disk');
  await page.evaluate(() => window.fileRace.input('B edited'));
  await page.waitForFunction(() => document.querySelector('textarea')?.value === 'B edited');
  await page.evaluate(() => window.fileRace.clickSave());
  await page.waitForFunction(() => window.fileRace.saves.length === 2);
  await page.evaluate(() => window.fileRace.resolveNext());
  await page.waitForTimeout(80);
  const switchedTarget = await page.evaluate(() => window.fileRace.snapshot());
  await page.evaluate(() => window.fileRace.resolveNext());
  await page.waitForTimeout(80);
  const secondSave = await page.evaluate(() => window.fileRace.snapshot());

  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.addScriptTag({ content: built.outputFiles[0].text });
  await page.getByRole('textbox', { name: 'codeViewer.edit.text' }).waitFor();
  await page.evaluate(() => window.fileRace.input('A first generation'));
  await page.waitForFunction(() => document.querySelector('textarea')?.value === 'A first generation');
  await page.evaluate(() => window.fileRace.clickSave());
  await page.waitForFunction(() => window.fileRace.saves.length === 1);
  await page.evaluate(() => window.fileRace.setTarget('/project/b.txt'));
  await page.waitForFunction(() => document.querySelector('textarea')?.value === 'B disk');
  await page.evaluate(() => window.fileRace.setTarget('/project/a.txt'));
  await page.waitForFunction(() => document.querySelector('textarea')?.value === 'A first generation');
  await page.evaluate(() => window.fileRace.input('A second generation'));
  await page.waitForFunction(() => document.querySelector('textarea')?.value === 'A second generation');
  await page.evaluate(() => window.fileRace.input('A first generation'));
  await page.waitForFunction(() => document.querySelector('textarea')?.value === 'A first generation');
  await page.evaluate(() => window.fileRace.resolveNext());
  await page.waitForTimeout(80);
  const returnedTarget = await page.evaluate(() => window.fileRace.snapshot());

  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.addScriptTag({ content: built.outputFiles[0].text });
  await page.getByRole('textbox', { name: 'codeViewer.edit.text' }).waitFor();
  await page.evaluate(() => window.fileRace.input('A pending conflict'));
  await page.waitForFunction(() => document.querySelector('textarea')?.value === 'A pending conflict');
  await page.evaluate(() => window.fileRace.clickSave());
  await page.waitForFunction(() => window.fileRace.saves.length === 1);
  await page.evaluate(() => { window.fileRace.holdNextRead(); window.fileRace.rejectNext(); });
  await page.waitForFunction(() => window.fileRace.heldReads.length === 1);
  await page.evaluate(() => window.fileRace.input('A newer conflict draft'));
  await page.waitForFunction(() => document.querySelector('textarea')?.value === 'A newer conflict draft');
  await page.evaluate(() => window.fileRace.releaseRead());
  await page.waitForTimeout(150);
  const conflict = await page.evaluate(() => window.fileRace.snapshot());
  const result = { newerInput, switchedTarget, secondSave, returnedTarget, conflict };
  console.log(JSON.stringify(result, null, 2));
  assert.equal(newerInput.editor, 'A newer unsaved', 'late save ACK must preserve newer React input');
  assert(newerInput.draft, 'late save ACK must retain newer persistent draft');
  assert.equal(newerInput.aDisk.content, 'A saved');
  assert.equal(switchedTarget.editor, 'B edited', 'old file save ACK must not replace the new editor');
  assert.equal(switchedTarget.savedCount, 0, 'old file save ACK must not close the new target editor');
  assert.equal(secondSave.bDisk.content, 'B edited', 'new target must still be saveable while old ACK is pending');
  assert.equal(secondSave.savedCount, 1, 'new target save ACK must finish independently');
  assert.equal(returnedTarget.editor, 'A first generation', 'A-B-A must reject the old A save ACK');
  assert.equal(returnedTarget.savedCount, 0, 'old A save ACK must not close the new A editor');
  assert(returnedTarget.allDrafts.some(value => value.includes('A first generation')),
    'A-B-A must preserve a new A draft even when its content matches the old submitted save');
  assert.equal(conflict.editor, 'A newer conflict draft', 'conflict ACK must preserve newer React input');
  assert(conflict.conflict && conflict.allDrafts.some(value => value.includes('A newer conflict draft')),
    'conflict ACK must preserve the current draft and show the disk conflict');
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
