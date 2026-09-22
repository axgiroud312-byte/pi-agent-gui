# #32 — real native Electron GUI smoke

## Scope and status

This harness drives the **prepared production Electron application**, including its native
renderer, Lexical composer, services, original Agent and local PTY. It does not mount a test
page or inject component/store/session state. Model traffic goes to an explicitly controlled
loopback OpenAI-compatible SSE endpoint. **This is neither Pi execution nor a live-provider
test. #32 full acceptance and the #33 human gate remain open.**

Owned files: `scripts/native-desktop-smoke.mjs`, `scripts/native-smoke/**`, and this document.
Branch: `issue-32-native-parity-tests`, starting at `317d286`.

## Run

Prerequisites: Windows, Node 24, Git, the repository's already-installed Electron 41 and
`playwright-core`, and its built `packages/desktop/out/{main,host,renderer}` plus prepared
Agent/runtime assets. The harness performs **no install, dependency change, or application
build**. Dependencies resolve with `createRequire(<app-root>/package.json)`, falling back to
the native desktop package's own resolution for a normal pnpm workspace.

```powershell
# CI / integrated branded product: this is the default contract.
node scripts/native-desktop-smoke.mjs

# Frozen original app, driven from this independent worktree.
node scripts/native-desktop-smoke.mjs --app-root C:\Users\niilo\AppData\Local\Temp\opencode\pi-native-32 --baseline original --output C:\Users\niilo\AppData\Local\Temp\opencode\pi-native-32\test-results\native-parity\original\baseline-verified

# Discover options without launching Electron.
node scripts/native-desktop-smoke.mjs --help
```

`--app-root` defaults to the repository containing the script. `--baseline` is `product`
by default; `original` exempts the original from Pi branding/vendor-removal assertions.
`--output` defaults to `<app-root>/test-results/native-parity/<baseline>`.
Use separate output directories for separate runs; each invocation gets a fresh `fixture-*`
profile/workspace. Existing fixture directories are preserved, not reused.

The original-source check needs the pinned Git object, either in the app repository or in
its sibling `zcode-source-872ad96` checkout. Product mode always records actual source
hashes, even when that upstream object is absent. The original mode fails if it cannot
verify the pinned source identity.

## Actual native actions and assertions

| Surface | Driven action / assertion |
| --- | --- |
| Startup | Shown Electron window and `file:` production renderer; original welcome → Use API key → Skip for now → Exit onboarding. Chinese/English startup labels supported. Select Chinese through the real settings control for reproducible later actions. |
| Workspace | Add project → Open folder → isolated directory chooser. Real on-disk Git workspace with README and text file; assert the native composer displays that workspace. |
| Model settings | Add provider → custom provider → loopback Base URL and dummy key → Chat Completions → add model → choose the model from the native composer submenu. |
| Appearance / empty | Open native appearance settings and choose light/dark. Empty composer assertion and screenshots at both viewport sizes. |
| Lexical / IME | Actual keyboard typing and Shift+Enter; Chromium `Input.imeSetComposition` and `Input.insertText` composition/commit; assert no request during composition and preserve the draft through settings/theme navigation. This does not test a physical Windows IME candidate window. |
| Suggestions / focus | Type `/`, assert `/compact` appears, ArrowDown/Escape; type `@README`, select the real local file, assert reference text. Verify composer DOM focus after clicking it. |
| Running / timeline | Send prompt through the native composer. Hold an actual OpenAI SSE response; assert the native Stop button while capturing all four variants. Release response and assert Stop disappears. Markdown and a code block are rendered by the native timeline. |
| Terminal | Native terminal toggle, type a real shell command, verify the resulting file bytes on disk (UTF-8 and Windows PowerShell UTF-16 supported), print a visible marker, pointer-drag the native resize handle and assert its height changes, close the panel. |
| Files / Side Pane | Hover project → file tree button → open README → assert rendered Markdown marker. Open a second file, pointer-drag/reorder real side tabs, reactivate README, resize the native divider, capture preview variants, close a tab. |
| Tool row | Controlled model returns a `Read` tool call; the original Agent really reads the fixture. Assert returned file content at the wire boundary, then expand/collapse the native work-history row and capture both states. |
| Waiting | Controlled `AskUserQuestion` enters the native waiting card. Capture all variants; click Fixture A and assert the native tool response contains the selected answer. Single-choice native UI submits on selection. |
| Error / recovery | Controlled HTTP 400 displays the native error surface. Capture all variants, submit a fresh prompt and assert recovery text. |
| Stop | Click the real native Stop button on a second held SSE request. Assert the HTTP stream was cancelled and composer returns to ready. |
| Task / keyboard | Actual task context menu; inspect enabled split entry. New-task navigation, Ctrl+K command search/Escape, and click the sidebar session to restore its real history. Ctrl+N uses Electron native key events when Playwright keys do not invoke the menu accelerator. |

