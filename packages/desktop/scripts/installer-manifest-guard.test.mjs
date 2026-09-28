import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { lstat, mkdir, mkdtemp, readFile, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const installerInclude = resolve(scriptDir, "../build/installer.nsh");
const nsisCache = join(
  process.env.LOCALAPPDATA ?? "",
  "electron-builder",
  "Cache",
  "nsis",
  "nsis-3.0.4.1-nsis-3.0.4.1",
  "makensis.exe",
);
const makensis = process.env.ZCODE_NSIS_MAKENSIS ?? nsisCache;
const fixtureBase = existsSync("D:/Temp") ? "D:/Temp" : tmpdir();

async function makeFixture(t, manifestEntry, junctionRelativePath = null) {
  const root = await mkdtemp(join(fixtureBase, "pi-nsis-manifest-guard-"));
  const install = join(root, "install");
  const outside = join(root, "outside");
  const rootJunction = junctionRelativePath === ".";
  const link = rootJunction
    ? install
    : junctionRelativePath
      ? join(install, junctionRelativePath)
      : null;
  const log = join(root, "uninstall.log");
  await mkdir(outside);
  if (rootJunction) await symlink(outside, install, "junction");
  else await mkdir(install);
  await writeFile(join(outside, "sentinel.txt"), "PRESERVE-ME");
  await writeFile(join(install, ".zcode-install-manifest"), `${manifestEntry}\r\n`);
  if (link) {
    if (!rootJunction) {
      await mkdir(dirname(link), { recursive: true });
      await symlink(outside, link, "junction");
    }
  } else {
    const owned = join(install, manifestEntry);
    await mkdir(dirname(owned), { recursive: true });
    await writeFile(owned, "DELETE-ME");
  }

  t.after(async () => {
    if (link) {
      try {
        await lstat(link);
        await unlink(link);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
    const absoluteBase = resolve(fixtureBase);
    const absoluteRoot = resolve(root);
    assert.ok(
      absoluteRoot.startsWith(`${absoluteBase}${sep}`),
      "fixture cleanup must stay in its owned base",
    );
    assert.ok(!(await lstat(absoluteRoot)).isSymbolicLink(), "fixture root must not be a link");
    await rm(absoluteRoot, { recursive: true });
  });

  // Standalone makensis does not inherit electron-builder's UTF-8 include settings.
  // A BOM copy changes only the encoding marker, so this executes the shipped macro.
  const source = await readFile(installerInclude, "utf8");
  const includeCopy = join(root, "installer-under-test.nsh");
  await writeFile(includeCopy, `\uFEFF${source}`);
  const sourceScript = [
    "Unicode true",
    '!include "LogicLib.nsh"',
    "!define BUILD_UNINSTALLER",
    '!define ZCODE_UNINSTALLER_FUNCTION_PREFIX ""',
    '!define ZCODE_INSTALLER_IS_ELEVATED_INNER "0 == 1"',
    '!define isUpdated "1 == 1"',
    '!define UNINSTALL_FILENAME "uninstall.exe"',
    `!define ZCODE_UNINSTALLER_LOG_PATH "${log}"`,
    `!include "${includeCopy}"`,
    'Name "Manifest Guard Regression"',
    `OutFile "${join(root, "test.exe")}"`,
    "RequestExecutionLevel user",
    "SilentInstall silent",
    "Section",
    `  StrCpy $INSTDIR "${install}"`,
    "  !insertmacro customRemoveFiles",
    "SectionEnd",
  ].join("\r\n");
  const nsi = join(root, "test.nsi");
  await writeFile(nsi, `\uFEFF${sourceScript}`);
  execFileSync(makensis, ["/V2", nsi], { windowsHide: true, timeout: 15_000 });
  let exitCode = 0;
  try {
    execFileSync(join(root, "test.exe"), ["/S"], { windowsHide: true, timeout: 15_000 });
  } catch (error) {
    exitCode = error.status;
  }
  return { root, install, outside, log, exitCode };
}

test(
  "NSIS update cleanup never follows a manifest path through a junction",
  { skip: process.platform !== "win32" || !existsSync(makensis) },
  async (t) => {
    const fixture = await makeFixture(t, "linked\\sentinel.txt", "linked");
    assert.equal(await readFile(join(fixture.outside, "sentinel.txt"), "utf8"), "PRESERVE-ME");
    assert.match(await readFile(fixture.log, "utf8"), /cleanup-failed reason=reparse-point/);
    assert.notEqual(fixture.exitCode, 0);
  },
);

test(
  "NSIS update cleanup rejects an installation root that is a junction",
  { skip: process.platform !== "win32" || !existsSync(makensis) },
  async (t) => {
    const fixture = await makeFixture(t, "sentinel.txt", ".");
    assert.equal(await readFile(join(fixture.outside, "sentinel.txt"), "utf8"), "PRESERVE-ME");
    assert.match(await readFile(fixture.log, "utf8"), /cleanup-failed reason=reparse-point/);
    assert.notEqual(fixture.exitCode, 0);
  },
);

test(
  "NSIS update cleanup checks a junction below an ordinary parent directory",
  { skip: process.platform !== "win32" || !existsSync(makensis) },
  async (t) => {
    const fixture = await makeFixture(t, "ordinary\\linked\\sentinel.txt", "ordinary/linked");
    assert.equal(await readFile(join(fixture.outside, "sentinel.txt"), "utf8"), "PRESERVE-ME");
    assert.match(await readFile(fixture.log, "utf8"), /cleanup-failed reason=reparse-point/);
    assert.notEqual(fixture.exitCode, 0);
  },
);

test(
  "NSIS update cleanup still removes an owned regular file",
  { skip: process.platform !== "win32" || !existsSync(makensis) },
  async (t) => {
    const fixture = await makeFixture(t, "ordinary\\owned.txt");
    assert.equal(existsSync(join(fixture.install, "ordinary", "owned.txt")), false);
    assert.equal(fixture.exitCode, 0);
    assert.match(await readFile(fixture.log, "utf8"), /cleanup-file path=ordinary\\owned\.txt/);
  },
);
