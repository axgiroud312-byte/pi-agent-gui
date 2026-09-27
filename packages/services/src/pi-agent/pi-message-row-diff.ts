import type { ConversationDelta, ConversationRow } from "@zcode/shared/zcode-protocol-v4";

export function serializePiValue(value: unknown): string {
  try { return JSON.stringify(value) ?? ""; } catch { return "[unserializable Pi value]"; }
}

/** Compare Pi-owned rows while preserving incremental native text updates. */
export function diffPiMessageRows(previous: ConversationRow[], next: ConversationRow[]): ConversationDelta[] {
  const deltas: ConversationDelta[] = [];
  for (let index = 0; index < next.length; index++) {
    const row = next[index]!;
    const old = previous[index];
    if (!old) { deltas.push({ op: "row.appended", row }); continue; }
    if (old.rowId !== row.rowId) {
      deltas.push({ op: "row.removed", fromRowId: old.rowId });
      for (const tail of next.slice(index)) deltas.push({ op: "row.appended", row: tail });
      return deltas;
    }
    if (serializePiValue(old) === serializePiValue(row)) continue;
    if (old.kind === "assistantText" && row.kind === "assistantText" &&
      old.state === "streaming" && row.state === "streaming" && row.text.startsWith(old.text)) {
      deltas.push({ op: "row.delta", rowId: row.rowId, path: "text", append: row.text.slice(old.text.length) });
    } else if (old.kind === "reasoning" && row.kind === "reasoning" &&
      old.state === "streaming" && row.state === "streaming" && row.text.startsWith(old.text)) {
      deltas.push({ op: "row.delta", rowId: row.rowId, path: "text", append: row.text.slice(old.text.length) });
    } else {
      deltas.push({ op: "row.upserted", row });
    }
  }
  if (next.length < previous.length) deltas.push({ op: "row.removed", fromRowId: previous[next.length]!.rowId });
  return deltas;
}
