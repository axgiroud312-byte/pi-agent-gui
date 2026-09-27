import { readV4ComposerDraft, seedPiForkComposerDraft } from "@/v4/composer/composerDraftStore.js";
import { listComposerImageDraftIds, reserveComposerImageDrafts,
  saveComposerImageDraft } from "@/v4/composer/composerImageDraftStorage.js";

export interface PiForkSourceImage {
  ref: string;
  fileName: string;
  mimeType: "image/png" | "image/jpeg" | "image/gif" | "image/webp";
  bytes: number;
  sha256: string;
}

interface PiForkImageRead {
  sessionId: string;
  ref: string;
  mediaType: string;
}

/** Pi owns the branch; this only restores its selected input into native, unsent draft storage. */
export async function restorePiForkComposerDraft(input: {
  workspacePath: string;
  workspaceIdentity?: string;
  sourceSessionId: string;
  childSessionId: string;
  restoredText: string;
  images: readonly PiForkSourceImage[];
  readImage: (params: PiForkImageRead) => Promise<
    { bytes: Uint8Array; mediaType: string } | { url: string; mediaType: string }>;
}): Promise<void> {
  const { workspacePath, workspaceIdentity, sourceSessionId, childSessionId,
    restoredText, images, readImage } = input;
  if (!sourceSessionId || !childSessionId || sourceSessionId === childSessionId ||
    (!restoredText.trim() && images.length === 0)) {
    throw new Error("Pi fork did not provide a distinct child and restorable input");
  }
  const scopeKey = `${workspaceIdentity?.trim() || workspacePath}\0${childSessionId}`;
  const existing = readV4ComposerDraft(workspacePath, workspaceIdentity, childSessionId);
  if (existing?.text.trim() && existing.text !== restoredText) {
    throw new Error("Pi fork child already has different unsent text");
  }
  const ids = images.map(() => crypto.randomUUID());
  if (images.length > 0) {
    if (listComposerImageDraftIds(scopeKey).length > 0) {
      throw new Error("Pi fork child already has saved images");
    }
    // Manifest first: if the desktop exits during image copying, reopening the
    // child displays failed chips and refuses to send only the restored text.
    reserveComposerImageDrafts(scopeKey, ids);
  }
  if (restoredText.trim()) {
    const seeded = seedPiForkComposerDraft(workspacePath, workspaceIdentity, childSessionId, restoredText);
    if (seeded !== "stored") throw new Error(seeded === "conflict"
      ? "Pi fork child already has different unsent text" : "Pi fork text draft could not be saved");
  }
  for (const [index, image] of images.entries()) {
    const read = await readImage({ sessionId: sourceSessionId, ref: image.ref, mediaType: image.mimeType });
    if (!("bytes" in read) || read.mediaType !== image.mimeType || read.bytes.length !== image.bytes) {
      throw new Error(`Pi fork image ${index + 1} changed or could not be read from the source session`);
    }
    const bytes = Uint8Array.from(read.bytes);
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
      byte => byte.toString(16).padStart(2, "0")).join("");
    if (hash !== image.sha256) {
      throw new Error(`Pi fork image ${index + 1} differs from the selected Pi JSONL entry`);
    }
    await saveComposerImageDraft(scopeKey, { id: ids[index]!, fileName: image.fileName,
      mimeType: image.mimeType, file: new File([bytes], image.fileName, { type: image.mimeType }) });
  }
}
