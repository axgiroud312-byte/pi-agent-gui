import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, open, readFile, realpath, rename, rmdir, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { hasTrustRequiringProjectResources, ProjectTrustStore, SettingsManager } from "@earendil-works/pi-coding-agent";
import { piSessionDirectory } from "./pi-session-path.js";

export type PiSettingsScope = "user" | "project";

export interface PiSettingsDocument {
  scope: PiSettingsScope;
  path: string;
  exists: boolean;
  revision: string;
  text: string;
  parsed: Record<string, unknown> | null;
  error?: string;
}

export interface PiSettingsSnapshot {
  user: PiSettingsDocument;
  project: PiSettingsDocument;
  projectTrusted: boolean;
  effective: Record<string, unknown>;
  /** Top-level source; sourcePaths identifies nested leaves, e.g. /retry/enabled. */
  sources: Record<string, PiSettingsScope>;
  sourcePaths: Record<string, PiSettingsScope>;
  /** Project keys Pi 0.87.0 deliberately reads from global settings only. */
  ignoredProjectPaths: string[];
  appliesTo: "new-session";
  offline: boolean;
  versionCheckDisabled: boolean;
  sessionDirectory: string;
}

const missingRevision = createHash("sha256").update("pi-settings:missing").digest("hex");
// Pinned Pi 0.87.0 reads these through getGlobalSettings() / global-only getters.
const globalOnlyKeys = ["cacheWarming", "defaultProjectTrust", "httpProxy"] as const;

function profilePath(value: string, cwd: string): string {
  const expanded = value === "~" ? homedir() : value.startsWith("~/") || value.startsWith("~\\")
    ? join(homedir(), value.slice(2)) : value;
  return resolve(cwd, expanded);
}

function parseObject(text: string): Record<string, unknown> {
  let value: unknown;
  try { value = JSON.parse(text.replace(/^\uFEFF/u, "")); }
  catch { throw new Error("Pi settings contain invalid JSON"); }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Pi settings JSON must be an object");
  }
  return value as Record<string, unknown>;
}

