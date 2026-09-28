import { createHash } from "node:crypto";
import { lstat, open, readdir, realpath, stat } from "node:fs/promises";
import { basename, isAbsolute, relative, resolve, sep } from "node:path";
import type { PiPromptImage } from "./pi-prompt-images.js";

const MAX_TEXT_FILE_BYTES = 256 * 1024;
const MAX_IMAGE_FILE_BYTES = 20 * 1024 * 1024;
const MAX_TOTAL_TEXT_BYTES = 512 * 1024;
const MAX_MENTIONS = 10;
const MAX_DIRECTORY_ENTRIES = 500;
const PI_FILE_SNAPSHOT_MARKER = "\n\n---\nPi file snapshots captured at send time (image data is in this Pi message):\n";
const FILE_LINK = /\[((?:\\.|[^\\\]\n])*)\]\((?:<((?:\\.|[^>])*?)>|((?:\\.|[^)\n])*))\)/gu;

interface FileSnapshot {
  kind: "text" | "image" | "directory";
  path: string;
  sha256: string;
  content?: string;
  mimeType?: string;
  bytes?: number;
}

function unescapeMarkdown(value: string): string { return value.replace(/\\([\\\]<>])/gu, "$1"); }

export class PiFileReferenceError extends Error {
  constructor(readonly code: string, path: string) {
    super(`${code}: ${path}`);
    this.name = "PiFileReferenceError";
  }
}

function fail(code: string, path: string): never { throw new PiFileReferenceError(code, path); }

function fileMentions(text: string): string[] {
  const paths: string[] = [];
  const seen = new Set<string>();
  for (const match of text.matchAll(FILE_LINK)) {
    const label = unescapeMarkdown(match[1] ?? "");
    const destination = unescapeMarkdown(match[2] ?? match[3] ?? "");
    if (!destination || destination.includes("\0") || !/^\.{1,2}[\\/]/u.test(destination) &&
      !isAbsolute(destination)) continue;
    const path = destination.replaceAll("\\", "/").replace(/[\\/]+$/u, "");
    if (label !== basename(path) || seen.has(destination)) continue;
    seen.add(destination);
    paths.push(destination);
  }
  if (paths.length > MAX_MENTIONS) fail("TOO_MANY_FILE_REFERENCES", String(paths.length));
  return paths;
}

function within(root: string, target: string): boolean {
  const offset = relative(root, target);
  return !isAbsolute(offset) && offset !== ".." && !offset.startsWith(`..${sep}`);
}

async function authorizedPath(rootPath: string, mentionPath: string): Promise<string> {
  if (!isAbsolute(rootPath)) fail("INVALID_WORKSPACE", rootPath);
  const root = await realpath(rootPath);
  const path = resolve(root, mentionPath);
  if (!within(root, path)) fail("OUTSIDE_WORKSPACE", mentionPath);
  let source;
  try { source = await lstat(path); }
  catch { return fail("FILE_NOT_FOUND", mentionPath); }
  if (source.isSymbolicLink()) fail("SYMLINK_REFERENCE_UNSUPPORTED", mentionPath);
  const canonical = await realpath(path);
  if (!within(root, canonical)) fail("OUTSIDE_WORKSPACE", mentionPath);
  return canonical;
}

function imageMime(bytes: Buffer): string | undefined {
  if (bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))) return "image/png";
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.subarray(0, 6).toString("ascii") === "GIF87a" ||
    bytes.subarray(0, 6).toString("ascii") === "GIF89a") return "image/gif";
  if (bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
    bytes.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  return undefined;
}

