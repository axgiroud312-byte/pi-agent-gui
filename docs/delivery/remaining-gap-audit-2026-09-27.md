# Remaining development gap audit — 2026-09-27

This is a starting-state audit, not an acceptance certificate. The current user instruction and `next-context.md` supersede the older pause-after-#34 language. The source of truth for acceptance is the latest GitHub Issue body and comments, with #1 as the parent specification and Draft PR #39 as the integration thread.

## Git and preservation boundary at intake

- Checked-out branch: `issue-34-native-pi-rpc`, initial HEAD `c483200`; `origin/issue-34-native-pi-rpc` matched it after fetch. Draft PR #39 and Issue #34 are open. The branch was 30 commits ahead of `main`, with no remote-only commits at intake.
- The main worktree contained untracked `%SystemDrive%/`, `用`, and `packages/desktop/dist-pi-incremental/`. The named `stash@{0}: scope-doc-copies-before-main-integration-2026-09-27` existed. These are preserved. `packages/desktop/dist/win-unpacked` was in use by a separate user process and must not be overwritten or killed.
- Additional isolated worktrees were made under `D:/Temp/pi-agent-gui-queue-audit-20260927` and `D:/Temp/pi-agent-gui-auth-audit-20260927` for delegated work. Only the root agent writes source in this main worktree.

## Gap list by dependency

| Issues | Verified starting point | Remaining acceptance gap |
| --- | --- | --- |
| #3, #5 | Fixed Pi 0.87.0 prompt, native text/image send, sent-image JSONL preview/restart, and basic session switching run in real GUI. | Unsent image vanished after restart at intake; reproduce and repair first. Then verify selection, paste, drag, model/thinking, retry/compaction, two projects/two sessions, drafts/layout/history and all relevant recovery transitions. |
| #4 | Pi text steering/follow-up and Stop have partial GUI paths. Image admission is refused with draft retained because fixed Pi `clear_queue` returns text only. | Pi-authoritative full dual-queue image recovery, item identity, edit/reorder/send-now, Stop state matrix and shell with/without model context. No host-owned substitute queue. |
| #6, #8 | Current host owns one pinned Pi subprocess and JSONL lease per session. Some RPC projections exist. | Versioned public extension bridge; tree navigation/labels/bookmarks/reload; every public extension UI class and explicit complex TUI limit. Old pre-rebase bridge code cannot be imported wholesale because its session switching violates current supervisor ownership. |
| #7 | Native ZCode provider settings surface exists. | Real Pi registry-backed API key/OAuth and logout, provider/model lifecycle, online provider proof separate from loopback model. |
| #9–#11 | Pi JSONL session catalog and narrow settings/model plumbing exist. | CLI/GUI history and tree/fork/clone/edit/retry, session management/import/export/share; Pi settings source/scope/unknown fields/concurrent write protection; actual llama.cpp router and GGUF integration. |
| #12, #13, #25 | Existing RPC extension UI request/response and native UI pieces offer partial reuse. | Skills/templates/context/packages/reload; extension state/widget/dynamic tools/lifecycle; representative public extension test matrix and recorded TUI boundary. |
| #14 | Native file views and references are available for reuse. | File reference, preview, needed editing and save-conflict acceptance through Pi workflows. |
| #26, #27 | Production-entry source GUI and an earlier isolated unpacked preview were exercised. | Chinese IME, keyboard/focus/scroll/long history, version/privacy-safe diagnostics, saving/recovery, final isolated unpacked and NSIS install/upgrade/uninstall proof. Earlier preview is not final packaging evidence. |
| #28 | `coverage.md` enumerates P01–P34, D01–D06 and V01–V12. | Recheck each item against the final source and Standards/Spec review; fix findings, then prepare one unified Windows trial. Human acceptance remains unsigned. |

External conditions to track separately: online account/OAuth callback, actual GGUF/router fixture, and permission for real NSIS installation. Their absence does not block local development, controlled fixed-Pi GUI tests, source/package checks, or issue documentation.

## Initial concrete defect

The composer persisted text in localStorage but kept unsent image `File`/upload state in renderer memory. On app restart the attachment chip and original bytes disappeared, while sent images remained in Pi JSONL. The new regression first reproduced this in the production-entry Windows desktop host with fixed Pi and a controlled loopback model. Batch evidence and limitations are recorded in `coverage.md` and `next-context.md` as work proceeds.
