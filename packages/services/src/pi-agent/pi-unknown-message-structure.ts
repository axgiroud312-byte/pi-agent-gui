/**
 * A future Pi JSONL shape stays intact in Pi's session file. The renderer gets
 * only a small structural preview: unknown payloads can include images, tool
 * secrets, or extension-private data that must not become a raw UI fallback.
 */
const MAX_DEPTH = 4;
const MAX_FIELDS = 16;
const MAX_ITEMS = 12;
const MAX_NODES = 96;
const MAX_PREVIEW_CHARS = 900;
const STRUCTURAL_KEYS = new Set(["role", "content", "type", "kind", "name", "label", "nested",
  "image", "mimeType", "payload", "details", "status", "items", "parts"]);
const PRIVATE_KEY = /(?:data|base64|secret|token|password|credential|api.?key|auth|private)/iu;

export function piUnknownMessageStructure(value: unknown): unknown {
  const seen = new WeakSet<object>();
  let nodes = 0;
  const visit = (current: unknown, depth: number, field?: string): unknown => {
    if (++nodes > MAX_NODES) return "[structure omitted]";
    if (current === null) return null;
    if (field && PRIVATE_KEY.test(field)) return "[private value omitted]";
    if (typeof current === "string") return `[string: ${current.length} chars]`;
    if (typeof current === "number") return "[number]";
    if (typeof current === "boolean") return "[boolean]";
    if (typeof current !== "object") return `[${typeof current}]`;
    if (seen.has(current)) return "[repeated object]";
    if (depth >= MAX_DEPTH) return "[nested structure omitted]";
    seen.add(current);
    if (Array.isArray(current)) {
      const preview = current.slice(0, MAX_ITEMS).map(item => visit(item, depth + 1));
      if (current.length > MAX_ITEMS) preview.push(`[${current.length - MAX_ITEMS} more items]`);
      return preview;
    }
    const entries = Object.entries(current);
    const preview = entries.slice(0, MAX_FIELDS).map(([key, item], index) => [
      STRUCTURAL_KEYS.has(key) && !PRIVATE_KEY.test(key) ? key : `[field ${index + 1}]`,
      visit(item, depth + 1, key),
    ] as const);
    if (entries.length > MAX_FIELDS) preview.push(["[more fields]", entries.length - MAX_FIELDS] as const);
    return Object.fromEntries(preview);
  };
  const preview = visit(value, 0);
  if ((JSON.stringify(preview)?.length ?? 0) <= MAX_PREVIEW_CHARS) return preview;
  // Keep just the root's safe field names when even the bounded traversal is
  // too large for one timeline row. Pi JSONL retains the complete source.
  return { fields: preview && typeof preview === "object" && !Array.isArray(preview)
    ? Object.keys(preview).slice(0, MAX_FIELDS) : [],
  note: "[nested structure omitted from the timeline]" };
}