async function captureFile(path: string, mentionPath: string): Promise<{ snapshot: FileSnapshot; image?: PiPromptImage }> {
  const handle = await open(path, "r");
  try {
    const before = await handle.stat();
    if (!before.isFile()) fail("UNSUPPORTED_FILE_REFERENCE", mentionPath);
    const imageExtension = /\.(?:png|jpe?g|gif|webp)$/iu.test(mentionPath);
    if (before.size > (imageExtension ? MAX_IMAGE_FILE_BYTES : MAX_TEXT_FILE_BYTES)) {
      fail("FILE_TOO_LARGE", mentionPath);
    }
    const bytes = await handle.readFile();
    const after = await handle.stat();
    if (before.dev !== after.dev || before.ino !== after.ino || before.mtimeMs !== after.mtimeMs ||
      before.size !== after.size) fail("FILE_CHANGED", mentionPath);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const mimeType = imageMime(bytes);
    if (mimeType) return { snapshot: { kind: "image", path: mentionPath, sha256,
      mimeType, bytes: bytes.length }, image: { type: "image", data: bytes.toString("base64"), mimeType } };
    if (imageExtension || bytes.includes(0)) {
      fail("UNSUPPORTED_FILE_REFERENCE", mentionPath);
    }
    let content: string;
    try { content = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
    catch { return fail("UNSUPPORTED_FILE_REFERENCE", mentionPath); }
    return { snapshot: { kind: "text", path: mentionPath, sha256, content } };
  } finally { await handle.close(); }
}

async function captureDirectory(path: string, mentionPath: string): Promise<FileSnapshot> {
  const before = await stat(path);
  const entries = await readdir(path, { withFileTypes: true });
  if (entries.length > MAX_DIRECTORY_ENTRIES) fail("DIRECTORY_TOO_LARGE", mentionPath);
  const content = entries.map(entry => `${entry.isDirectory() ? "directory" : entry.isFile() ? "file" : "link"}\t${entry.name}`)
    .sort().join("\n");
  const after = await stat(path);
  if (before.mtimeMs !== after.mtimeMs || before.ino !== after.ino) fail("FILE_CHANGED", mentionPath);
  if (Buffer.byteLength(content) > MAX_TEXT_FILE_BYTES) fail("DIRECTORY_TOO_LARGE", mentionPath);
  return { kind: "directory", path: mentionPath,
    sha256: createHash("sha256").update(content).digest("hex"), content };
}

/** Freeze explicitly selected local Markdown file mentions into Pi's user input. */
export async function snapshotPiFileMentions(workspacePath: string, text: string): Promise<{
  text: string; images: PiPromptImage[];
}> {
  const mentions = fileMentions(text);
  if (mentions.length === 0) return { text, images: [] };
  const snapshots: FileSnapshot[] = [];
  const images: PiPromptImage[] = [];
  for (const mention of mentions) {
    const canonical = await authorizedPath(workspacePath, mention);
    const source = await stat(canonical);
    if (source.isDirectory()) {
      snapshots.push(await captureDirectory(canonical, mention));
      continue;
    }
    const captured = await captureFile(canonical, mention);
    snapshots.push(captured.snapshot);
    if (captured.image) images.push(captured.image);
  }
  const serialized = JSON.stringify(snapshots);
  if (Buffer.byteLength(serialized) > MAX_TOTAL_TEXT_BYTES) fail("FILE_REFERENCES_TOO_LARGE", workspacePath);
  return { text: `${text}${PI_FILE_SNAPSHOT_MARKER}${serialized}`,
    images };
}

/** Only collapse a complete snapshot envelope; malformed Pi history stays visible. */
export function piFileSnapshotEpilogueStart(text: string): number | undefined {
  const index = text.lastIndexOf(PI_FILE_SNAPSHOT_MARKER);
  if (index < 0) return undefined;
  try {
    const snapshots: unknown = JSON.parse(text.slice(index + PI_FILE_SNAPSHOT_MARKER.length));
    if (!Array.isArray(snapshots) || snapshots.length === 0 || !snapshots.every(snapshot => {
      if (snapshot === null || typeof snapshot !== "object") return false;
      const item = snapshot as Record<string, unknown>;
      return ["text", "image", "directory"].includes(String(item.kind)) &&
        typeof item.path === "string" && typeof item.sha256 === "string" &&
        /^[a-f0-9]{64}$/u.test(item.sha256);
    })) return undefined;
    return index;
  } catch { return undefined; }
}

/** Use the user-written portion for native session titles; Pi JSONL remains complete. */
export function piFilePromptTitle(text: string): string {
  const end = piFileSnapshotEpilogueStart(text);
  return (end === undefined ? text : text.slice(0, end)).trim().slice(0, 100);
}
