import { clearV4ComposerDraft } from "@/v4/composer/composerDraftStore.js";
import { forgetComposerImageDraftScope } from "@/v4/composer/composerImageDraftStorage.js";

/** Reclaim local text and image bytes only after Host confirms a cold Pi JSONL deletion. */
export async function cleanupConfirmedPiSessionDraft(
  workspacePath: string, workspaceIdentity: string | undefined, sessionId: string,
): Promise<string[]> {
  if (!sessionId.trim() || sessionId === "__draft__") return ["invalid Pi session identity"];
  const errors: string[] = [];
  try {
    if (!clearV4ComposerDraft(workspacePath, workspaceIdentity, sessionId)) {
      errors.push("text draft cleanup failed");
    }
  } catch { errors.push("text draft cleanup failed"); }
  try {
    await forgetComposerImageDraftScope(`${workspaceIdentity?.trim() || workspacePath}\0${sessionId}`);
  } catch { errors.push("image draft cleanup failed"); }
  return errors;
}