async function readDocument(scope: PiSettingsScope, path: string): Promise<PiSettingsDocument> {
  let bytes: Buffer;
  try {
    const stats = await lstat(path);
    if (!stats.isFile()) throw new Error(`Pi ${scope} settings path is not a regular file`);
    if (stats.size > 1024 * 1024) throw new Error(`Pi ${scope} settings exceed the 1 MiB editor limit`);
    bytes = await readFile(path);
    if (bytes.length > 1024 * 1024) throw new Error(`Pi ${scope} settings exceed the 1 MiB editor limit`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { scope, path, exists: false, revision: missingRevision, text: "{}", parsed: {} };
    }
    throw error;
  }
  const revision = createHash("sha256").update(bytes).digest("hex");
  let text: string;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { return { scope, path, exists: true, revision, text: bytes.toString("utf8"), parsed: null,
    error: "Pi settings contain invalid UTF-8" }; }
  try { return { scope, path, exists: true, revision, text, parsed: parseObject(text) }; }
  catch (error) { return { scope, path, exists: true, revision, text, parsed: null,
    error: error instanceof Error ? error.message : String(error) }; }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mergeWithSources(user: Record<string, unknown>, project: Record<string, unknown>):
  Pick<PiSettingsSnapshot, "effective" | "sources" | "sourcePaths"> {
  const sources: Record<string, PiSettingsScope> = {};
  const sourcePaths: Record<string, PiSettingsScope> = {};
  const merge = (left: Record<string, unknown>, right: Record<string, unknown>, path: string): Record<string, unknown> => {
    const result: Record<string, unknown> = { ...left };
    for (const [key, value] of Object.entries(left)) {
      const pointer = `${path}/${key.replace(/~/gu, "~0").replace(/\//gu, "~1")}`;
      if (!Object.hasOwn(right, key)) {
        if (isObject(value)) merge(value, {}, pointer);
        else sourcePaths[pointer] = "user";
      }
    }
    for (const [key, value] of Object.entries(right)) {
      const pointer = `${path}/${key.replace(/~/gu, "~0").replace(/\//gu, "~1")}`;
      if (path === "") sources[key] = "project";
      if (isObject(value) && isObject(left[key])) result[key] = merge(left[key], value, pointer);
      else {
        result[key] = value;
        if (isObject(value)) merge({}, value, pointer);
        else sourcePaths[pointer] = "project";
      }
    }
    return result;
  };
  for (const key of Object.keys(user)) sources[key] = "user";
  return { effective: merge(user, project, ""), sources, sourcePaths };
}

function isOffline(env: NodeJS.ProcessEnv, rpcArgs: string[]): boolean {
  // Several Pi 0.87.0 network paths treat any non-empty PI_OFFLINE as disabled,
  // even when the main CLI parser considers "0" false.
  return rpcArgs.includes("--offline") || Boolean(env.PI_OFFLINE);
}

function isVersionCheckDisabled(env: NodeJS.ProcessEnv, rpcArgs: string[]): boolean {
  return isOffline(env, rpcArgs) || Boolean(env.PI_SKIP_VERSION_CHECK);
}

function trustOverride(rpcArgs: string[]): boolean | undefined {
  let trusted: boolean | undefined;
  for (const arg of rpcArgs) {
    if (arg === "--approve" || arg === "-a") trusted = true;
    if (arg === "--no-approve" || arg === "-na") trusted = false;
  }
  return trusted;
}

/** Read the two real Pi documents and resolve the same trust gate used by pinned Pi RPC. */
export async function readPiSettingsDocuments(
  workspacePath: string, env: NodeJS.ProcessEnv = process.env, rpcArgs: string[] = [],
): Promise<PiSettingsSnapshot> {
  const cwd = await realpath(workspacePath);
  const agentDir = profilePath(env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent"), cwd);
  const user = await readDocument("user", join(agentDir, "settings.json"));
  const project = await readDocument("project", join(cwd, ".pi", "settings.json"));
  const startup = SettingsManager.create(cwd, agentDir, { projectTrusted: false });
  const override = trustOverride(rpcArgs);
  const trustDecision = new ProjectTrustStore(agentDir).get(cwd);
  const projectTrusted = override ?? (!hasTrustRequiringProjectResources(cwd) || trustDecision === true ||
    (trustDecision === null && startup.getDefaultProjectTrust() === "always"));
  const manager = SettingsManager.create(cwd, agentDir, { projectTrusted });
  const global = manager.getGlobalSettings() as Record<string, unknown>;
  const projectEffective = manager.getProjectSettings() as Record<string, unknown>;
  const ignoredProjectPaths = globalOnlyKeys.filter(key => Object.hasOwn(projectEffective, key))
    .map(key => `/${key}`);
  for (const key of globalOnlyKeys) delete projectEffective[key];
  const merged = mergeWithSources(global, projectEffective);
  return { user, project, projectTrusted, ...merged, ignoredProjectPaths,
    appliesTo: "new-session", offline: isOffline(env, rpcArgs),
    versionCheckDisabled: isVersionCheckDisabled(env, rpcArgs),
    sessionDirectory: await piSessionDirectory(cwd, env, rpcArgs) };
}

/** A CAS save under Pi's own `<settings.json>.lock` convention. Reject stale or corrupt input. */
export async function savePiSettingsDocument(
  workspacePath: string, env: NodeJS.ProcessEnv, request: {
    scope: PiSettingsScope; expectedRevision: string; text: string; rpcArgs?: string[];
  },
  options: { beforeCommit?: () => Promise<void> } = {},
): Promise<PiSettingsSnapshot> {
  if (request.scope !== "user" && request.scope !== "project") throw new Error("Invalid Pi settings scope");
  parseObject(request.text);
  if (Buffer.byteLength(request.text, "utf8") > 1024 * 1024) throw new Error("Pi settings exceed the 1 MiB editor limit");
  const before = await readPiSettingsDocuments(workspacePath, env, request.rpcArgs);
  const path = before[request.scope].path;
  await mkdir(dirname(path), { recursive: true });
  let locked = false;
  let temporaryPath: string | undefined;
  try {
    try { await mkdir(`${path}.lock`); locked = true; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error("Pi settings are busy; retry after the other editor finishes");
      throw error;
    }
    const current = await readDocument(request.scope, path);
    if (current.revision !== request.expectedRevision) {
      throw new Error("Pi settings conflict: the file changed outside this editor; reload before saving");
    }
    if (current.error) throw new Error(`${current.error}; repair the file outside the editor before saving`);
    temporaryPath = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`);
    const temporary = await open(temporaryPath, "wx", 0o600);
    try {
      await temporary.writeFile(request.text, "utf8");
      await temporary.sync();
    } finally {
      await temporary.close();
    }
    await options.beforeCommit?.();
    if ((await readDocument(request.scope, path)).revision !== current.revision) {
      throw new Error("Pi settings conflict: the file changed outside this editor; reload before saving");
    }
    await rename(temporaryPath, path);
    temporaryPath = undefined;
  } finally {
    if (temporaryPath) await unlink(temporaryPath).catch(() => {});
    if (locked) await rmdir(`${path}.lock`);
  }
  return readPiSettingsDocuments(workspacePath, env, request.rpcArgs);
}
