import type { ConversationRow, SessionControl } from "@zcode/shared/zcode-protocol-v4";

/** Only move the current turn's matching model error out of the composer. */
export function hasInlinePiModelError(
  error: SessionControl["lastError"], rows: readonly ConversationRow[],
): boolean {
  if (error?.code !== "pi.runtimeError") return false;
  const latestTurn = rows.findLast(row => row.kind === "turnHeader");
  return rows.some(row => row.kind === "assistantText" && row.turnId === latestTurn?.turnId &&
    row.error?.code === "pi.modelError" && row.error.message === error.message);
}
