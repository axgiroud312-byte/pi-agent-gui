import type { QueueItem, QueueState } from "@zcode/shared/zcode-protocol-v4";

interface PendingGuideQueueProjection {
  pendingGuides: readonly QueueItem[];
  controlQueue: QueueState;
}

/**
 * The pending guide has a timeline status while it awaits the next model step.
 * Keep that status, and pass the same authoritative queue to the native control
 * panel so both Pi lanes can be edited, reordered or sent now by stable ID.
 */
export function projectPendingGuideQueue(queue: QueueState): PendingGuideQueueProjection {
  return { pendingGuides: queue.items.filter(item => item.delivery.admitted === "guide"),
    controlQueue: queue };
}
