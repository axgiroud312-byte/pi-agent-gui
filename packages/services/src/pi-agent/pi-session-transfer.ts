import { lstat, open, readFile, realpath, stat, unlink } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { basename, isAbsolute, join } from "node:path";
import { CURRENT_SESSION_VERSION } from "@earendil-works/pi-coding-agent";

export type PiSessionExportFormat = "jsonl" | "html";

export interface PiSessionTransferPreview {
  sessionId: string;
  sessionFile: string;
  revision: string;
  bytes: number;
  messageCount: number;
  lastAssistantText: string | null;
}

export interface PiSessionExportResult { path: string; format: PiSessionExportFormat; bytes: number }

/** Pi's loader skips malformed lines and repairs a missing final newline in place. Import is stricter. */
export function validatePiImportBytes(bytes: Buffer): { sourceId: string; entryCount: number } {
  if (!bytes.length || bytes.length > 64 * 1024 * 1024) throw new Error("Pi import must be 1–64 MiB");
  const text = bytes.toString("utf8");
  if (!Buffer.from(text).equals(bytes)) throw new Error("Pi import must be valid UTF-8");
  if (!text.endsWith("\n")) throw new Error("Pi import needs a final newline to preserve source bytes");
  const lines = text.split("\n");
  lines.pop(); // The required final newline leaves exactly one empty split item.
  if (lines.some(line => !line.trim())) throw new Error("Pi import contains a blank JSONL line");
  if (!lines.length) throw new Error("Pi import has no session header");
  const parsed: Array<Record<string, unknown>> = [];
  for (const line of lines) {
    let entry: unknown;
    try { entry = JSON.parse(line); }
    catch { throw new Error("Pi import contains malformed JSONL"); }
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error("Pi import contains a non-object entry");
    }
    parsed.push(entry as Record<string, unknown>);
  }
  const [header, ...entries] = parsed;
  if (header?.type !== "session" || typeof header.id !== "string" ||
    !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/iu.test(header.id) ||
    typeof header.cwd !== "string" || !isAbsolute(header.cwd) ||
    typeof header.timestamp !== "string" || !Number.isFinite(Date.parse(header.timestamp)) ||
    header.version !== CURRENT_SESSION_VERSION) {
    throw new Error("Pi import has an unsupported session header");
  }
  const ids = new Set<string>();
  for (const entry of entries) {
    if (typeof entry.type !== "string" || typeof entry.id !== "string" || !entry.id ||
      ids.has(entry.id) || !(entry.parentId === null || typeof entry.parentId === "string") ||
      typeof entry.timestamp !== "string") throw new Error("Pi import has an invalid entry");
    if (typeof entry.parentId === "string" && !ids.has(entry.parentId)) {
      throw new Error("Pi import has an unresolved or forward parent entry");
    }
    ids.add(entry.id);
  }
  return { sourceId: header.id, entryCount: entries.length };
}

export async function readPiImportSource(sourcePath: string): Promise<{ path: string; bytes: Buffer; hash: string }> {
  if (!isAbsolute(sourcePath) || !sourcePath.toLowerCase().endsWith(".jsonl")) {
    throw new Error("Select an absolute Pi JSONL file");
  }
  const first = await lstat(sourcePath);
  if (!first.isFile() || first.isSymbolicLink() || first.nlink !== 1 || first.size > 64 * 1024 * 1024) {
    throw new Error("Pi import source must be a regular JSONL file up to 64 MiB");
  }
  const path = await realpath(sourcePath);
  const bytes = await readFile(path);
  validatePiImportBytes(bytes);
  const second = await lstat(path);
  if (first.dev !== second.dev || first.ino !== second.ino || first.size !== second.size ||
    first.mtimeMs !== second.mtimeMs || first.ctimeMs !== second.ctimeMs) {
    throw new Error("Pi import source changed while being read");
  }
  return { path, bytes, hash: createHash("sha256").update(bytes).digest("hex") };
}

export async function assertPiImportSourceUnchanged(source: { path: string; hash: string }): Promise<void> {
  const current = await readPiImportSource(source.path);
  if (current.hash !== source.hash) throw new Error("Pi import source changed during import");
}

export async function piExportDestination(directory: string, sessionId: string,
  format: PiSessionExportFormat): Promise<string> {
  if (!isAbsolute(directory) || !/^[a-f0-9-]{36}$/iu.test(sessionId)) {
    throw new Error("Invalid Pi export directory or session ID");
  }
  const canonical = await realpath(directory);
  if (!(await stat(canonical)).isDirectory()) throw new Error("Pi export target is not a directory");
  return join(canonical, `pi-${sessionId}-${Date.now()}-${randomUUID().slice(0, 8)}.${format}`);
}

export async function copyPiExport(sourcePath: string, destinationPath: string,
  format: PiSessionExportFormat): Promise<PiSessionExportResult> {
  if (basename(destinationPath) === "" || !isAbsolute(destinationPath)) throw new Error("Invalid export path");
  // Create our own destination exclusively so a failed copy can remove only
  // the file it created. On POSIX 0600 protects the raw prompt/tool history;
  // Windows inherits the ACL of the directory selected by the user.
  const destination = await open(destinationPath, "wx", 0o600);
  let source: Awaited<ReturnType<typeof open>> | undefined;
  let createdIdentity: { dev: number; ino: number } | undefined;
  let failure: { error: unknown } | undefined;
  try {
    const created = await destination.stat();
    createdIdentity = { dev: created.dev, ino: created.ino };
    source = await open(sourcePath, "r");
    const chunk = Buffer.allocUnsafe(64 * 1024);
    let readPosition = 0;
    let writePosition = 0;
    for (;;) {
      const { bytesRead } = await source.read(chunk, 0, chunk.length, readPosition);
      if (!bytesRead) break;
      readPosition += bytesRead;
      let offset = 0;
      while (offset < bytesRead) {
        const { bytesWritten } = await destination.write(chunk, offset, bytesRead - offset, writePosition);
        if (!bytesWritten) throw new Error("Pi export write made no progress");
        offset += bytesWritten;
        writePosition += bytesWritten;
      }
    }
    await destination.sync();
  } catch (error) { failure = { error }; }
  const closes = await Promise.allSettled([source?.close() ?? Promise.resolve(), destination.close()]);
  for (const result of closes) {
    if (result.status === "rejected" && !failure) failure = { error: result.reason };
  }
  if (failure) {
    // The wx handle proves creation; the identity guard avoids removing a
    // different file if something replaced that path before our cleanup.
    const current = await lstat(destinationPath).catch(() => undefined);
    if (current && createdIdentity &&
      current.dev === createdIdentity.dev && current.ino === createdIdentity.ino) {
      await unlink(destinationPath).catch(() => {});
    }
    throw failure.error;
  }
  return { path: destinationPath, format, bytes: (await stat(destinationPath)).size };
}
