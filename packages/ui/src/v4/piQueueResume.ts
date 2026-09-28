import type { CommandAck, ConversationSnapshot } from "@zcode/shared/zcode-protocol-v4";

export interface PiQueueResumeScope {
  sessionId: string | null;
  generation: number;
  snapshot: Pick<ConversationSnapshot, "sessionId" | "revision" | "queue"> | null;
}

export type PiQueueResumeResult = "accepted" | "changed" | "failed";

/** A stopped Pi queue is resumed only by the authoritative setAutoDrain command. */
export async function resumeUnchangedPiQueue(options: {
  targetSessionId: string;
  getCurrent: () => PiQueueResumeScope;
  dispatch: (baseRevision: number) => Promise<CommandAck>;
  waitForUpdate?: () => Promise<void>;
}): Promise<PiQueueResumeResult> {
  const origin = options.getCurrent();
  if (origin.sessionId !== options.targetSessionId || !origin.snapshot ||
    origin.snapshot.sessionId !== options.targetSessionId ||
    origin.snapshot.queue.autoDrain || origin.snapshot.queue.items.length === 0) return "changed";
  const queueAtClick = JSON.stringify(origin.snapshot.queue);
  const stillSameQueue = (next: PiQueueResumeScope): boolean =>
    next.sessionId === origin.sessionId && next.generation === origin.generation &&
    next.snapshot?.sessionId === origin.sessionId && !next.snapshot.queue.autoDrain &&
    JSON.stringify(next.snapshot.queue) === queueAtClick;
  let baseRevision = origin.snapshot.revision;
  const waitForUpdate = options.waitForUpdate ?? (() => new Promise<void>(resolve => setTimeout(resolve, 25)));
  for (let attempt = 0; attempt < 3; attempt++) {
    if (!stillSameQueue(options.getCurrent())) return "changed";
    const ack = await options.dispatch(baseRevision);
    if (ack.status === "accepted") return "accepted";
    if (ack.status !== "stale" || ack.reasonCode !== "pi.queueSnapshotChanged" ||
      !Number.isSafeInteger(ack.revisionAtDecision) || ack.revisionAtDecision <= baseRevision) return "failed";
    if (attempt === 2) return "failed";
    let caughtUp = false;
    for (let poll = 0; poll < 20; poll++) {
      const next = options.getCurrent();
      if (!stillSameQueue(next)) return "changed";
      if (next.snapshot!.revision >= ack.revisionAtDecision) {
        baseRevision = next.snapshot!.revision;
        caughtUp = true;
        break;
      }
      await waitForUpdate();
    }
    if (!caughtUp) return "changed";
  }
  return "failed";
}
