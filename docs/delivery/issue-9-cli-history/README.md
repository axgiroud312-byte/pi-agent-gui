# #9 Pi CLI history discovery and continuation: development increment

Source branch: `issue-9-native-history`, based on `8910b33`. This is a focused #9 increment, not completion of the whole Issue or user acceptance.

## Behavior

- The existing native session list now discovers persisted JSONL sessions using the public `SessionManager.list` API from fixed `@earendil-works/pi-coding-agent@0.87.0`. It resolves the same effective session directory as Pi RPC creation: `--session-dir`, `PI_CODING_AGENT_SESSION_DIR`, or the `PI_CODING_AGENT_DIR` default.
- Pi's own session ID, file path, cwd filter, `session_info` name, first user message, and timestamps populate the existing index. A shared custom directory does not expose another workspace's sessions. No transcript copy or separate history database is created.
- An existing app bookmark may retain control metadata, but a later Pi CLI `session_info` name supersedes its stale display title. Opening a CLI session resumes the fixed Pi child under the existing single-writer lease; the GUI can continue the same JSONL, which the Pi CLI can reopen.
- No native UI component or operation path changed. The CLI history appears in the existing ZCode session list. The interaction difference is data source coverage, not a new UI control; compare against `native-ui-parity.md` for final full parity.

## Reproduction and evidence

The first test run failed with the fixed Pi CLI session absent from the native index (`actual []`, expected its real ID/title). After the change:

- `node node_modules/tsx/dist/cli.mjs --test --test-concurrency=1 packages/services/test/pi-cli-history-discovery.test.ts packages/services/test/pi-lazy-history.test.ts packages/services/test/pi-session-catalog.test.ts`: **4/4 PASS**. The new test covers custom directory cwd isolation, no extra catalog copy, fixed Pi RPC continuation, Pi CLI reopening, and a CLI rename overriding a stale app bookmark.
- Full sequential `packages/services/test/pi-*.test.ts` first run: **120/125**, with five failures solely from old lifecycle test doubles lacking the newly added directory method. After preserving those doubles' original read-only behavior, the five failing tests plus related cases and new tests were rerun: **14/14 PASS**. The full suite should be rerun after integration; the 120/125 run is not claimed as a complete pass.
- `pnpm run typecheck`: **PASS**. Targeted `oxlint` on changed service, test, and smoke script: **0 warnings / 0 errors**. `pnpm --filter @zcode/desktop run build:no-runtime-assets`: **PASS**.
- Delivery ledger: `node scripts/check-delivery-plan.mjs`, its seven tests, and `node scripts/check-delivery-plan.mjs --github`: **PASS** (parent #1, 30 child issues, 45 blocking edges). These checks validate the plan, not #9 completion.
- Native production-entry Windows Electron GUI → Host → fixed Pi RPC → deterministic local OpenAI-compatible model: report `D:\Temp\pi-cli-history-gui3-20260927\pi-cli-history-gui-report.json`. The script created CLI JSONL using Pi's public API before launch, opened it from the native sidebar, observed original messages with zero model requests on open, sent a GUI follow-up causing fixed Pi `read`, then reopened the same ID/file using Pi CLI. `pageErrors=[]`, graceful exit true, `forced=[]`, `survivors=[]`, and private Pi package cleanup passed. Screenshots: `pi-cli-history-open.png`, `pi-cli-history-continued.png` in the report directory.
- First GUI probe failed because the smoke harness deliberately stripped `PI_CODING_AGENT_SESSION_DIR`; the harness now permits that Pi-supported override. Second probe discovered/opened the history but rejected Pi's legitimate append-only `thinking_level_change` on resume; the assertion now protects the existing byte prefix. Both failed probes exited with no forced or surviving processes. Their reports remain in `D:\Temp\pi-cli-history-gui{,2}-20260927` for audit.

The local model is a deterministic fixture, not online provider evidence. This increment does not establish installer or packaged-app behavior, or human acceptance.

## Remaining #9 work

Directory search/sort/filter controls, explicit refresh while the workspace stays open, confirmed deletion, fork/clone/history edit/retry, import/export, copy/share, and temporary session handling remain open. The new index is loaded when the workspace session index is first subscribed; external CLI writes made afterward need a later explicit refresh path. No Issue checkbox should be closed from this increment alone.
