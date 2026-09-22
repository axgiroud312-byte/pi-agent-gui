# Third-party material scope

ZCode import source: <https://github.com/zai-org/ZCode/tree/872ad960de7ec172591f7e1952f7849229f94521> (Apache-2.0 first-party code). Keep the root `LICENSE`, `NOTICE.md`, original copyrights and component-specific terms. Project provenance is recorded in `UPSTREAM.md`.

## Reproduce and verify

Use Node **24.14.0**, pnpm **10.33.2**, and a fresh checkout so `.gitattributes` has applied. From the repository root:

```powershell
pnpm install --frozen-lockfile
node scripts/licenses.mjs notices
node scripts/check-native-provenance.mjs
node scripts/licenses.mjs check
git diff -- THIRD-PARTY-NOTICES.md third-party/inventory.json
```

Run each command only after its predecessor succeeds. Commit both generated files together after reviewing the diff. A change to any recorded manifest (including desktop branding), copied source, patch, lockfile or license input requires regeneration. CI verifies committed files; it does not regenerate them to hide stale inputs.

The generator can reuse another **matching** installation read-only:

```powershell
node scripts/licenses.mjs notices --dependency-root "C:\path\to\matching-installed-workspace"
```

It checks the project set, complete workspace manifests, root manifest, workspace configuration and lockfile, then compares the full locked and installed production graphs. It scans actual installed notice bytes. Different manifests, even branding-only differences, are rejected. Do not point this at the pre-branding installation after integrating branding. `pnpm ls` runs serially per workspace from the workspace root to avoid Windows `EMFILE` and the old nested CLI lockfile.

## What the checks establish

- `check-native-provenance.mjs` is a dependency-free, offline source/material check. It checks committed notice bytes, recorded inputs, copied-source snapshots, hash-named upstream and native-search snapshots, Node license snapshots, embedded notice/build evidence and patches. It reports all missing/changed files and all outstanding material reviews.
- `licenses.mjs check` additionally checks the installed dependency graph and license identifiers. It does not certify distribution completeness.
- The generated inventory is the **production dependency union across all imported workspaces**, plus copied assets/source and native-tool material. It is not a Windows-installer-specific SBOM. It includes CLI/Web/shared build inputs even though the current product acceptance is Windows desktop.
- Native archive checksums and source references are retained in `native-search/sources.json`; binary archives and target Electron/Chromium license staging are checked by their build/packaging paths, not the offline source checker.
- Original third-party import revisions that ZCode did not record remain unknown. A fixed ZCode import and pinned license reference do not establish those earlier revisions.
- `.agents/skills/` contains 220 restored upstream material inputs. Its original instructions and examples are retained as source data; repository product goals and development instructions remain in the project's root documents.

## Outstanding material

The regenerated #32 inventory contains **19** `reviewRequired` entries. They concern the React Best Practices original notice, 15 version-specific publisher notice gaps, Skia per-platform linkage, QuickJS-NG/WASI linkage and the recorded Rust standard library notice. Exact package/version/reasons are in `inventory.json`; evidence limitations are also printed in `THIRD-PARTY-NOTICES.md`.

```powershell
node scripts/check-native-provenance.mjs --strict
# With dependencies installed, the existing release-oriented gate is also available:
node scripts/licenses.mjs check --strict
```

Strict checks intentionally fail until the material is resolved. Source freshness passing is not release-license completeness. #32 CI runs the non-strict source/install checks and visibly reports the outstanding material; installer/release acceptance remains open.
