import { readFile, writeFile } from "node:fs/promises";
import { writeFileSync } from "node:fs";

const PATCH_MARKER = "; pi-agent-ide-process-path-guard-v1";
const oldFindCommand = '    nsExec::Exec `"$PowerShellPath" -C "if ((Get-CimInstance -ClassName Win32_Process | ? {$$_.Path -and $$_.Path.StartsWith(\'$INSTDIR\', \'CurrentCultureIgnoreCase\')}).Count -gt 0) { exit 0 } else { exit 1 }"`';
const safeFindCommand = "    nsExec::Exec `\"$PowerShellPath\" -NoProfile -NonInteractive -C \"$$ErrorActionPreference='Stop'; try { $$procs = @(Get-CimInstance Win32_Process | ? { $$_.Name -eq '${_FILE}' }); if (@($$procs | ? { -not $$_.Path }).Count -gt 0) { exit 2 }; if (@($$procs | ? { $$_.Path.StartsWith('$INSTDIR\\', 'OrdinalIgnoreCase') }).Count -gt 0) { exit 0 } else { exit 1 } } catch { exit 2 }\"`";
const oldKillCommand = '    nsExec::Exec `"$PowerShellPath" -C "Get-CimInstance -ClassName Win32_Process | ? {$$_.Path -and $$_.Path.StartsWith(\'$INSTDIR\', \'CurrentCultureIgnoreCase\')} | % { Stop-Process -Id $$_.ProcessId $0 }"`';
const safeKillCommand = "    nsExec::Exec `\"$PowerShellPath\" -NoProfile -NonInteractive -C \"$$ErrorActionPreference='Stop'; try { Get-CimInstance Win32_Process | ? { $$_.Path -and $$_.Path.StartsWith('$INSTDIR\\', 'OrdinalIgnoreCase') } | % { Stop-Process -Id $$_.ProcessId $0 }; exit 0 } catch { exit 2 }\"`";
const oldFindFallback = [
  "  ${else}",
  "    !ifdef INSTALL_MODE_PER_ALL_USERS",
  '      ${nsProcess::FindProcess} "${_FILE}" ${_RETURN}',
  "    !else",
  "      # find process owned by current user",
  '      nsExec::Exec `"$CmdPath" /C tasklist /FI "USERNAME eq %USERNAME%" /FI "IMAGENAME eq ${_FILE}" /FO CSV | "$FindPath" "${_FILE}"`',
  "      Pop ${_RETURN}",
  "    !endif",
  "  ${endIf}",
].join("\n");
const oldKillFallback = [
  "  ${else}",
  "    !ifdef INSTALL_MODE_PER_ALL_USERS",
  '      nsExec::Exec `taskkill /IM "${_FILE}" /FI "PID ne $pid"`',
  "    !else",
  '      nsExec::Exec `"$CmdPath" /C taskkill $0 /IM "${_FILE}" /FI "PID ne $pid" /FI "USERNAME eq %USERNAME%"`',
  "    !endif",
  "  ${endIf}",
].join("\n");
const safeFallback = [
  "  ${else}",
  `    ${PATCH_MARKER}`,
  '    DetailPrint "Pi Agent IDE: cannot safely verify process path without PowerShell"',
  "    SetErrorLevel 2",
  "    Quit",
  "  ${endIf}",
].join("\n");
const findResultCheck = [
  "    Pop ${_RETURN}",
  "    ${if} ${_RETURN} != 0",
  "    ${andIf} ${_RETURN} != 1",
  '      DetailPrint "Pi Agent IDE: process path check failed"',
  "      SetErrorLevel 2",
  "      Quit",
  "    ${endIf}",
].join("\n");
const killResultCheck = [
  "  Pop $0",
  "  ${if} $0 != 0",
  '    DetailPrint "Pi Agent IDE: process stop failed"',
  "    SetErrorLevel 2",
  "    Quit",
  "  ${endIf}",
].join("\n");

function count(source, value) {
  return source.split(value).length - 1;
}

/** Fail closed if electron-builder changes the process macros or their exact anchors. */
export function patchNsisProcessCheckSource(source) {
  const eol = source.includes("\r\n") ? "\r\n" : "\n";
  let normalized = source.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
  if (normalized.includes(PATCH_MARKER)) {
    if (count(normalized, PATCH_MARKER) !== 2 || count(normalized, safeFindCommand) !== 1 ||
        count(normalized, safeKillCommand) !== 1 || normalized.includes(oldFindCommand) ||
        normalized.includes(oldKillCommand) || normalized.includes(oldFindFallback) ||
        normalized.includes(oldKillFallback) || count(normalized, safeFallback) !== 2 ||
        count(normalized, findResultCheck) !== 1 || count(normalized, killResultCheck) !== 1) {
      throw new Error("electron-builder allowOnlyOneInstallerInstance.nsh has an inconsistent process-path patch");
    }
    return source;
  }
  if (count(normalized, oldFindCommand) !== 1 || count(normalized, oldKillCommand) !== 1 ||
      count(normalized, oldFindFallback) !== 1 || count(normalized, oldKillFallback) !== 1) {
    throw new Error("electron-builder allowOnlyOneInstallerInstance.nsh does not match the expected process macros");
  }
  normalized = normalized.replace(oldFindCommand, () => safeFindCommand)
    .replace(oldKillCommand, () => safeKillCommand)
    .replace(oldFindFallback, safeFallback)
    .replace(oldKillFallback, safeFallback)
    .replace("    Pop ${_RETURN}\n  ${else}\n    ; pi-agent-ide-process-path-guard-v1",
      findResultCheck + "\n  ${else}\n    " + PATCH_MARKER)
    .replace("  Pop $0\n!macroend \n\n!macro _CHECK_APP_RUNNING",
      `${killResultCheck}\n!macroend \n\n!macro _CHECK_APP_RUNNING`);
  return eol === "\r\n" ? normalized.replaceAll("\n", "\r\n") : normalized;
}

export async function patchNsisProcessCheckFile(filePath) {
  const source = await readFile(filePath, "utf8");
  const patched = patchNsisProcessCheckSource(source);
  if (patched === source) return { changed: false, originalSource: null };
  await writeFile(filePath, patched, "utf8");
  return { changed: true, originalSource: source };
}

export function restoreNsisProcessCheckFileSync({ filePath, originalSource }) {
  if (originalSource !== null) writeFileSync(filePath, originalSource, "utf8");
}
