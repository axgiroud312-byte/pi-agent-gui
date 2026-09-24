import { randomUUID } from "node:crypto";
import { lstat, mkdir, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";

// Matches pinned Pi 0.87.0 config.getAgentDir / SessionManager's default
// per-workspace session directory, while respecting Pi's explicit overrides.
function piPath(value: string, cwd: string): string {
  const expanded = value === "~" ? homedir()
    : value.startsWith("~/") || value.startsWith("~\\") ? join(homedir(), value.slice(2)) : value;
  return resolve(cwd, expanded);
}

export async function piSessionDirectory(workspacePath: string, env: NodeJS.ProcessEnv, rpcArgs: string[]): Promise<string> {
  const cwd = await realpath(workspacePath);
  const overrideAt = rpcArgs.lastIndexOf("--session-dir");
  if (overrideAt >= 0) {
    const specified = rpcArgs[overrideAt + 1];
    if (!specified || specified.startsWith("--")) throw new Error("Pi --session-dir needs a directory");
    return piPath(specified, cwd);
  }
  const sessionDir = env.PI_CODING_AGENT_SESSION_DIR;
  if (sessionDir) return piPath(sessionDir, cwd);
  const agentDir = piPath(env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent"), cwd);
  const safePath = `--${cwd.replace(/^[/\\]/u, "").replace(/[/\\:]/gu, "-")}--`;
  return join(agentDir, "sessions", safePath);
}

/** Canonicalize a reserved *absent* leaf through its existing parent, never realpath the missing JSONL. */
export async function canonicalSessionLeaf(file: string): Promise<string> {
  if (!isAbsolute(file) || basename(file) === "." || basename(file) === "..") {
    throw new Error("Pi session file must have an absolute leaf path");
  }
  return join(await realpath(dirname(file)), basename(file));
}

export async function sessionFileExists(file: string): Promise<boolean> {
  try { await lstat(file); return true; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

export async function reserveNewSessionPath(workspacePath: string, env: NodeJS.ProcessEnv, rpcArgs: string[]): Promise<string> {
  const directory = await piSessionDirectory(workspacePath, env, rpcArgs);
  await mkdir(directory, { recursive: true });
  const parent = await realpath(directory);
  for (let attempt = 0; attempt < 5; attempt++) {
    const file = join(parent, `${new Date().toISOString().replace(/[:.]/gu, "-")}_${randomUUID()}.jsonl`);
    if (!await sessionFileExists(file)) return file;
  }
  throw new Error("Could not reserve a new Pi session history path");
}
