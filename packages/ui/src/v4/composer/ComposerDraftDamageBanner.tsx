import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { readDamagedV4ComposerDraftRecord } from "./composerDraftStore.js";

export function ComposerDraftDamageBanner({ workspacePath, workspaceIdentity }: {
  workspacePath: string;
  workspaceIdentity?: string;
}) {
  const { intl } = useZCodeIntl();
  const damagedRaw = readDamagedV4ComposerDraftRecord(workspacePath, workspaceIdentity);
  if (damagedRaw === null) return null;

  const downloadRaw = () => {
    // This export stays local and contains every unsent text draft for this
    // workspace. Never put the raw value in diagnostics, logs or a share URL.
    const url = URL.createObjectURL(new Blob([damagedRaw], { type: "text/plain;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `pi-composer-draft-recovery-${Date.now()}.txt`;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return <div role="alert" data-testid="v4-composer-draft-damaged"
    className="mb-3 rounded-xl border border-border bg-surface px-3 py-2 text-ui-base">
    <p>{intl.formatMessage({ id: "chat.composer.draftDamaged" })}</p>
    <button type="button" data-testid="v4-composer-draft-export" onClick={downloadRaw}
      className="mt-2 cursor-pointer underline underline-offset-2">
      {intl.formatMessage({ id: "chat.composer.exportDamagedDraft" })}
    </button>
  </div>;
}
