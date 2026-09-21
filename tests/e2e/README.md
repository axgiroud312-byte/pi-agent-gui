# Desktop / RPC acceptance tests — Issue #2

## Run

From the repository root on Windows with Node 24:

```text
npm ci
npm run typecheck
npm run lint
npm test
npm run test:contract
npm run build
npm run test:e2e
npm run package:win
```

`npm run test:e2e -- --list` checks discovery without launching Electron.
Electron supplies its own Chromium; no Playwright browser installation or Vite
server is needed. Run the build before E2E. The parallel Issue #2 host and renderer
must be integrated before executing the GUI tests.

## Boundary and isolation

Each test launches the installed Electron version with `args: ['.']`, removing
`ELECTRON_RUN_AS_NODE`. Its unique `sandbox` under `test-results/e2e` contains a
plain Unicode/space-containing workspace, Electron user data, Pi agent directory,
and fixture controls. The host's **unpackaged-only** `PI_IDE_USER_DATA` and
`PI_IDE_TEST_PROFILE` hooks select Node plus `tests/fixtures/workspace-pi.mjs`.
All workspace, profile, session, and prompt actions use visible GUI controls.
Read-only `window.piIde.snapshot()` supplies identity, Unicode fidelity, and
background-session evidence through the fixed shared contract.

The fixture is the external Pi process only. It does not replace IPC, host
projection, renderer state, or the model loop in production. Each invocation has
independent history and a fixed fixture native session ID; host session IDs,
generations, and PIDs must still be independent.

### Deterministic external timing

`--fixture-control-dir=<absolute directory>` records inbound/outbound JSONL in
`<pid>.jsonl`. Creating `<pid>-<run>-<stage>` releases one stage. Run numbers start
at 1 for accepted, non-pending prompts; stages are `start`, `finish`, `settle`, and
`retry`. This holds acceptance, streamed deltas, authoritative `message_end`, and
`agent_end` apart until assertions/screenshots finish. The application receives
only ordinary Pi commands/events. Without a control directory the fixture uses
short delays, so it can also be exercised directly through `PiRpcClient`.
The fixture incrementally escapes literal U+2028/U+2029 before Node 24's
`readline` can mistake them for record separators; JSON parsing restores them.

Special inputs:

| Input / option | External behavior |
| --- | --- |
| ordinary text | Accept, echo Unicode deltas, correct them with the final message, emit `agent_end`, then later `agent_settled` |
| `fail` | One failed `prompt` response with an authentication error; no run |
| `crash` | Write stderr and exit 43 with the request in flight |
| `pending` | Leave the command pending until timeout/disposal/process exit |
| `retry` | Failed assistant turn, retry start/end, successful turn, delayed settlement |
| `--fixture-version=0.86.0` | Make `--version` return an incompatible version |

## GUI contract / integration assumptions

- Textboxes: `工作区路径`, `消息`, `Pi 可执行文件`, `Pi 参数（JSON 数组）`,
  `Pi 配置目录`.
- Buttons: `打开工作区`, `新建会话`, `发送`, `保存启动配置`.
  If profile fields are collapsed, `运行配置` opens them.
- Active-session test IDs: `run-phase`, `session-error`. Run labels:
  `已接收`, `运行中`, `已完成`.
- Workspace/startup diagnostics have `role="alert"`; creating a healthy session
  selects it and eventually exposes `idle` with a live PID in the public snapshot.
- Correcting a rejected prompt allows explicit resubmission. Correcting a startup
  profile allows a new session. Neither failure triggers automatic prompt replay.
- Creating a second session leaves the first running. The crash test completes
  that background session and checks it through the read-only public snapshot;
  it does not assume a session-navigation label that has not been agreed yet.

## Evidence and scope

Key states are saved as PNGs in each test's output directory and attached using
`testInfo.attach`. Every test also attaches its final screenshot/snapshot,
external RPC transcript, and Electron log. Failures retain an Electron-context
trace. Temporary profiles are removed after process shutdown. HTML/JUnit reports
and screenshots remain in `playwright-report` / `test-results` for CI upload.

`tests/contract/pi-cli.test.ts` separately launches the installed package's real
`bin.pi` with Pi 0.87.0. It checks `--version`/`--help`, correlated `get_state`,
`get_messages`, `get_commands`, and an unknown command followed by a successful
state query. The unknown-command round trip includes Chinese, emoji, and literal
U+2028/U+2029 to check the real JSONL boundary. The CLI uses isolated
cwd/agent/home directories, an empty local
auth file, an environment stripped of inherited credentials, and validated
offline/no-resource/no-session flags (`--no-context-files` also disables ancestor
instructions). Its transcript is `test-results/contract/real-pi-rpc.json`.

Pi 0.87.0 still registers the bundled inline `llama` command with
`--no-extensions`; the contract checks its presence and `sourceInfo` shape rather
than incorrectly requiring an empty catalog. No contract test calls a provider.

These are offline GUI acceptance tests plus a **real Pi protocol smoke**, not
real-model, installed-application, or full-release acceptance. Fixture and tests
are locally authored against the MIT upstream release
`16787ad5b2dc748047f314ca1bfe7708f30f54f3`; no upstream source was copied. See
`docs/references/upstream-and-ui.md` for the pinned protocol/type sources.