Empty, running, waiting, error and file-preview states each require **four screenshots**:
1280×800 / 1920×1080 × light / dark. Appearance also has all four variants.
Window sizing is applied to the real BrowserWindow; screenshots use CSS-pixel scale.
Every failed assertion returns a nonzero exit status and records the failing action.

## Isolation and external boundaries

- Only PATH, SYSTEMROOT, WINDIR, PATHEXT, COMSPEC, TEMP and TMP are inherited. PATH entries
  inside the actual user profile are removed. No credential/proxy/Agent environment is
  inherited. Windows-added user identity environment keys are removed before app import.
- HOME, USERPROFILE, APPDATA, LOCALAPPDATA, TEMP/TMP, ZCODE_DATA_BASE_DIR,
  ZCODE_DESKTOP_HOME_DIR, ZCODE_DESKTOP_USER_DATA_DIR and ZCODE_DESKTOP_SESSION_DATA_DIR
  point into the fresh fixture. The application name is unique per invocation.
- Main bootstrap sets Electron paths **before importing the unchanged main bundle**.
  Runtime assertions check `app.getPath('home'/'userData'/'sessionData')` inside the fixture.
  Main, host, scheduler and Node child guards record their effective home; these are audited.
- A utility-process bootstrap is necessary: merely passing `--require` through Electron's
  utility-process `execArgv` did not reliably guard the host's ESM imports. It imports the
  original host/scheduler entry after guards are installed, preserving original argv and IPC.
- Original `desktopWindowsOpenFolderContextMenu.ts` unconditionally calls `reg.exe` (no
  skip flag). All registry-related child-process calls are recorded/no-op at that boundary;
  protocol registration, recent-document mutation and external URL opening are intercepted.
  These are **simulated OS boundaries**, not verified Explorer/protocol installation.
- The directory chooser is stubbed only after clicking the real Add project/Open folder UI.
  It returns the actual isolated directory. File, Git, Agent and terminal services stay real.
- Filesystem guards deny access to the actual profile outside explicitly permitted
  application/harness/output roots and deny writes outside output. Missing sibling-runtime
  existence probes are answered false and logged, without reading those paths.
- Chromium and Node outbound connections are restricted to loopback. Original telemetry/
  vendor requests fail at the external boundary and are recorded; they are not replaced
  with fake application settings or successful account responses.
- Cleanup inventories only this launch's descendant/recorded processes and creation times.
  It first quits normally, then uses PID-scoped tree termination only for verified survivors.
  It never kills all Electron, Node or PowerShell processes. The endpoint is also closed.

## Provenance and evidence

### Actual local verification — 2026-09-22

- Successful original run: **07:08:29–07:09:53 UTC**, exit 0; **19 passed action groups,
  50 screenshot files, 9 controlled model requests**. All five required state matrices
  (empty/running/waiting/error/file-preview) have four variants each. No renderer page errors.
- Gallery: `C:\Users\niilo\AppData\Local\Temp\opencode\pi-native-32\test-results\native-parity\original\baseline-verified\index.html`.
- **4,975 package/CLI source files** match the pinned original Git blobs; no source mismatches.
  Source and prepared-output hashes match again after the GUI run (`buildUnchanged: true`).
- Installed versions observed: Electron **41.0.3**, Playwright core **1.59.1**, Vite **8.0.8**,
  tsup **8.5.1**. These dependencies and application sources/output were not changed here.
- Source digest: `74444a9982e36ee8274fe7aec6816bcc28de4b46a7281f4a3c22bddfa5a968e2`.
  Desktop-out + Agent-bundle digest: `d59fa10e049b40f99f791e6dada7d547d79cf902a2883e6050bf54c3e90dcf5a`.
- Isolation audit: **7 guarded Node/Electron processes**, all with fixture home;
  **16 registry calls intercepted**, one real-UI directory-chooser invocation, 12 denied
  sibling-runtime existence probes, zero out-of-fixture filesystem-access errors.
  Six Chromium and nine Node external network attempts were blocked.
