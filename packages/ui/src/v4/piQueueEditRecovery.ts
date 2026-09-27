import type { AttachmentRef } from "@zcode/shared/zcode-protocol-v4";
import type { ComposerRestoreRequest } from "./ConversationComposer.js";
import { forgetComposerImageDraftScope, readComposerImageDrafts, saveComposerImageDraft,
  type RestoredImageDraft } from "./composer/composerImageDraftStorage.js";

const STORAGE_PREFIX = "zcode-v4-pi-queue-edit-recovery:v2:";
const PURGE_PREFIX = "zcode-v4-pi-queue-edit-recovery-purge:v1:";
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

export interface PiQueueEditRecovery {
  queueItemId: string;
  sessionId: string;
  workspaceKey: string;
  inputKind: "sendText" | "sendGoalCommand";
  text: string;
  attachments: Array<AttachmentRef & { draftId: string }>;
  config?: ComposerRestoreRequest["config"];
  savedAt: number;
  /** Prepared may mean an ACK was lost; only Pi confirms removal. */
  state: "prepared" | "withdrawn" | "restored";
}

function sessionStoragePrefix(workspaceKey: string, sessionId: string): string {
  return `${STORAGE_PREFIX}${encodeURIComponent(`${workspaceKey}\0${sessionId}`)}:`;
}

function storageKey(workspaceKey: string, sessionId: string, queueItemId: string): string {
  return `${sessionStoragePrefix(workspaceKey, sessionId)}${encodeURIComponent(queueItemId)}`;
}

function purgeKey(workspaceKey: string, sessionId: string, queueItemId: string): string {
  return `${PURGE_PREFIX}${encodeURIComponent(`${workspaceKey}\0${sessionId}\0${queueItemId}`)}`;
}

