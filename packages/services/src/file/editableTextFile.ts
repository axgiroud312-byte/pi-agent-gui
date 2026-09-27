import { createHash, randomUUID } from "node:crypto";
import { chmod, lstat, open, readFile, realpath, rename, rm, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, sep } from "node:path";

const MAX_EDIT_BYTES = 256 * 1024;
const pendingSaves = new Map<string, Promise<void>>();

function fail(code: string): never {
  throw new Error(code);
}

async function authorizedFile(rootPath: string, path: string): Promise<string> {
  if (!isAbsolute(rootPath) || !isAbsolute(path)) fail("INVALID_FILE_PATH");
  const [root, target] = await Promise.all([realpath(rootPath), realpath(path)]);
  const offset = relative(root, target);
  if (!offset || offset === ".." || offset.startsWith(`..${sep}`) || isAbsolute(offset)) {
    fail("OUTSIDE_WORKSPACE");
  }
  if ((await lstat(path)).isSymbolicLink()) fail("SYMLINK_EDIT_UNSUPPORTED");
  return target;
}

async function readVersioned(
  path: string,
): Promise<{ content: string; version: string; mode: number }> {
  const before = await stat(path);
  if (!before.isFile()) fail("NOT_A_FILE");
  if (before.size > MAX_EDIT_BYTES) fail("FILE_TOO_LARGE");
  const bytes = await readFile(path);
  if (bytes.byteLength > MAX_EDIT_BYTES) fail("FILE_TOO_LARGE");
  const after = await stat(path);
  if (
    before.dev !== after.dev ||
    before.ino !== after.ino ||
    before.mtimeMs !== after.mtimeMs ||
    before.size !== after.size
  ) {
    fail("FILE_CHANGED");
  }
  let content: string;
  try {
    content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    fail("NOT_TEXT");
  }
  if (content.includes("\0")) fail("NOT_TEXT");
  const digest = createHash("sha256").update(bytes).digest("hex");
  return {
    content,
    version: `${after.dev}:${after.ino}:${after.mtimeMs}:${digest}`,
    mode: after.mode,
  };
}

export async function readEditableText(params: { rootPath: string; path: string }) {
  const path = await authorizedFile(params.rootPath, params.path);
  const { content, version } = await readVersioned(path);
  return { path: params.path, content, version };
}

export async function saveEditableText(params: {
  rootPath: string;
  path: string;
  expectedVersion: string;
  content: string;
}): Promise<{ version: string }> {
  if (!params.expectedVersion || typeof params.content !== "string") fail("INVALID_EDIT");
  const bytes = Buffer.from(params.content, "utf8");
  if (bytes.byteLength > MAX_EDIT_BYTES || params.content.includes("\0")) fail("INVALID_EDIT");
  const path = await authorizedFile(params.rootPath, params.path);
  const predecessor = pendingSaves.get(path) ?? Promise.resolve();
  let release!: () => void;
  const next = new Promise<void>((resolve) => {
    release = resolve;
  });
  pendingSaves.set(path, next);
  await predecessor;
  const temporary = join(dirname(path), `.pi-edit-${randomUUID()}.tmp`);
  try {
    const original = await readVersioned(path);
    if (original.version !== params.expectedVersion) fail("FILE_CHANGED");
    const handle = await open(temporary, "wx", original.mode);
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await chmod(temporary, original.mode);
    if ((await readVersioned(path)).version !== params.expectedVersion) fail("FILE_CHANGED");
    await rename(temporary, path);
    const version = (await readVersioned(path)).version;
    // The native GUI smoke holds only the Host ACK after the real disk commit.
    // This gives the renderer a deterministic window to type into the same
    // editor while saving. The guard is absent from ordinary and packaged runs.
    const smokeDelay = Number(process.env.NATIVE_SMOKE_FILE_SAVE_ACK_DELAY_MS ?? 0);
    if (process.env.NATIVE_SMOKE_HARNESS && Number.isInteger(smokeDelay) &&
      smokeDelay > 0 && smokeDelay <= 5000) {
      await new Promise(resolve => setTimeout(resolve, smokeDelay));
    }
    return { version };
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined);
    release();
    if (pendingSaves.get(path) === next) pendingSaves.delete(path);
  }
}
