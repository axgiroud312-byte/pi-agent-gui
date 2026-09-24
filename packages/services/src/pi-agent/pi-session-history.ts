import type { PiRpcClient } from "./pi-rpc-client.js";

/** Pi get_messages is current model context; get_entries retains history before compaction. */
export async function getPiHistoryMessages(client: PiRpcClient, getMessages: () => Promise<unknown[]>): Promise<unknown[]> {
  const response = await client.request({ type: "get_entries" });
  if (!response.success) throw new Error(response.error ?? "Pi get_entries failed");
  const data = response.data as { entries?: unknown; leafId?: unknown };
  if (!Array.isArray(data?.entries)) throw new Error("Pi get_entries omitted entries array");
  const entries = data.entries as Record<string, unknown>[];
  const byId = new Map(entries.filter(entry => typeof entry.id === "string")
    .map(entry => [entry.id as string, entry]));
  const branch: Record<string, unknown>[] = [];
  const visited = new Set<string>();
  let leaf = data.leafId;
  while (typeof leaf === "string" && byId.has(leaf) && !visited.has(leaf)) {
    visited.add(leaf);
    const entry = byId.get(leaf)!;
    branch.push(entry);
    leaf = entry.parentId;
  }
  if (leaf !== null && leaf !== undefined) throw new Error("Pi history has an incomplete active parent chain");
  branch.reverse();
  if (!branch.some(entry => entry.type === "compaction")) return getMessages();
  return branch.filter(entry => entry.type === "message").map(entry => entry.message);
}
