import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { dirname, join, resolve, sep } from "node:path";
import { test } from "node:test";
import {
  patchNsisProcessCheckFile,
  patchNsisProcessCheckSource,
  restoreNsisProcessCheckFileSync,
} from "./patch-nsis-process-check.mjs";

const requireFromTest = createRequire(import.meta.url);
const upstreamPath = resolve(
  dirname(requireFromTest.resolve("app-builder-lib/package.json")),
  "templates/nsis/include/allowOnlyOneInstallerInstance.nsh",
);
const nsisCache = join(
  process.env.LOCALAPPDATA ?? "",
  "electron-builder/Cache/nsis/nsis-3.0.4.1-nsis-3.0.4.1/makensis.exe",
);
const makensis = process.env.ZCODE_NSIS_MAKENSIS ?? nsisCache;

test("process check patch fails closed without path-aware PowerShell and bounds install path", async () => {
  const original = await readFile(upstreamPath, "utf8");
  const patched = patchNsisProcessCheckSource(original);
  assert.notEqual(patched, original);
  assert.doesNotMatch(patched, /taskkill \/IM|taskkill \$0 \/IM|\$\{nsProcess::FindProcess\}/);
  assert.equal((patched.match(/\.Path\.StartsWith\('\$INSTDIR\\', 'OrdinalIgnoreCase'\)/g) ?? []).length, 2);
  assert.doesNotMatch(patched, /\.Path\.StartsWith\('\$INSTDIR', 'CurrentCultureIgnoreCase'\)/);
  assert.match(patched, /cannot safely verify process path without PowerShell/);
  assert.doesNotMatch(patched, /!insertmacro IS_POWERSHELL_AVAILABLE/);
  assert.match(patched, /StrCpy \$IsPowerShellAvailable 0/);
  assert.match(
    patched,
    /ZCodeReportInstallerProcessCheck "query-mode=direct-guarded executable=\$\{APP_EXECUTABLE_FILENAME\}"/,
  );
  assert.match(
    patched,
    /ZCodeReportInstallerProcessCheck "find status=\$\{_RETURN\} executable=\$\{_FILE\}"/,
  );
  assert.equal(patchNsisProcessCheckSource(patched), patched);
});

test("process check patch rejects changed or repeated upstream anchors", async () => {
  const original = await readFile(upstreamPath, "utf8");
  assert.throws(() => patchNsisProcessCheckSource(original.replace("${nsProcess::FindProcess}", "${nsProcess::DifferentFind}")), /allowOnlyOneInstallerInstance\.nsh/);
  assert.throws(() => patchNsisProcessCheckSource(original + original), /allowOnlyOneInstallerInstance\.nsh/);
});

test("process check file patch preserves CRLF and restores original bytes", async () => {
  const base = existsSync("D:/Temp") ? "D:/Temp" : tmpdir();
  const directory = await mkdtemp(join(base, "pi-nsis-process-patch-"));
  const path = join(directory, "allowOnlyOneInstallerInstance.nsh");
  const original = (await readFile(upstreamPath, "utf8")).replaceAll("\r\n", "\n").replaceAll("\n", "\r\n");
  try {
    await writeFile(path, original, "utf8");
    const result = await patchNsisProcessCheckFile(path);
    assert.equal(result.changed, true);
    assert.equal(result.originalSource, original);
    assert.equal((await readFile(path, "utf8")).replaceAll("\r\n", "").includes("\n"), false);
    restoreNsisProcessCheckFileSync({ filePath: path, originalSource: result.originalSource });
    assert.equal(await readFile(path, "utf8"), original);
  } finally {
    const actual = resolve(directory);
    assert.ok(actual.startsWith(`${resolve(base)}${sep}`));
    await rm(actual, { recursive: true });
  }
});

