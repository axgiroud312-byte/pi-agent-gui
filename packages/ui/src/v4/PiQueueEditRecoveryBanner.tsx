import { memo, useState } from "react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import type { PiQueueEditRecovery } from "@/v4/piQueueEditRecovery.js";

interface Props {
  entries: readonly PiQueueEditRecovery[];
  queuedItemIds: ReadonlySet<string>;
  busyQueueItemId: string | null;
  onRestore: (entry: PiQueueEditRecovery) => void;
  onDiscard: (entry: PiQueueEditRecovery) => void;
}

/** These are user-controlled crash recovery copies, never a second dispatch queue. */
export const PiQueueEditRecoveryBanner = memo(function PiQueueEditRecoveryBanner({
  entries, queuedItemIds, busyQueueItemId, onRestore, onDiscard,
}: Props) {
  const { intl } = useZCodeIntl();
  const [discardTarget, setDiscardTarget] = useState<PiQueueEditRecovery | null>(null);
  if (entries.length === 0) return null;
  return <div data-testid="pi-queue-edit-recovery" role="status"
    className="mb-3 flex w-full shrink-0 flex-col gap-2 rounded-xl border border-border bg-surface px-3 py-2 text-ui-base text-foreground">
    {entries.map(entry => {
      const stillQueued = queuedItemIds.has(entry.queueItemId);
      return <div key={entry.queueItemId} data-queue-recovery-id={entry.queueItemId}
        className="flex flex-wrap items-center gap-2">
        <p className="min-w-0 flex-1 break-words">
          {entry.state === "preparing" ? intl.formatMessage({ id: "chat.queue.recoveryIncomplete" })
            : stillQueued ? intl.formatMessage({ id: "chat.queue.recoveryStillQueued" })
            : entry.state === "restored" ? intl.formatMessage({ id: "chat.queue.recoveryAlreadyRestored" })
            : entry.state === "withdrawn" ? intl.formatMessage({ id: "chat.queue.recoveryWithdrawn" })
            : intl.formatMessage({ id: "chat.queue.recoveryAvailable" })}
          {` ${entry.text.slice(0, 100)}`}
          {entry.attachments.length ? ` · ${entry.attachments.length} ${intl.formatMessage({ id: "chat.queue.recoveryImages" })}` : ""}
        </p>
        {!stillQueued && entry.state !== "preparing" && <button type="button" data-testid="pi-queue-recovery-restore"
          className="shrink-0 rounded-md bg-primary px-2.5 py-1 text-primary-foreground hover:bg-primary/80 disabled:opacity-50"
          disabled={busyQueueItemId !== null} onClick={() => onRestore(entry)}>
          {intl.formatMessage({ id: "chat.queue.recoveryRestore" })}
        </button>}
        <button type="button" className="shrink-0 rounded-md px-2 py-1 text-foreground-subtle hover:bg-hover"
          disabled={busyQueueItemId !== null} onClick={() => setDiscardTarget(entry)}>
          {intl.formatMessage({ id: "chat.queue.recoveryDiscard" })}
        </button>
      </div>;
    })}
    <AlertDialog open={discardTarget !== null} onOpenChange={open => { if (!open) setDiscardTarget(null); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{intl.formatMessage({ id: "chat.queue.recoveryDiscard" })}</AlertDialogTitle>
          <AlertDialogDescription>
            {intl.formatMessage({ id: "chat.queue.recoveryDiscardConfirm" })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{intl.formatMessage({ id: "common.cancel" })}</AlertDialogCancel>
          <AlertDialogAction onClick={() => {
            if (discardTarget) onDiscard(discardTarget);
            setDiscardTarget(null);
          }}>{intl.formatMessage({ id: "chat.queue.recoveryDiscard" })}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>;
});
