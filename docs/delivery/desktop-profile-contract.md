# Desktop application-data identity (#32)

Delivery status (2026-09-23): this correction and the saved-workflow follow-up are integrated through PR #37. Actual full production/default-entry and GUI checks passed; see [acceptance](issue-32-acceptance.md). The user subsequently approved #33 ([record](native-ui-confirmation.md)). The owned-worktree verification and integration-gate notes below retain their historical scope; they do not reopen #32/#33.

This supersedes the `4b43635` HOME-rewriting implementation. Review reproduced an early shared-chunk path snapshot, lost execution-home configuration, and credential/history breakage after a data-directory move. The original single-entry tests did not prove production startup ordering.

## Boundaries and priority

- Preserve execution `HOME`, `USERPROFILE`, and `ZCODE_DESKTOP_HOME_DIR` byte-for-byte. They continue to mean OS/test home for Git, SSH, terminals, tilde expansion and credential key derivation.
- Introduce **one** application anchor variable: `ZCODE_DESKTOP_PROFILE_HOME`. It is an absolute directory, defaulting to `<execution home>/.pi-agent-ide`; the desktop bootstrap normalizes an explicit value. Services/CLI without this variable keep their upstream defaults.
- Pi settings are always `<profile home>/.zcode/v2/setting.json`. No fallback probe/import of the original ZCode settings is permitted.
- Active v2 data root: explicit caller `ZCODE_DATA_BASE_DIR` > `dataBaseDir` persisted in Pi settings > profile home. An explicit caller override skips the bootstrap settings read. The selected absolute data root is **always** written to `ZCODE_DATA_BASE_DIR` before importing any application dependency.
- v2 files (including credentials) use the active data root and the native v2 copy/migration path. Execution home remains stable, so the existing credential encryption key remains stable.
- Agent CLI configuration, history, workflow/resources and logs use the **stable profile home**, not the movable v2 data root: existing `ZCODE_HOME`, `ZCODE_STORAGE_DIR`, `ZCODE_LOG_DIR`, session DB keys and app-specific path resolvers point there. Workspace-local `.zcode` paths and external `.agents`/Git/SSH files retain their original meanings.
- The existing settings UI keeps its layout. System info may expose the app profile home separately from `homedir` so its default-data-directory display/reset does not mislabel execution home as app data.

## Production entry and relaunch

- `package.main` names a tiny **unsplit** ESM bootstrap. It imports only Node builtins and the pure desktop profile policy, selects the environment, then uses an **indirect dynamic import** of the absolute `out/main/index.js` file URL. A first static import inside a split main bundle is not a bootstrap barrier.
- tsup compiles this entry separately with `splitting:false`; native main/host/worker splitting remains intact. Development readiness and smoke entry discovery read the real package.main.
- Bootstrap saves typed caller/derived state in a process-global symbol and wraps Electron's public `app.relaunch`. A versioned private relaunch argument carries the original caller override plus the last derived root. On the next entry, only an unchanged inherited derived root is replaced with the original caller state before resolution. A newly changed caller env override wins. This avoids clearing arbitrary env or treating a computed root as an explicit override forever.
- The relaunch marker is removed from runtime argv and is not a new environment variable. It contains paths/state only, no credentials. Invalid markers fail visibly.

## Required regression evidence

1. Build the actual tsup production multi-entry main and unsplit bootstrap in the owned tree; inspect emitted import boundaries, not a single-entry source VM.
2. Provide an Electron regression command accepting a prepared `--app-root`. Launch its actual package.main with fake execution HOME and **no app/data-root env overrides**. Check the actual shared-chunk services getter and reject any original-profile file access. Run this on the integrated prepared product before claiming production pass.
3. Exercise real Git global config, native SSH alias discovery and terminal execution home using temporary user files.
4. Encrypt/save credentials, invoke the real v2 data move, restart, and decrypt the copied credential; verify Agent history/config paths and content remain anchored.
5. Check explicit data override, Pi persisted custom directory, relaunch after a directory change, and standalone CLI defaults. Keep old tests that assert HOME rewriting replaced, not relaxed.

No UI redesign, Pi #34 implementation, Marketplace frozen-source edits, or change to the main agent's local-only crash bootstrap is part of this correction. #32 stays open for integrated verification and #33 still needs user approval.

## Implementation map