test("real makensis fallback macros abort before a name-wide probe or stop", {
  skip: process.platform !== "win32" || !existsSync(makensis),
}, async () => {
  const base = existsSync("D:/Temp") ? "D:/Temp" : tmpdir();
  const directory = await mkdtemp(join(base, "pi-nsis-process-fallback-"));
  try {
    const template = patchNsisProcessCheckSource(await readFile(upstreamPath, "utf8"));
    const patchedPath = join(directory, "allowOnlyOneInstallerInstance.nsh");
    await writeFile(patchedPath, `\uFEFF${template}`, "utf8");
    await copyFile(resolve(dirname(upstreamPath), "nsProcess.nsh"), join(directory, "nsProcess.nsh"));
    await copyFile(resolve(dirname(upstreamPath), "getProcessInfo.nsh"), join(directory, "getProcessInfo.nsh"));
    for (const macro of ["FIND_PROCESS", "KILL_PROCESS"]) {
      const nsi = join(directory, `${macro}.nsi`);
      const exe = join(directory, `${macro}.exe`);
      const script = [
        "Unicode true",
        '!include "LogicLib.nsh"',
        `!include "${patchedPath}"`,
        `Name "${macro} fail closed"`,
        `OutFile "${exe}"`,
        "RequestExecutionLevel user",
        "SilentInstall silent",
        "Var IsPowerShellAvailable",
        "Var CmdPath",
        "Var FindPath",
        "Section",
        "  StrCpy $IsPowerShellAvailable 1",
        '  StrCpy $CmdPath "$SYSDIR\\cmd.exe"',
        '  StrCpy $FindPath "$SYSDIR\\find.exe"',
        macro === "FIND_PROCESS"
          ? '  !insertmacro FIND_PROCESS "PiNsisNoSuchOwnedFixture.exe" $R0'
          : '  !insertmacro KILL_PROCESS "PiNsisNoSuchOwnedFixture.exe" 1',
        "  SetErrorLevel 0",
        "SectionEnd",
      ].join("\r\n");
      await writeFile(nsi, `\uFEFF${script}`, "utf8");
      execFileSync(makensis, ["/V2", nsi], { windowsHide: true, timeout: 15_000 });
      let exitCode = 0;
      try {
        execFileSync(exe, ["/S"], { windowsHide: true, timeout: 15_000 });
      } catch (error) {
        exitCode = error.status;
      }
      assert.equal(exitCode, 2, `${macro} must abort when only image-name matching is available`);
    }
  } finally {
    const actual = resolve(directory);
    assert.ok(actual.startsWith(`${resolve(base)}${sep}`));
    await rm(actual, { recursive: true });
  }
});

test("real makensis process lookup distinguishes owned install from a sibling prefix", {
  skip: process.platform !== "win32" || !existsSync(makensis),
}, async () => {
  const base = existsSync("D:/Temp") ? "D:/Temp" : tmpdir();
  const directory = await mkdtemp(join(base, "pi-nsis-process-boundary-"));
  const install = join(directory, "install");
  const sibling = join(directory, "install-extra");
  const executableName = `PiNsisGuard${process.pid}.exe`;
  let child;
  try {
    await Promise.all([mkdir(install), mkdir(sibling)]);
    const template = patchNsisProcessCheckSource(await readFile(upstreamPath, "utf8"));
    const patchedPath = join(directory, "allowOnlyOneInstallerInstance.nsh");
    await writeFile(patchedPath, `\uFEFF${template}`, "utf8");
    await copyFile(resolve(dirname(upstreamPath), "nsProcess.nsh"), join(directory, "nsProcess.nsh"));
    await copyFile(resolve(dirname(upstreamPath), "getProcessInfo.nsh"), join(directory, "getProcessInfo.nsh"));
    const nsi = join(directory, "process-boundary.nsi");
    const exe = join(directory, "process-boundary.exe");
    const debugLog = join(directory, "process-boundary.log");
    const script = [
      "Unicode true",
      '!include "LogicLib.nsh"',
      `!include "${patchedPath}"`,
      'Name "Process boundary lookup"',
      `OutFile "${exe}"`,
      "RequestExecutionLevel user",
      "SilentInstall silent",
      "Var IsPowerShellAvailable",
      "Var PowerShellPath",
      "Section",
      "  StrCpy $IsPowerShellAvailable 0",
      '  StrCpy $PowerShellPath "$SYSDIR\\WindowsPowerShell\\v1.0\\powershell.exe"',
      `  StrCpy $INSTDIR "${install}"`,
      `  !insertmacro FIND_PROCESS "${executableName}" $R0`,
      `  FileOpen $0 "${debugLog}" w`,
      '  FileWrite $0 "inst=$INSTDIR result=$R0 shell=$PowerShellPath$\\r$\\n"',
      "  FileClose $0",
      "  SetErrorLevel $R0",
      "SectionEnd",
    ].join("\r\n");
    await writeFile(nsi, `\uFEFF${script}`, "utf8");
    execFileSync(makensis, ["/V2", nsi], { windowsHide: true, timeout: 15_000 });
    const probe = () => {
      try {
        execFileSync(exe, ["/S"], { windowsHide: true, timeout: 15_000 });
        return 0;
      } catch (error) {
        return error.status;
      }
    };
    for (const [runningDirectory, expected] of [[sibling, 1], [install, 0]]) {
      const ownedExe = join(runningDirectory, executableName);
      await copyFile(process.execPath, ownedExe);
      child = spawn(ownedExe, ["-e", "setInterval(() => {}, 1000)"], {
        stdio: "ignore", windowsHide: true,
      });
      await new Promise((resolve, reject) => {
        child.once("spawn", resolve);
        child.once("error", reject);
      });
      assert.equal(child.exitCode, null);
      const observedPath = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
        `(Get-CimInstance Win32_Process -Filter 'ProcessId = ${child.pid}').Path`], {
        windowsHide: true, timeout: 15_000,
      }).toString().trim();
      assert.equal(observedPath.toLowerCase(), ownedExe.toLowerCase());
      const directProbe = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
        `if (@(Get-CimInstance Win32_Process | ? {$_.Path -and $_.Path.StartsWith('${install}\\', 'OrdinalIgnoreCase')}).Count -gt 0) { exit 0 } else { exit 1 }`], {
        windowsHide: true, stdio: "ignore",
      });
      const directExit = await new Promise(resolve => directProbe.once("exit", resolve));
      assert.equal(directExit, expected, "the same PowerShell predicate must match the fixture path");
      const result = probe();
      const debug = await readFile(debugLog, "utf8");
      assert.equal(result, expected, `${runningDirectory} must ${expected ? "not" : ""} match ${install}; ${debug}`);
      child.kill();
      await new Promise(resolve => child.once("exit", resolve));
      child = null;
    }
  } finally {
    if (child?.exitCode === null) {
      child.kill();
      await new Promise(resolve => child.once("exit", resolve));
    }
    const actual = resolve(directory);
    assert.ok(actual.startsWith(`${resolve(base)}${sep}`));
    await rm(actual, { recursive: true });
  }
});

