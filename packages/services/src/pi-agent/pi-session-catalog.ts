import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AttachmentRef, SessionSummary } from "@zcode/shared/zcode-protocol-v4";

export interface PiQueueRecoveryEntry {
  id: string;
  text: string;
  lane: "steering" | "followUp";
  attachments: AttachmentRef[];
}

export interface PiSessionBookmark {
  sessionId: string;
  sessionFile: string;
  workspacePath: string;
  workspaceKey: string;
  workspaceId: string;
  createdAt: number;
  lastActivityAt: number;
  // Small app-owned display metadata, never a second copy of Pi JSONL.
  title?: SessionSummary["title"];
  titleSource?: SessionSummary["titleSource"];
  phase?: SessionSummary["phase"];
  sessionEnded?: SessionSummary["sessionEnded"];
  commandAnchors?: { textHash: string; commandId: string }[];
  rowIds?: Record<string, number>;
  uncertainDelivery?: boolean;
  pendingIntent?: { textHash: string; commandId: string; priorUserCount: number; generation?: number;
    slashCommand?: true };
  returnedQueue?: { steering: string[]; followUp: string[] };
  /** Recovery evidence only. Never an executable Host queue. */
  queueRecovery?: PiQueueRecoveryEntry[];
  interruptedQueueRecovery?: PiQueueRecoveryEntry[];
}

function recoveryEntries(value: unknown): boolean {
  return Array.isArray(value) && value.every(entry => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return false;
    const row = entry as Record<string, unknown>;
    return typeof row.id === "string" && row.id.length > 0 && typeof row.text === "string" &&
      ["steering", "followUp"].includes(String(row.lane)) && Array.isArray(row.attachments) &&
      row.attachments.every(ref => typeof ref === "object" && ref !== null &&
        typeof ref.ref === "string" && typeof ref.fileName === "string" &&
        typeof ref.mime === "string" && Number.isSafeInteger(ref.bytes));
  });
}

function bookmark(value: unknown): value is PiSessionBookmark {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return ["sessionId", "sessionFile", "workspacePath", "workspaceKey", "workspaceId"]
    .every(key => typeof row[key] === "string" && row[key].length > 0) &&
    Number.isFinite(row.createdAt) && Number.isFinite(row.lastActivityAt) &&
    (row.title === undefined || (typeof row.title === "string" && row.title.length > 0)) &&
    (row.titleSource === undefined || ["default", "generated", "custom"].includes(String(row.titleSource))) &&
    (row.phase === undefined || ["draft", "prewarming", "running", "completedSuccess", "completedInterrupted", "error"].includes(String(row.phase))) &&
    (row.sessionEnded === undefined || typeof row.sessionEnded === "boolean") &&
    (row.uncertainDelivery === undefined || typeof row.uncertainDelivery === "boolean") &&
    (row.pendingIntent === undefined || (typeof row.pendingIntent === "object" && row.pendingIntent !== null &&
      typeof (row.pendingIntent as Record<string, unknown>).textHash === "string" &&
      typeof (row.pendingIntent as Record<string, unknown>).commandId === "string" &&
      Number.isSafeInteger((row.pendingIntent as Record<string, unknown>).priorUserCount) &&
      Number((row.pendingIntent as Record<string, unknown>).priorUserCount) >= 0 &&
      ((row.pendingIntent as Record<string, unknown>).slashCommand === undefined ||
        (row.pendingIntent as Record<string, unknown>).slashCommand === true) &&
      ((row.pendingIntent as Record<string, unknown>).generation === undefined ||
        (Number.isSafeInteger((row.pendingIntent as Record<string, unknown>).generation) &&
          Number((row.pendingIntent as Record<string, unknown>).generation) >= 0)))) &&
    (row.returnedQueue === undefined || (typeof row.returnedQueue === "object" && row.returnedQueue !== null &&
      ["steering", "followUp"].every(key => Array.isArray((row.returnedQueue as Record<string, unknown>)[key]) &&
        ((row.returnedQueue as Record<string, unknown>)[key] as unknown[]).every(item => typeof item === "string")))) &&
    (row.queueRecovery === undefined || recoveryEntries(row.queueRecovery)) &&
    (row.interruptedQueueRecovery === undefined || recoveryEntries(row.interruptedQueueRecovery)) &&
    (row.rowIds === undefined || (typeof row.rowIds === "object" && row.rowIds !== null &&
      Object.values(row.rowIds).every(id => Number.isSafeInteger(id) && (id as number) > 0))) &&
    (row.commandAnchors === undefined || (Array.isArray(row.commandAnchors) && row.commandAnchors.every(anchor =>
      typeof anchor === "object" && anchor !== null && typeof anchor.textHash === "string" && typeof anchor.commandId === "string")));
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
      // Reserve the pointer before Pi may execute an extension or a prompt.
      // A pending intent with no JSONL is still an unknown delivery, not a
      // reason to erase the session identity or invite a replay.
      if ((error as NodeJS.ErrnoException).code === "ENOENT" && value.pendingIntent) { /* save below */ }
      else if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      else throw error;
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
        try { if ((await stat(value.sessionFile)).isFile()) entries.push(value); }
        catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT" && value.pendingIntent) entries.push(value);
          else throw error;
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          // Corrupted bookmarks never become authoritative Pi history.
          console.warn("[pi-agent] invalid session bookmark", name);
        }
      }
    }
    return entries.sort((a, b) => a.createdAt - b.createdAt);
  }

  /** Remove only the app pointer after the authoritative Pi JSONL is gone. */
  async remove(sessionId: string, workspaceKey: string, sessionFile: string): Promise<void> {
    const path = this.file(sessionId);
    let contents: string;
    try { contents = await readFile(path, "utf8"); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      return;
    }
    let value: unknown;
    try { value = JSON.parse(contents); }
    catch { return; }
    if (!bookmark(value) || value.workspaceKey !== workspaceKey || value.sessionFile !== sessionFile) return;
    try { await unlink(path); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
}
