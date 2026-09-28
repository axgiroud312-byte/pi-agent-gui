import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import {
  patchNsisMultiUserFile,
  patchNsisMultiUserSource,
  restoreNsisMultiUserFileSync,
} from "./patch-nsis-multi-user.mjs";

const upstreamSource = [
  "  !macro setInstallModePerUser",
  "    ${else}",
  '      StrCpy $0 "$LocalAppData\\Programs"',
  "      System::Store S",
  '      System::Call \'SHELL32::SHGetKnownFolderPath(g "${FOLDERID_UserProgramFiles}", i ${KF_FLAG_CREATE}, p 0, *p .r2)i.r1\'',
  "      ${If} $1 == 0",
  "        System::Call '*$2(&w${NSIS_MAX_STRLEN} .s)'",
  "        StrCpy $0 $1",
  "        System::Call 'OLE32::CoTaskMemFree(p r2)'",
  "      ${endif}",
  "      System::Store L",
  "    ${endif}",
  "  !macroend",
  "",
].join("\n");
const requireFromTest = createRequire(import.meta.url);

test("known-folder pointer is not dereferenced while the fallback and cleanup remain", () => {
  const patched = patchNsisMultiUserSource(upstreamSource);

  assert.notEqual(patched, upstreamSource);
  assert.doesNotMatch(patched, /System::Call '\*\$2\(&w\$\{NSIS_MAX_STRLEN\} \.s\)'/);
  assert.doesNotMatch(patched, /StrCpy \$0 \$1/);
  assert.match(patched, /StrCpy \$0 "\$LocalAppData\\Programs"/);
  assert.match(patched, /System::Call 'OLE32::CoTaskMemFree\(p r2\)'/);
  assert.match(patched, /System::Store S[\s\S]*System::Store L/);
});

test("patch is idempotent and preserves CRLF", () => {
  const input = upstreamSource.replaceAll("\n", "\r\n");
  const patched = patchNsisMultiUserSource(input);

  assert.equal(patchNsisMultiUserSource(patched), patched);
  assert.equal(patched.replaceAll("\r\n", "").includes("\n"), false);
});

test("unexpected or repeated upstream block fails before packaging", () => {
  assert.throws(
    () => patchNsisMultiUserSource(upstreamSource.replace("System::Call '*$2(&w${NSIS_MAX_STRLEN} .s)'", "System::Call 'changed'")),
    /multiUser\.nsh/,
  );
  assert.throws(() => patchNsisMultiUserSource(upstreamSource + upstreamSource), /multiUser\.nsh/);
});

test("file patch returns original bytes for exact restoration after packaging", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pi-nsis-multi-user-"));
  const path = join(directory, "multiUser.nsh");
  const original = upstreamSource.replaceAll("\n", "\r\n");

  try {
    await writeFile(path, original, "utf8");
    const result = await patchNsisMultiUserFile(path);
    assert.equal(result.changed, true);
    assert.equal(result.originalSource, original);
    assert.notEqual(await readFile(path, "utf8"), original);
    restoreNsisMultiUserFileSync({ filePath: path, originalSource: result.originalSource });
    assert.equal(await readFile(path, "utf8"), original);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("installed electron-builder template still has the exact known-folder block", async () => {
  const templatePath = resolve(
    dirname(requireFromTest.resolve("app-builder-lib/package.json")),
    "templates",
    "nsis",
    "multiUser.nsh",
  );
  const actualSource = await readFile(templatePath, "utf8");
  const patched = patchNsisMultiUserSource(actualSource);

  assert.notEqual(patched, actualSource);
  assert.doesNotMatch(patched, /System::Call '\*\$2\(&w\$\{NSIS_MAX_STRLEN\} \.s\)'/);
  assert.match(patched, /System::Call 'OLE32::CoTaskMemFree\(p r2\)'/);
});
