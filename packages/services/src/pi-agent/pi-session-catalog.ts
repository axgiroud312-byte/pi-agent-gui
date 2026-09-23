import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface PiSessionBookmark {
  sessionId: string;
  sessionFile: string;
  workspacePath: string;
  workspaceKey: string;
  workspaceId: string;
  createdAt: number;
  lastActivityAt: number;
}

function bookmark(value: unknown): value is PiSessionBookmark {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return ["sessionId", "sessionFile", "workspacePath", "workspaceKey", "workspaceId"]
    .every(key => typeof row[key] === "string" && row[key].length > 0) &&
    Number.isFinite(row.createdAt) && Number.isFinite(row.lastActivityAt);
}

/** App-owned index contains only Pi session pointers; JSONL stays with the target Pi profile. */
export class PiSessionCatalog {
  constructor(private readonly directory: string) {}

  private file(sessionId: string): string {
    if (!/^[a-f0-9-]{36}$/iu.test(sessionId)) throw new Error("Invalid Pi session ID");
    return join(this.directory, `${sessionId}.json`);
  }

  async save(value: PiSessionBookmark): Promise<boolean> {
    if (!bookmark(value)) throw new Error("Invalid Pi session bookmark");
    try { if (!(await stat(value.sessionFile)).isFile()) return false; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    }
    await mkdir(this.directory, { recursive: true });
    const path = this.file(value.sessionId);
    const temp = `${path}.${randomUUID()}.tmp`;
    try {
      await writeFile(temp, JSON.stringify(value), { flag: "wx" });
      await rename(temp, path);
      return true;
    } finally { await unlink(temp).catch(() => {}); }
  }

  async list(workspaceKey: string): Promise<PiSessionBookmark[]> {
    let files: string[];
    try { files = await readdir(this.directory); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    const entries: PiSessionBookmark[] = [];
    for (const name of files) {
      if (!/^[a-f0-9-]{36}\.json$/iu.test(name)) continue;
      try {
        const value: unknown = JSON.parse(await readFile(join(this.directory, name), "utf8"));
        if (!bookmark(value) || `${value.sessionId}.json`.toLowerCase() !== name.toLowerCase()
          || value.workspaceKey !== workspaceKey) continue;
        if ((await stat(value.sessionFile)).isFile()) entries.push(value);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          // Corrupted bookmarks never become authoritative Pi history.
          console.warn("[pi-agent] invalid session bookmark", name);
        }
      }
    }
    return entries.sort((a, b) => a.createdAt - b.createdAt);
  }
}
