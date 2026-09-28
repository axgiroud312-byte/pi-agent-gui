// Mount the actual React dialogs in an isolated headless Edge renderer. The
// services are deferred promises so a session switch lands before A settles.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

const browserPath = process.env.PI_DIALOG_HEADLESS_BROWSER ||
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const virtual = {
  '@/components/ui/button.js': `import React from 'react';
    export function Button({children, variant, size, ...props}) { return <button {...props}>{children}</button>; }`,
  '@/components/ui/dialog.js': `import React from 'react';
    export function Dialog({open, children}) { return open ? <div>{children}</div> : null; }
    export function DialogContent(props) { return <div {...props}/>; }
    export function DialogDescription(props) { return <div {...props}/>; }
    export function DialogHeader(props) { return <div {...props}/>; }
    export function DialogTitle(props) { return <h2 {...props}/>; }`,
  '@/hooks/useServices.js': `export function useServices() { return window.__testServices; }`,
  '@/hooks/usePlatform.js': `export function useOptionalPlatform() { return window.__testPlatform; }`,
  'lucide-react': `export const Terminal = () => null;
    export const Download = () => null; export const RefreshCw = () => null;`,
};
const entry = `
  import React from 'react';
  import { createRoot } from 'react-dom/client';
  import { flushSync } from 'react-dom';
  import { PiShellDialog } from './src/v4/PiShellDialog.tsx';
  import { PiSessionTransferDialog } from './src/v4/PiSessionTransferDialog.tsx';
  const shellRoot = createRoot(document.getElementById('shell'));
  const transferRoot = createRoot(document.getElementById('transfer'));
  window.__shellCalls = []; window.__stops = []; window.__discardCalls = [];
  window.__exportCalls = []; window.__importCalls = []; window.__beforeSwitch = [];
  window.__publishCalls = [];
  window.__testPlatform = { selectDirectory: async () => 'C:/unused', selectFile: async () => 'C:/unused.jsonl' };
  window.__testServices = { zcodeAgentService: {
    runPiShell(params) {
      window.__shellCalls.push(params);
      return new Promise(resolve => { window.__resolveShell = resolve; });
    },
    readPiSessionTransfer(params) {
      return Promise.resolve({ sessionId: params.sessionId,
        sessionFile: 'C:/sessions/' + params.sessionId + '.jsonl',
        revision: params.sessionId, bytes: 100, messageCount: 1,
        lastAssistantText: params.sessionId === 'A' ? 'A_PRIVATE_REPLY' : 'B_PUBLIC_REPLY' });
    },
    preparePiSessionShare(params) {
      window.__sharePrepareTarget = params;
      return new Promise(resolve => { window.__resolveShare = resolve; });
    },
    discardPiSessionShare(params) { window.__discardCalls.push(params); return Promise.resolve(); },
    exportPiSession(params) { window.__exportCalls.push(params); return Promise.resolve({ path: 'C:/unused/export.jsonl' }); },
    importPiSession(params) { window.__importCalls.push(params); return Promise.resolve({ sessionId: 'IMPORTED' }); },
    publishPiSessionShare(params) {
      window.__publishCalls.push(params);
      return new Promise((resolve, reject) => {
        window.__resolvePublish = resolve;
        window.__rejectPublish = reject;
      });
    },
  } };
  window.__renderShell = sessionId => flushSync(() => shellRoot.render(
    <PiShellDialog sessionId={sessionId} workspacePath="C:/fixture"
      onStop={target => window.__stops.push(target)} />));
  window.__renderTransfer = sessionId => flushSync(() => transferRoot.render(
    <PiSessionTransferDialog sessionId={sessionId} workspacePath="C:/fixture"
      beforeSwitch={() => window.__beforeSwitch.push(sessionId)} onImported={() => {}} />));
  window.__removeTransfer = () => flushSync(() => transferRoot.render(null));
`;

const result = await build({
  stdin: { contents: entry, resolveDir: `${process.cwd()}/packages/ui`, sourcefile: 'pi-dialog-scope-harness.tsx', loader: 'tsx' },
  bundle: true, write: false, format: 'iife', platform: 'browser', target: 'chrome120',
  plugins: [{ name: 'dialog-test-virtuals', setup(api) {
    api.onResolve({ filter: /^(@\/|lucide-react$)/ }, args => {
      if (args.path in virtual) return { path: args.path, namespace: 'virtual' };
      if (args.path === '@/v4/piSessionDialogGuard.js') {
        return { path: `${process.cwd()}/packages/ui/src/v4/piSessionDialogGuard.ts` };
      }
      throw new Error(`Unexpected dialog harness alias: ${args.path}`);
    });
    api.onLoad({ filter: /.*/, namespace: 'virtual' }, args => ({
      contents: virtual[args.path], loader: 'tsx', resolveDir: process.cwd(),
    }));
  } }],
});
const bundle = result.outputFiles[0].text;

export async function withPage(run) {
  const browser = await chromium.launch({ executablePath: browserPath, headless: true,
    args: ['--no-first-run', '--disable-gpu'] });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.stack || error.message));
    await page.setContent('<div id="shell"></div><div id="transfer"></div>');
    await page.addScriptTag({ content: bundle });
    await run(page);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
}
