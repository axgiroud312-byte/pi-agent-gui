import { readFile, writeFile } from "node:fs/promises";
import { writeFileSync } from "node:fs";

export const NSIS_USER_PROGRAMS_FALLBACK_MARKER = "; pi-agent-ide-user-programs-fallback-v1";

const knownFolderBlock = [
  '      System::Call \'SHELL32::SHGetKnownFolderPath(g "${FOLDERID_UserProgramFiles}", i ${KF_FLAG_CREATE}, p 0, *p .r2)i.r1\'',
  "      ${If} $1 == 0",
  "        System::Call '*$2(&w${NSIS_MAX_STRLEN} .s)'",
  "        StrCpy $0 $1",
  "        System::Call 'OLE32::CoTaskMemFree(p r2)'",
  "      ${endif}",
].join("\n");

const safeKnownFolderBlock = [
  '      System::Call \'SHELL32::SHGetKnownFolderPath(g "${FOLDERID_UserProgramFiles}", i ${KF_FLAG_CREATE}, p 0, *p .r2)i.r1\'',
  "      ${If} $1 == 0",
  `        ${NSIS_USER_PROGRAMS_FALLBACK_MARKER}`,
  "        ; The NSIS System.dll pointer read crashes on this Windows installer path.",
  "        ; Keep $LocalAppData\\Programs and release the known-folder allocation.",
  "        System::Call 'OLE32::CoTaskMemFree(p r2)'",
  "      ${endif}",
].join("\n");

/** Patch only the verified electron-builder 26.8.1 per-user known-folder block. */
export function patchNsisMultiUserSource(source) {
  const sourceEol = source.includes("\r\n") ? "\r\n" : "\n";
  const normalized = source.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
  const matches = normalized.split(knownFolderBlock).length - 1;

  if (normalized.includes(NSIS_USER_PROGRAMS_FALLBACK_MARKER)) {
    if (matches !== 0 || !normalized.includes(safeKnownFolderBlock)) {
      throw new Error("electron-builder multiUser.nsh has an inconsistent known-folder fallback patch");
    }
    return source;
  }

  if (matches !== 1) {
    throw new Error(`electron-builder multiUser.nsh expected exactly one known-folder block, found ${matches}`);
  }

  const patched = normalized.replace(knownFolderBlock, safeKnownFolderBlock);
  return sourceEol === "\r\n" ? patched.replaceAll("\n", "\r\n") : patched;
}

export async function patchNsisMultiUserFile(filePath) {
  const source = await readFile(filePath, "utf8");
  const patched = patchNsisMultiUserSource(source);
  if (patched === source) {
    return { changed: false, originalSource: null };
  }

  await writeFile(filePath, patched, "utf8");
  return { changed: true, originalSource: source };
}

export function restoreNsisMultiUserFileSync({ filePath, originalSource }) {
  if (originalSource !== null) {
    writeFileSync(filePath, originalSource, "utf8");
  }
}