export function piQueueEditRecoveryScope(workspaceKey: string, sessionId: string,
  queueItemId: string): string {
  return `${workspaceKey}\0__pi_queue_edit_recovery__:${sessionId}:${queueItemId}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** A damaged recovery index blocks another deletion instead of hiding an unsent input. */
export function readPiQueueEditRecoveries(storage: Storage, workspaceKey: string,
  sessionId: string): PiQueueEditRecovery[] {
  const prefix = sessionStoragePrefix(workspaceKey, sessionId);
  const values: PiQueueEditRecovery[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (!key?.startsWith(prefix)) continue;
    const raw = storage.getItem(key);
    const item: unknown = raw ? JSON.parse(raw) : null;
    if (!isRecord(item) || typeof item.queueItemId !== "string" || item.queueItemId.length === 0 ||
      key !== storageKey(workspaceKey, sessionId, item.queueItemId) ||
      item.sessionId !== sessionId || item.workspaceKey !== workspaceKey ||
      (item.inputKind !== "sendText" && item.inputKind !== "sendGoalCommand") ||
      typeof item.text !== "string" || !Number.isSafeInteger(item.savedAt) ||
      (item.state !== "prepared" && item.state !== "withdrawn" && item.state !== "restored") ||
      !Array.isArray(item.attachments) || item.attachments.length > 8 ||
      !item.attachments.every(attachment => isRecord(attachment) &&
        typeof attachment.ref === "string" && typeof attachment.fileName === "string" &&
        typeof attachment.draftId === "string" && IMAGE_TYPES.has(String(attachment.mime)) &&
        Number.isSafeInteger(attachment.bytes) && Number(attachment.bytes) > 0 &&
        Number(attachment.bytes) <= MAX_IMAGE_BYTES)) {
      throw new Error("Pi queue edit recovery index is damaged; keep the Pi queue item");
    }
    values.push(item as unknown as PiQueueEditRecovery);
    if (values.length > 64) throw new Error("Too many Pi queued edit recovery copies");
  }
  return values.sort((left, right) => left.savedAt - right.savedAt);
}

/** Save every image in profile IDB, then atomically publish its text and image IDs. */
export async function preparePiQueueEditRecovery(input: {
  storage: Storage;
  workspaceKey: string;
  sessionId: string;
  target: { queueItemId: string; inputKind: "sendText" | "sendGoalCommand";
    text: string; attachments: readonly AttachmentRef[]; config?: PiQueueEditRecovery["config"] };
  readImage: (attachment: AttachmentRef, index: number) => Promise<{ bytes: Uint8Array; mediaType: string }>;
  saveImage?: (scope: string, id: string, file: File) => Promise<void>;
}): Promise<PiQueueEditRecovery> {
  const { storage, workspaceKey, sessionId, target } = input;
  const current = readPiQueueEditRecoveries(storage, workspaceKey, sessionId);
  if (current.some(item => item.queueItemId === target.queueItemId)) {
    throw new Error("A durable recovery copy already exists for this Pi queue item");
  }
  if (target.attachments.length > 8) throw new Error("Pi queue edit exceeds the image draft limit");
  const scope = piQueueEditRecoveryScope(workspaceKey, sessionId, target.queueItemId);
  const attachments: PiQueueEditRecovery["attachments"] = [];
  for (const [index, attachment] of target.attachments.entries()) {
    if (!IMAGE_TYPES.has(attachment.mime) || attachment.bytes <= 0 || attachment.bytes > MAX_IMAGE_BYTES) {
      throw new Error("Pi queued attachment cannot be saved losslessly as an image draft");
    }
    const read = await input.readImage(attachment, index);
    if (read.mediaType !== attachment.mime || read.bytes.byteLength !== attachment.bytes) {
      throw new Error("Pi queued image changed during durable recovery preparation");
    }
    const draftId = crypto.randomUUID();
    const file = new File([new Uint8Array(read.bytes)], attachment.fileName, { type: attachment.mime });
    await (input.saveImage ?? (async (key, id, image) => saveComposerImageDraft(key, {
      id, fileName: image.name, mimeType: image.type, file: image })))(scope, draftId, file);
    attachments.push({ ...attachment, draftId });
  }
  const entry: PiQueueEditRecovery = { queueItemId: target.queueItemId, sessionId, workspaceKey,
    inputKind: target.inputKind, text: target.text, attachments,
    ...(target.config ? { config: target.config } : {}), savedAt: Date.now(), state: "prepared" };
  // A failed localStorage write leaves Pi untouched. Unindexed IDB bytes are inert.
  // One key per Pi item prevents two renderer windows from overwriting distinct copies.
  storage.setItem(storageKey(workspaceKey, sessionId, target.queueItemId), JSON.stringify(entry));
  return entry;
}

export function decidePiQueueEditRestore(status: string,
  requested: { sessionId: string; workspaceKey: string },
  current: { sessionId: string | null; workspaceKey: string }, hasDraftContent: boolean):
  "restore" | "backup-only" | "queue-retained" {
  if (status !== "accepted" && status !== "duplicate") return "queue-retained";
  if (requested.sessionId !== current.sessionId || requested.workspaceKey !== current.workspaceKey ||
    hasDraftContent) return "backup-only";
  return "restore";
}

/** Re-stage saved bytes with this session's current Pi runtime before restoring composer chips. */
export async function restorePiQueueEditRecoveryRefs(input: {
  entry: PiQueueEditRecovery;
  workspaceKey: string;
  readFiles?: (scope: string) => Promise<Array<RestoredImageDraft | { id: string; fileName: string; error: string }>>;
  upload: (input: { sessionId: string; file: File }) => Promise<{ ref: string }>;
}): Promise<AttachmentRef[]> {
  const { entry } = input;
  const scope = piQueueEditRecoveryScope(input.workspaceKey, entry.sessionId, entry.queueItemId);
  const saved = await (input.readFiles ?? readComposerImageDrafts)(scope);
  const files = entry.attachments.map(attachment => {
    const record = saved.find(item => item.id === attachment.draftId);
    if (!record || !("file" in record) || record.fileName !== attachment.fileName ||
      record.mimeType !== attachment.mime || record.file.size !== attachment.bytes) {
      throw new Error("Saved Pi queued image is missing, changed or damaged");
    }
    return record.file;
  });
  const refs: AttachmentRef[] = [];
  for (const [index, file] of files.entries()) {
    const ref = await input.upload({ sessionId: entry.sessionId, file });
    if (!ref.ref) throw new Error("Pi image restaging did not return a ref");
    const attachment = entry.attachments[index]!;
    refs.push({ ref: ref.ref, fileName: attachment.fileName,
      mime: attachment.mime, bytes: attachment.bytes });
  }
  return refs;
}

interface PurgeInput {
  storage: Storage;
  workspaceKey: string;
  sessionId: string;
  queueItemId: string;
  forgetImages?: (scope: string) => Promise<void>;
}

async function purgeOne(input: PurgeInput): Promise<void> {
  const marker = purgeKey(input.workspaceKey, input.sessionId, input.queueItemId);
  input.storage.setItem(marker, JSON.stringify({ workspaceKey: input.workspaceKey,
    sessionId: input.sessionId, queueItemId: input.queueItemId }));
  // The marker survives an IDB failure, so a later app start can finish deleting private bytes.
  await (input.forgetImages ?? forgetComposerImageDraftScope)(piQueueEditRecoveryScope(
    input.workspaceKey, input.sessionId, input.queueItemId));
  input.storage.removeItem(storageKey(input.workspaceKey, input.sessionId, input.queueItemId));
  input.storage.removeItem(marker);
}

/** User-confirmed discard never forgets the index before its image bytes are reclaimed. */
export async function discardPiQueueEditRecovery(input: PurgeInput): Promise<void> {
  const current = readPiQueueEditRecoveries(input.storage, input.workspaceKey, input.sessionId);
  if (!current.some(item => item.queueItemId === input.queueItemId)) return;
  await purgeOne(input);
}

export function markPiQueueEditRecoveryState(input: Omit<PurgeInput, "forgetImages"> & {
  state: "withdrawn" | "restored";
}): PiQueueEditRecovery {
  const current = readPiQueueEditRecoveries(input.storage, input.workspaceKey, input.sessionId);
  const entry = current.find(item => item.queueItemId === input.queueItemId);
  if (!entry) throw new Error("Pi queue edit recovery copy is missing");
  const next = { ...entry, state: input.state };
  input.storage.setItem(storageKey(input.workspaceKey, input.sessionId, input.queueItemId),
    JSON.stringify(next));
  return next;
}

/** An explicit non-accepting Pi ACK leaves the item under Pi ownership. */
export async function settlePiQueueEditDelete(input: PurgeInput & { status: string }): Promise<void> {
  if (input.status === "accepted" || input.status === "duplicate") {
    markPiQueueEditRecoveryState({ ...input, state: "withdrawn" });
    return;
  }
  await discardPiQueueEditRecovery(input);
}

export function shouldDiscardPiQueueRecoveryAfterSend(
  saved: { sessionId: string; text: string; refs: readonly AttachmentRef[] },
  submission: { sessionId: string | null; text: string; attachments?: readonly AttachmentRef[];
    result: string },
): boolean {
  const actual = submission.attachments ?? [];
  return submission.result === "sent" && saved.sessionId === submission.sessionId &&
    saved.text === submission.text && saved.refs.length === actual.length &&
    saved.refs.every((ref, index) => ref.ref === actual[index]?.ref &&
      ref.fileName === actual[index]?.fileName && ref.mime === actual[index]?.mime &&
      ref.bytes === actual[index]?.bytes);
}

/** Call only after confirmed deletion of the real Pi session JSONL. */
export async function forgetPiQueueEditRecoveriesForSession(input: Omit<PurgeInput, "queueItemId">): Promise<void> {
  const current = readPiQueueEditRecoveries(input.storage, input.workspaceKey, input.sessionId);
  for (const item of current) await purgeOne({ ...input, queueItemId: item.queueItemId });
}

/** Retry a purge interrupted after JSONL deletion or by a locked profile database. */
export async function retryPendingPiQueueRecoveryPurges(input: {
  storage: Storage;
  forgetImages?: (scope: string) => Promise<void>;
}): Promise<void> {
  const pending: PurgeInput[] = [];
  for (let index = 0; index < input.storage.length; index += 1) {
    const key = input.storage.key(index);
    if (!key?.startsWith(PURGE_PREFIX)) continue;
    const value: unknown = JSON.parse(input.storage.getItem(key) ?? "null");
    if (!isRecord(value) || typeof value.workspaceKey !== "string" ||
      typeof value.sessionId !== "string" || typeof value.queueItemId !== "string" ||
      key !== purgeKey(value.workspaceKey, value.sessionId, value.queueItemId)) {
      throw new Error("Pi queued edit recovery purge marker is damaged");
    }
    pending.push({ storage: input.storage, workspaceKey: value.workspaceKey,
      sessionId: value.sessionId, queueItemId: value.queueItemId,
      forgetImages: input.forgetImages });
  }
  for (const item of pending) await purgeOne(item);
}