test("real makensis process lookup runs the guarded query without a separate availability gate", {
  skip: process.platform !== "win32" || !existsSync(makensis),
}, async () => {
  const base = existsSync("D:/Temp") ? "D:/Temp" : tmpdir();
  const directory = await mkdtemp(join(base, "pi-nsis-process-direct-query-"));
  try {
    const template = patchNsisProcessCheckSource(await readFile(upstreamPath, "utf8"));
    const patchedPath = join(directory, "allowOnlyOneInstallerInstance.nsh");
    await writeFile(patchedPath, `\uFEFF${template}`, "utf8");
    await copyFile(resolve(dirname(upstreamPath), "nsProcess.nsh"), join(directory, "nsProcess.nsh"));
    await copyFile(resolve(dirname(upstreamPath), "getProcessInfo.nsh"), join(directory, "getProcessInfo.nsh"));
    const nsi = join(directory, "direct-query.nsi");
    const exe = join(directory, "direct-query.exe");
    const script = [
      "Unicode true",
      '!include "LogicLib.nsh"',
      `!include "${patchedPath}"`,
      'Name "Direct guarded process lookup"',
      `OutFile "${exe}"`,
      "RequestExecutionLevel user",
      "SilentInstall silent",
      "Var IsPowerShellAvailable",
      "Var PowerShellPath",
      "Section",
      '  StrCpy $PowerShellPath "$SYSDIR\\WindowsPowerShell\\v1.0\\powershell.exe"',
      "  StrCpy $IsPowerShellAvailable 0",
      "  StrCpy $INSTDIR \"D:\\Temp\\pi-nsis-no-running-app\"",
      '  !insertmacro FIND_PROCESS "PiNsisGuardNoProc.exe" $R0',
      "  SetErrorLevel $R0",
      "SectionEnd",
    ].join("\r\n");
    await writeFile(nsi, `\uFEFF${script}`, "utf8");
    execFileSync(makensis, ["/V2", nsi], { windowsHide: true, timeout: 15_000 });
    let exitCode = 0;
    try {
      execFileSync(exe, ["/S"], { windowsHide: true, timeout: 15_000 });
    } catch (error) {
      exitCode = error.status;
    }
    assert.equal(exitCode, 1, "the real query must report only that the fixture is not running");
  } finally {
    const actual = resolve(directory);
    assert.ok(actual.startsWith(`${resolve(base)}${sep}`));
    await rm(actual, { recursive: true });
  }
});