- Cleanup: no forced termination needed, **zero surviving owned processes**.
- Default product-mode negative check against that same original build correctly returned
  exit **1**, specifically `Product renderer title must carry Pi branding` (`ZCode` observed).
  Its separate evidence is in `original/product-guard-rejection`; cleanup also has no survivors.
  This verifies the default gate rejects an unbranded original; it is **not** a branded-product pass.
- Scoped oxlint: **0 warnings / 0 errors** across the 16 script files. `--help` succeeds.
- Visual review checked actual small/light waiting, large/dark error, expanded native Read
  row, and large/light file-preview captures. Native missing `material-icons/text.svg` and
  `material-icons/zcodeignore.svg` requests remain logged as inherited asset gaps; they are
  not hidden or represented as a full clean application/error audit.

Original source: https://github.com/zai-org/ZCode at
`872ad960de7ec172591f7e1952f7849229f94521`, Apache-2.0. The harness is newly written; native
source was read to identify existing UI and OS boundaries, not copied into substitute UI.
The source/build reference remains the imported native engineering base and its retained
LICENSE/NOTICE/third-party notices.

The verified local original run uses `pi-native-32@317d286` and its prepared production
output. Source hashing covers native package and CLI `src` files, compares Git blob IDs
(allowing checkout CRLF normalization), and records installed versions. Output hashes
cover desktop `out` and the Windows Agent bundle. Source and artifact digests are checked
again after the GUI run. The importing agent's prepared-build/freeze is the build origin;
this harness does not claim a separate reproducible rebuild.

Outputs in the specified directory:

- `index.html`: locally viewable screenshot gallery, action results and explicit gaps.
- `report.json`: assertions, failures, scope, image manifest, paths, versions, request errors,
  cleanup inventory/survivors and `fullIssue32Passed: false`.
- `provenance.json` / `provenance-after.json`: source and output hashes before/after.
- `screenshots/*.png` and accompanying text snapshots.
- `trace.zip`: Playwright action/screenshot/DOM trace (`sources: false`).
- `boundaries.jsonl`: registry/chooser/network/process/home isolation audit.
- `model-requests.json`: request path, model, tool names/results, controlled scenario, status
  and cancellation. No request authentication headers or full system prompts are logged.
- `application.log`: sanitized native stdout/stderr. Deliberately blocked vendor/network
  failures and intentional HTTP 400 are distinguishable from assertion failures.

Use the manifest in `report.json`, not old probe images from another invocation.

## Known original behavior and remaining acceptance

- The pinned build has no enabled conversation-split entry in its native task menu; its
  pane-chrome split buttons are commented out in `ConversationHeader.tsx:64`. The harness
  records split create/drag/resize/focus/restore as **unavailable**. Side-pane tabs and
  side/terminal resizing are separately tested. It does not turn on hidden split state.
- Native `SidePaneTabTrigger` suppresses the first post-drag activation click in this run;
  a second visible click activates that tab. This behavior is recorded in the report.
- Physical Windows IME candidate selection, full Git/editor/install/upgrade flows, WSL/SSH,
  live provider authentication/inference and Pi execution remain outside this baseline.
- Product mode asserts Pi renderer branding and absence of vendor product login, Coding
  Plan/Start Plan/off-peak and vendor cloud-share entry test IDs/text while still creating
  a generic custom model via the native settings UI. Original mode captures original entries.

## Integration handoff

1. Main integrates this scoped test commit and branding `aff8379` itself. This worktree does
   not cherry-pick branding or change/rebuild `pi-native-32` application sources/output.
2. Preserve the verified original artifacts, then build the branded product using main's
   repaired frozen dependencies and production build scripts.
3. Run default `node scripts/native-desktop-smoke.mjs` on that product; publish its entire
   `test-results/native-parity/product` directory alongside original artifacts (CI upload
   should use `if: always()` so failures/cleanup evidence are retained).
4. Compare identically named PNGs by state/theme/size. Dynamic time, workspace path, local
   port and native session title are recorded fixture data, not structural parity proof.
5. Review vendor exclusions and unavailable actions, attach evidence to #32/#33 and wait
   for the user's explicit native-interface confirmation. A green smoke is not #33 approval.

Scoped lint command (using main's already-installed tool):

```powershell
& "C:\Users\niilo\AppData\Local\Temp\opencode\pi-native-32\node_modules\.bin\oxlint.CMD" scripts/native-desktop-smoke.mjs scripts/native-smoke
```
