/** A bounded, read-only preview of facts returned by fixed Pi 0.87.0 RPC. */
export type PiContextSection = "history" | "effective" | "edits" | "summaries";

export type PiContextBlock =
  | { kind: "text"; text: string; totalChars: number; truncated: boolean }
  | { kind: "image"; mimeType: string; bytes?: number }
  | { kind: "tool"; name: string }
  | { kind: "other"; type: string };

export interface PiContextItem {
  id: string;
  kind: string;
  role?: string;
  timestamp?: string;
  targetId?: string;
  change?: "omit" | "replace";
  excludedFromModel?: boolean;
  tokensBefore?: number;
  blocks: PiContextBlock[];
  omittedBlocks: number;
}

export interface PiContextPage {
  section: PiContextSection;
  offset: number;
  limit: number;
  total: number;
  hasMore: boolean;
  items: PiContextItem[];
}

type Raw = Record<string, unknown>;
const MAX_PAGE_SIZE = 40;
const MAX_TEXT_CHARS = 16_384;
const MAX_BLOCKS = 24;
const MAX_LABEL_CHARS = 256;

function object(value: unknown): Raw | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Raw : undefined;
}

function label(value: unknown, fallback = "unknown"): string {
  return typeof value === "string" ? value.slice(0, MAX_LABEL_CHARS) : fallback;
}

function textBlock(value: string, remaining: number): Extract<PiContextBlock, { kind: "text" }> {
  return { kind: "text", text: value.slice(0, remaining), totalChars: value.length,
    truncated: value.length > remaining };
}

function imageBytes(data: unknown): number | undefined {
  if (typeof data !== "string" || data.length === 0 || data.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]+={0,2}$/u.test(data)) return undefined;
  return data.length / 4 * 3 - (data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0);
}

export function assertPiContextPagination(section: PiContextSection, offset: number, limit: number,
  maxTextChars = MAX_TEXT_CHARS): void {
  if (!["history", "effective", "edits", "summaries"].includes(section) ||
    !Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) ||
    limit < 1 || limit > MAX_PAGE_SIZE || !Number.isSafeInteger(maxTextChars) ||
    maxTextChars < 1 || maxTextChars > MAX_TEXT_CHARS) throw new Error("Invalid Pi context pagination");
}

function blocksFor(content: unknown, maxTextChars: number): { blocks: PiContextBlock[]; omittedBlocks: number } {
  const parts = typeof content === "string" ? [{ type: "text", text: content }] :
    Array.isArray(content) ? content : [];
  const blocks: PiContextBlock[] = [];
  let remaining = maxTextChars;
  for (const part of parts.slice(0, MAX_BLOCKS)) {
    const value = object(part);
    if (!value) { blocks.push({ kind: "other", type: "unknown" }); continue; }
    if (value.type === "text" && typeof value.text === "string") {
      const block = textBlock(value.text, remaining);
      blocks.push(block);
      remaining -= block.text.length;
    } else if (value.type === "image") {
      const bytes = imageBytes(value.data);
      blocks.push({ kind: "image", mimeType: label(value.mimeType),
        ...(bytes !== undefined ? { bytes } : {}) });
    } else if (value.type === "toolCall") {
      blocks.push({ kind: "tool", name: label(value.name) });
    } else {
      blocks.push({ kind: "other", type: label(value.type) });
    }
  }
  return { blocks, omittedBlocks: Math.max(0, parts.length - MAX_BLOCKS) };
}

function entryItem(raw: unknown, index: number, maxTextChars: number): PiContextItem {
  const entry = object(raw) ?? {};
  const kind = label(entry.type);
  const id = label(entry.id, `invalid-entry-${index}`);
  const base: PiContextItem = { id, kind, blocks: [], omittedBlocks: 0,
    ...(typeof entry.timestamp === "string" ? { timestamp: label(entry.timestamp) } : {}) };
  if (kind === "message") {
    const message = object(entry.message);
    if (typeof message?.role === "string") base.role = label(message.role);
    Object.assign(base, blocksFor(message?.role === "bashExecution" ? message.output : message?.content, maxTextChars));
    if (message?.role === "compactionSummary" || message?.role === "branchSummary") {
      Object.assign(base, blocksFor(message.summary, maxTextChars));
    }
  } else if (kind === "custom_message") {
    Object.assign(base, blocksFor(entry.content, maxTextChars));
  } else if (kind === "context_edit") {
    if (typeof entry.targetId === "string") base.targetId = label(entry.targetId);
    base.change = entry.replacement === null ? "omit" : "replace";
    if (base.change === "replace") Object.assign(base, blocksFor(object(entry.replacement)?.content, maxTextChars));
  } else if (kind === "compaction" || kind === "branch_summary") {
    Object.assign(base, blocksFor(entry.summary, maxTextChars));
    if (typeof entry.tokensBefore === "number" && Number.isFinite(entry.tokensBefore)) {
      base.tokensBefore = entry.tokensBefore;
    }
  }
  return base;
}

function messageItem(raw: unknown, index: number, maxTextChars: number): PiContextItem {
  const message = object(raw) ?? {};
  const role = label(message.role);
  const item: PiContextItem = { id: `effective-${index}`, kind: "message", role,
    blocks: [], omittedBlocks: 0,
    ...(role === "bashExecution" && message.excludeFromContext === true ? { excludedFromModel: true } : {}) };
  const content = role === "compactionSummary" || role === "branchSummary" ? message.summary :
    role === "bashExecution" ? message.output : message.content;
  Object.assign(item, blocksFor(content, maxTextChars));
  return item;
}

/** Pi RPC owns both arrays. This function only redacts media and bounds one selected UI page. */
export function projectPiContextPage(params: {
  section: PiContextSection;
  entries: readonly unknown[];
  currentMessages: readonly unknown[];
  offset: number;
  limit: number;
  maxTextChars?: number;
}): PiContextPage {
  const { section, entries, currentMessages, offset, limit } = params;
  const maxTextChars = params.maxTextChars ?? MAX_TEXT_CHARS;
  assertPiContextPagination(section, offset, limit, maxTextChars);
  const source = section === "effective" ? currentMessages : section === "history" ? entries :
    section === "edits" ? entries.filter(entry => object(entry)?.type === "context_edit") :
      entries.filter(entry => ["compaction", "branch_summary"].includes(String(object(entry)?.type)));
  const items = source.slice(offset, offset + limit).map((value, index) => section === "effective"
    ? messageItem(value, offset + index, maxTextChars) : entryItem(value, offset + index, maxTextChars));
  return { section, offset, limit, total: source.length, hasMore: offset + items.length < source.length, items };
}
