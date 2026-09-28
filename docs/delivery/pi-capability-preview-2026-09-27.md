# Pi capability preview — 2026-09-27

Status: **technical preview; user acceptance deferred until the retained scope is complete**
Branch: `issue-34-native-pi-rpc`  
Baseline closeout: `docs/delivery/issue-34-closeout/closeout-2026-09-27.md`

This note records work performed after the #34 technical closeout. It does not close #34 or claim the dependent capability issues complete. The user has explicitly deferred piecemeal manual testing: technical implementation may continue across the retained scope, while all Issues that require human acceptance remain open until one coherent final trial.

## Included changes

- `06c0f88` — native Pi image prompt blocks, live model/thinking/usage facts, manual compaction, running steer/follow-up, complete stop commands, and blocking extension UI responses.
- `0b71ff0` — removes the inherited ZCode provider-registry admission gate. The pinned Pi RPC process owns model readiness and session defaults.
- `f9b24c4` — refreshes Pi model and resource-command catalogs after lazy session load and session creation.
- `2856e28`, `8d42fb9` — keep the composer resource surface Pi-scoped, avoid the retired ZCode Skill-catalog error, and remove subagent suggestions from the Pi composer.

## Local verification

| Layer | Result | Evidence |
|---|---|---|
| TypeScript | PASS | `pnpm run typecheck` |
| Changed-file lint | PASS | `pnpm exec oxlint ...` reported 0 warnings/errors |
| Pi service/runtime tests | PASS | `pnpm --dir packages/services exec tsx --test --test-concurrency=1 test/pi-*.test.ts`: 116/116 |
| Delivery ledger | PASS | local plan check and 6/6 tests; GitHub check: 17 active, 10 retired, current issue bodies/edges match |
| Desktop production build | PASS | `pnpm --filter @zcode/desktop run build:no-runtime-assets` |
| Full workspace build | BLOCKED | unrelated nested CLI debug package has esbuild host `0.28.2` / binary `0.25.12` mismatch |
| Windows bundle | PASS | electron-builder, runtime dependency audit, and 170.6 MiB size audit |
| Packaged startup | PASS | unpacked executable opened from `packages/desktop/dist/win-unpacked`; renderer title `Pi Agent IDE`, composer present, no inherited “no model” admission error |
| Packaged composer scope | PASS | `/` opened the Pi command/skill panel without Skill-catalog errors or subagent section |
| Packaged Host/Pi | PASS (startup/resume) | packaged log registered native Host channels, restored `New Pi session`, and emitted a real Pi runtime diagnostic |
| Installer install/upgrade/uninstall | NOT RUN | installer generated but not installed over the user's machine |
| Online provider | NOT RUN | no account or credential was inspected or changed |
| User acceptance | PENDING | #34 and dependent issues remain open |

The full Pi run logs contain expected Windows cleanup fallback diagnostics from tests that intentionally exercise child-process teardown; all 116 tests passed.

## Standards review

- Pi remains the authority for messages, runtime phase, queue commands, model state, thinking levels, usage, compaction, and extension request IDs.
- The UI does not create a second queue or model execution loop.
- Local images are re-read at admission, require absolute staged paths, validate MIME and size metadata, and enforce a 20 MiB limit before bytes are sent to Pi.
- Blocking extension requests require an explicit native-dialog answer. Stop cancels pending requests before clearing queues and aborting bash, retry, and the agent.
- Unknown or unsupported execution constraints continue to fail before Pi side effects.
- No remote CI workflow was restored or invoked.
- `%SystemDrive%/` and `用` remain untouched untracked user files.

## Spec review and remaining gaps

The preview improves shared technical slices but does **not** satisfy all dependent issue acceptance criteria:

- **#3 partial:** image/RPC, model/thinking, compaction and usage plumbing exists; GUI image gesture, online image/model, automatic compaction/retry and canonical cost evidence remain.
- **#4 partial:** Pi steer/follow-up and complete stop exist; attachment-preserving queue edit/reorder/retrieve and context-excluded shell UI remain.
- **#5 partial:** #34 provides real session catalog/resume and workspace isolation tests; draft/attachment and full layout restart evidence remain.
- **#6 not complete:** no versioned public extension tree-navigation/bookmark/reload bridge has been integrated into the native base.
- **#7 not complete:** inherited provider settings are not yet a verified Pi authentication center; real API-key/OAuth flows remain.
- **#8 partial:** blocking select/confirm/input/editor has a native dialog bridge and real Pi denial test; category matrix, fire-and-forget UI, reload and GUI screenshot evidence remain.
- **#9–#11 not complete:** native history branch/import/export/share, complete Pi settings editor, and llama.cpp router management remain.
- **#12 partial:** Pi resource commands are projected into the native command catalog; management/edit/reload and source inspection remain.
- **#13 partial:** blocking extension dialogs and existing Pi tool/error projection work; notify/status/widget and lifecycle coverage remain.
- **#14 partial:** the inherited local file/preview surfaces remain, but the complete reference/edit/save acceptance matrix has not been rerun.
- **#25–#26 not complete:** compatibility limitations and IME/keyboard/long-session user-flow evidence remain.
- **#27 partial:** a runnable Windows bundle and installer exist; installer lifecycle, version/diagnostic UX and recovery acceptance remain.
- **#28 blocked:** final acceptance cannot precede the implementation issues or user acceptance.

## Trial artifacts

- Unpacked app: `packages/desktop/dist/win-unpacked/Pi Agent IDE Preview.exe`
- Installer (generated, not installation-verified): `packages/desktop/dist/Pi Agent IDE Preview-3.14.0-win-x64_TEST.exe`

The unpacked directory must remain intact; do not copy only the `.exe`.