The native source remains [ZCode@872ad960de7ec172591f7e1952f7849229f94521](https://github.com/zai-org/ZCode/tree/872ad960de7ec172591f7e1952f7849229f94521), Apache-2.0; existing LICENSE/NOTICE/third-party attribution is retained. This patch adjusts the imported path providers rather than replacing the native services or credential cipher.

| Boundary | Implementation |
| --- | --- |
| Pre-link application identity | `packages/desktop/src/bootstrap.ts`, `src/main/desktopProductProfile.ts`; `package.main = out/bootstrap.mjs` |
| Actual build/development entry | `packages/desktop/tsup.config.ts`, `scripts/dev.mjs`, `write-dev-ready-marker.mjs`, `run-production-build.mjs` |
| Stable app paths, native execution home | `packages/shared/src/node/applicationProfile.ts`, exported only from `@zcode/shared/node` |
| Native settings/migration | `packages/services/src/setting/settingService.ts`; existing v2 copy and credential encryption remain authoritative |
| Host/scheduler inheritance | `packages/desktop/src/main/desktopRuntimeEnv.ts`; explicit active v2 root plus stable CLI config/storage/log/session roots |
| Agent resource resolution | CLI config, context `AGENTS.md`, commands, skills, hook-trust store, workflow, session DB and log adapters; only app-owned user paths are redirected |
| Desktop resource resolution | Services commands/hooks/skills/subagents/MCP and resource-sync paths; trajectory/log lookup and runtime discovery; desktop log export and storage-manager root injection |
| Default-directory presentation | Optional `SystemInfo.profileHome` and one value-selection change in `SettingsPage.tsx`; execution `homedir` remains separate |

```text
<execution home>/                    # unchanged Git / SSH / terminal / external .agents
<profile>/.zcode/v2/setting.json      # stable Pi settings, including dataBaseDir
<active data root>/.zcode/v2/         # native movable data and encrypted credentials
<profile>/.zcode/cli/config.json      # stable Agent config
<profile>/.zcode/cli/db/db.sqlite     # stable Agent history
<profile>/.zcode/cli/log/             # stable Agent logs
<profile>/.zcode/skills, commands, …  # stable app-owned resources
<workspace>/.zcode/                  # unchanged project-local meaning
```

Windows caller environment keys are read through `process.env` before constructing the policy snapshot, preserving the OS's case-insensitive lookup. Relaunch markers reject unknown versions, non-absolute paths and duplicate markers before environment mutation.

## Verification performed in the owned branding worktree

Windows, Node 24.14.0, tsup 8.5.1. External packages were borrowed read-only from the installed integration worktree through standard `NODE_PATH`; application source resolved to this worktree. No dependency installation or whole-product build was performed.

| Check | Actual result |
| --- | --- |
| `node --test packages/desktop/test/desktop-product-profile.test.mjs packages/desktop/test/profile-file-guard.test.mjs` | **8 passed**: 7 profile/relaunch cases plus the actual cross-process file guard. The guard test borrowed the integration harness via `NATIVE_SMOKE_HARNESS`. |
| `node apps/zcode-cli/test/run-product-policy.mjs packages/desktop/test/desktop-profile-native.test.mjs` | **4 passed**, using independent Node processes, real Git global config, native SSH alias discovery, native terminal-profile parsing and a real shell. |
| Native data/resource coverage within those 4 cases | Real credential encryption and v2 copying, restart/decryption, reset-to-default/decryption, SQLite session persistence, profile/standalone defaults, explicit override (including Windows lower-case env key), real user instructions/skills/commands/hook-trust paths; external `.agents` and workspace resources remain visible. Legacy-profile access count is zero and legacy sentinels are unchanged. |
| `node apps/zcode-cli/test/run-product-policy.mjs` | **10 passed**: existing Marketplace/redirect/refresh/manual-feedback contracts. |
| From `packages/desktop`: `node test/build-profile-production.mjs` | **Passed**: actual production tsup bootstrap plus four main entries, minification enabled, source maps disabled, bootstrap unsplit/main split; **17 fresh shared chunks**. Old main chunks are removed before this targeted build. |
| `node packages/desktop/test/production-profile-entry.mjs --app-root packages/desktop --inspect-only` | **Passed**: actual `out/bootstrap.mjs`, no static SDK/chunk import, indirect dynamic main import and split production main present. **This is artifact inspection, not Electron execution.** |
| Same command without `--inspect-only` | **Blocked before Electron launch**: prepared `out/preload/index.cjs` is absent (`ENOENT`). No runtime pass is claimed. |
| Scoped TypeScript check | **Passed** for bootstrap, its profile-policy import and the Node-only application-profile helper, using borrowed real Node/Electron declarations, `--noEmit --strict --skipLibCheck --target es2025 --module nodenext --moduleResolution nodenext`. |
| Root-tool lint of 40 changed/new non-CLI code files | **0 errors / 13 existing warnings**. |
| CLI-tool lint of the 12 changed CLI source/runner files | **3 existing max-lines errors / 0 warnings**: file-config adapter, model runner-debug, hook-trust store; no suppression added. |
| Full `pnpm lint` | **Not passed**: 70 warnings and the existing `max-lines` error in `.backup-old-prototype/src/runtime/pi-rpc-client.ts`; the integration branch owns archive exclusion. |
| Full `pnpm --dir apps/zcode-cli lint --concurrency=1` | **Not passed**: stopped on two existing debug-package max-lines errors. Separate real `oxlint src` runs: adapters **25 errors / 18 warnings**, bootstrap **20 errors / 22 warnings**, all errors max-lines. Cached sibling-package logs are not new verification. |
| `pnpm typecheck` / `pnpm --dir apps/zcode-cli typecheck --concurrency=1` | **Not passed**: this uninstalled worktree lacks workspace/Node type resolution; root also reports the pre-existing cross-project TS5055 at desktop-product-identity.mjs, CLI stops on adapters' missing Node types. Incidental untracked source-tree compiler outputs were removed. |
| `scripts/architecture/architecture-check.mjs check --changed` | **Passed, 0 violations**, after borrowing only `typescript` and `yaml` through a temporary Node ESM resolver. Direct execution initially failed to resolve those uninstalled dependencies; application imports/policy were unchanged. |
| Frozen Marketplace sources | `git diff --exit-code c896a8d --` the three frozen sources is empty; no byte/content changes. |

These are 22 passing focused tests, not a full-suite, full typecheck or full Electron acceptance claim. The source-level host/scheduler/Agent roles check inheritance in separate Node processes; they are not a running Electron host or a model inference session.

The scoped typecheck used the installed worktree only for the compiler/declarations (`$InstalledRoot`), not for application code:

```powershell
& "$InstalledRoot/node_modules/.bin/tsc.cmd" --ignoreConfig --noEmit --strict --skipLibCheck --target es2025 --module nodenext --moduleResolution nodenext --types node --typeRoots "$InstalledRoot/node_modules/@types" packages/desktop/src/bootstrap.ts packages/shared/src/node/applicationProfile.ts "$InstalledRoot/node_modules/electron/electron.d.ts"
```

## Integration and remaining production gate

1. Rebuild main, host, scheduler, preload, Agent and renderer from the integrated source using the native preparation/build flow. Refresh provenance/build metadata and the relevant non-Marketplace CLI lint-baseline records in the integration branch. Do not reuse mixed old/new bundles.
2. Merge the minimal `scripts/native-smoke/bootstrap.cjs` change: read `package.main` rather than hard-coding `out/main/index.js`; explicitly pin `ZCODE_DESKTOP_PROFILE_HOME` to the controlled parity fixture HOME. This file is newly added on the branding branch but already exists on the integration branch, so expect an **add/add conflict**. Preserve the integration guard/cleanup fixes; the two functional adjustments above are the intended delta.
3. Add the following regression to the integrated Windows CI **after** preparing the complete desktop app. The branding worktree lacks that prepared app and the rest of `scripts/native-smoke`, so actual Electron execution is still pending:

   ```powershell
   node packages/desktop/test/production-profile-entry.mjs --app-root packages/desktop
   ```

   The command accepts another prepared desktop directory via `--app-root`. It launches the real package.main with temporary execution HOME and no app/data-root override, waits for a real window, inspects the actual exported services getter in emitted shared chunks, checks HOME and roots, rejects legacy-profile access, and calls the integration `closeOwned` cleanup. Main, utility hosts and env-sanitizing Node children receive test-only file guards. Fixture writes stay below the harness output root. Guard self-tests are separate from application-runtime verification.

   Artifacts: `<prepared repo>/test-results/profile-default-entry/{report.json,boundaries.jsonl,cleanup.json}`. A passing report is written only after runtime assertions, process cleanup and boundary-log checks succeed.
4. Run the existing native parity smoke, including Git/SSH/terminal, directory change/relaunch, credential/history continuity, diagnostic export and storage-manager paths. #32 remains open for these integration results; #33 remains open for the user's actual UI confirmation.

## P2 follow-up: saved workflow lifecycle

Integration update supplied by the main agent: `111df63` was integrated as `eac5a22`; at integration HEAD `8128828`, the full production build, real default-entry Electron regression (17 chunks, no legacy access, execution HOME preserved), 82 tests and 19 GUI groups passed. Those integration results supersede the earlier prepared-app gap above; they are not new runs in this exclusive worktree. Both independent reviewers subsequently identified this saved-workflow path gap, so #32 still requires re-review and #33 is not approved.

Correction contract, before implementation:

- The saved `.dwf.ts` archive's shared root resolver must use `options.homeDir ?? getApplicationProfileHome()`: an explicit `homeDir` remains authoritative (including the existing empty/relative option semantics); otherwise use `ZCODE_DESKTOP_PROFILE_HOME`, falling back to native `homedir()` when the profile variable is absent/blank.
- Keep `<cwd>/.zcode/workflows`, default project scope, project-first shadowing and explicit scope selection unchanged. Global workflows stay anchored across `ZCODE_DATA_BASE_DIR` / `ZCODE_STORAGE_DIR` changes, matching the application anchor already used by legacy named `.workflow.js` lookup; the two file formats remain distinct.
- SaveWorkflow's approval facts/write, store list/get/exists/shadowing/move, GUI list/get/update/delete/move, and saved-source run resolution must use the same root. No execution HOME mutation, automatic legacy import or legacy fallback is allowed.
- Verify against actual temporary files and the native store/tool/API modules, with an original-home sentinel and file-access guard. Cover global round trips, project precedence/defaults, explicit home options, standalone defaults, and native run-source/draft resolution. Application/Agent execution and integration re-review remain the main agent's follow-up.

Implementation: only `apps/zcode-cli/packages/core/src/tool/handlers/saved-workflows/store.ts` changes in production source. `savedWorkflowRoots` now delegates its default global home to the existing Node-only `getApplicationProfileHome`; the explicit `homeDir ??` remains outside that helper so an injected home cannot be overridden by the desktop profile. All existing store, tool and GUI callers inherit the correction without API/schema changes. Source/attribution remain the fixed Apache-2.0 ZCode base recorded above.

### Follow-up evidence (owned worktree, Windows / Node 24.14.0)

```powershell
node apps/zcode-cli/test/run-product-policy.mjs packages/desktop/test/saved-workflow-profile.test.mjs
```

- Before the source fix: **2 failed / 2 passed**. The desktop lifecycle recorded a real `readdirSync` against the temporary legacy workflow archive; the save/options case recorded `statSync` and `mkdirSync` there. The guard rejected those accesses. Standalone absent/blank-profile cases already passed.
- After the source fix: **4/4 passed**. Tests run the owned native code in fresh Node processes, with temporary execution HOME, a separate Pi profile, unrelated v2/storage overrides and a third explicit-home directory. Only installed dependencies/generated TypeScript standard-library text are borrowed read-only through `NODE_PATH`; no integration build or actual user data is involved.
- Exercised actual SaveWorkflow normalization/approval facts, native script typechecking and file writes; ListSavedWorkflows; GUI list/get/metadata-update/delete/move; existence/overwrite/shadowing; byte-preserving moves and target-conflict rejection. `CreateWorkflow(saved)` reads the selected native definition and writes an actual byte-identical draft. Tests stop at run-source resolution: they do not claim model calls, workflow-engine execution or Electron GUI automation.
- Original-home same-name and legacy-only `.dwf.ts` sentinels remain byte-identical. Desktop cases observe **zero** legacy archive probes/reads/writes, including failed lookup/update/delete/move and missing saved-source resolution. Execution HOME/USERPROFILE/homedir remain unchanged. Unscoped saves/GUI actions stay project-local; project-first lookup, explicit global lookup, explicit/empty/relative/undefined `homeDir`, and standalone absent/blank-profile defaults are preserved.
- Scoped CLI lint: from `apps/zcode-cli/packages/core`, `oxlint src/tool/handlers/saved-workflows/store.ts --no-ignore` — **1 file, 0 warnings / 0 errors**. Root-tool lint of `packages/desktop/test/saved-workflow-profile.test.mjs` — **1 file, 0 warnings / 0 errors**.
- Existing `scripts/architecture/architecture-check.mjs check --changed` — **0 violations**, using the same temporary ESM resolver for borrowed TypeScript/YAML dependencies as the previous stage. `git diff --check` passed.

Delivery is limited to the root resolver, this regression file and this contract update. Full typecheck/build, integration CI/baseline refresh, GUI reruns and independent re-review are not performed by this follow-up. The main agent must obtain both reviewers' re-review before closing #32; #33 remains unapproved and #34 untouched.
