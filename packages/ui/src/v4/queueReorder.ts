import type { QueueItem } from "@zcode/shared/zcode-protocol-v4";

export interface QueueReorderAnchor {
  beforeQueueItemId: string | null;
  queueItemId: string;
}

/** Pi owns two queues. A drag may change order inside a lane, never delivery semantics. */
export function resolveQueueReorderAnchor(
  items: readonly QueueItem[],
  activeQueueItemId: string,
  overQueueItemId: string,
): QueueReorderAnchor | null {
  if (activeQueueItemId === overQueueItemId) return null;
  const active = items.find(item => item.queueItemId === activeQueueItemId);
  const over = items.find(item => item.queueItemId === overQueueItemId);
  if (!active || !over || active.delivery.admitted !== over.delivery.admitted) return null;

  const lane = items.filter(item => item.delivery.admitted === active.delivery.admitted);
  const fromIndex = lane.findIndex(item => item.queueItemId === activeQueueItemId);
  const overIndex = lane.findIndex(item => item.queueItemId === overQueueItemId);
  if (fromIndex < overIndex) {
    const afterRemoval = lane.filter(item => item.queueItemId !== activeQueueItemId);
    const afterOver = afterRemoval.findIndex(item => item.queueItemId === overQueueItemId) + 1;
    return { queueItemId: activeQueueItemId,
      beforeQueueItemId: afterRemoval[afterOver]?.queueItemId ?? null };
  }
  return { queueItemId: activeQueueItemId, beforeQueueItemId: overQueueItemId };
}
