import type { AttachmentRef } from "@zcode/shared/zcode-protocol-v4";
import type { ComposerRestoreRequest } from "./ConversationComposer.js";
import { forgetComposerImageDraftScope, readComposerImageDrafts, saveComposerImageDraft,
  type RestoredImageDraft } from "./composer/composerImageDraftStorage.js";

const STORAGE_PREFIX = "zcode-v4-pi-queue-edit-recovery:v2:";
const PURGE_PREFIX = "zcode-v4-pi-queue-edit-recovery-purge:v1:";
const DELETE_INTENT_PREFIX = "zcode-v4-pi-session-recovery-delete-intent:v1:";
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/;

async function imageSha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes));
  return `sha256:${Array.from(new Uint8Array(digest), byte =>
    byte.toString(16).padStart(2, "0")).join("")}`;
}

export interface PiQueueEditRecovery {
  queueItemId: string;
  sessionId: string;
  workspaceKey: string;
  inputKind: "sendText" | "sendGoalCommand";
  text: string;
  attachments: Array<AttachmentRef & { draftId: string; sha256: string }>;
  config?: ComposerRestoreRequest["config"];
  savedAt: number;
  /** Preparing indexes a partial IDB copy before any byte is written. */
  state: "preparing" | "prepared" | "withdrawn" | "restored";
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

function deleteIntentKey(workspaceKey: string, sessionId: string): string {
  return `${DELETE_INTENT_PREFIX}${encodeURIComponent(`${workspaceKey}\0${sessionId}`)}`;
}

export interface PiSessionRecoveryDeletionIntent {
  workspaceKey: string;
  workspacePath: string;
  workspaceIdentity?: string;
  sessionId: string;
}

/** Persist after human confirmation, before the Pi JSONL delete RPC. */
export function markPiSessionRecoveryDeletionIntent(storage: Storage,
  intent: PiSessionRecoveryDeletionIntent): void {
  storage.setItem(deleteIntentKey(intent.workspaceKey, intent.sessionId), JSON.stringify(intent));
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
      (item.state !== "preparing" && item.state !== "prepared" &&
        item.state !== "withdrawn" && item.state !== "restored") ||
      !Array.isArray(item.attachments) || item.attachments.length > 8 ||
      !item.attachments.every(attachment => isRecord(attachment) &&
        typeof attachment.ref === "string" && typeof attachment.fileName === "string" &&
        typeof attachment.draftId === "string" &&
        typeof attachment.sha256 === "string" && SHA256_PATTERN.test(attachment.sha256) &&
        IMAGE_TYPES.has(String(attachment.mime)) &&
        Number.isSafeInteger(attachment.bytes) && Number(attachment.bytes) > 0 &&
        Number(attachment.bytes) <= MAX_IMAGE_BYTES)) {
      throw new Error("Pi queue edit recovery index is damaged; keep the Pi queue item");
    }
    values.push(item as unknown as PiQueueEditRecovery);
    if (values.length > 64) throw new Error("Too many Pi queued edit recovery copies");
  }
  return values.sort((left, right) => left.savedAt - right.savedAt);
}

/** Index the scope first so even a partial IDB copy can be reclaimed after a crash. */
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
  for (const attachment of target.attachments) {
    if (!IMAGE_TYPES.has(attachment.mime) || attachment.bytes <= 0 || attachment.bytes > MAX_IMAGE_BYTES) {
      throw new Error("Pi queued attachment cannot be saved losslessly as an image draft");
    }
  }
  const scope = piQueueEditRecoveryScope(workspaceKey, sessionId, target.queueItemId);
  const key = storageKey(workspaceKey, sessionId, target.queueItemId);
  const preparing: PiQueueEditRecovery = { queueItemId: target.queueItemId, sessionId, workspaceKey,
    inputKind: target.inputKind, text: target.text, attachments: [],
    ...(target.config ? { config: target.config } : {}), savedAt: Date.now(), state: "preparing" };
  // A failed index write prevents all IDB writes and leaves Pi's item untouched.
  // This marker also prevents another window from preparing the same item.
  storage.setItem(key, JSON.stringify(preparing));
  const attachments: PiQueueEditRecovery["attachments"] = [];
  for (const [index, attachment] of target.attachments.entries()) {
    const read = await input.readImage(attachment, index);
    if (read.mediaType !== attachment.mime || read.bytes.byteLength !== attachment.bytes) {
      throw new Error("Pi queued image changed during durable recovery preparation");
    }
    const draftId = crypto.randomUUID();
    const file = new File([new Uint8Array(read.bytes)], attachment.fileName, { type: attachment.mime });
    const sha256 = await imageSha256(new Uint8Array(await file.arrayBuffer()));
    await (input.saveImage ?? (async (key, id, image) => saveComposerImageDraft(key, {
      id, fileName: image.name, mimeType: image.type, file: image })))(scope, draftId, file);
    attachments.push({ ...attachment, draftId, sha256 });
  }
  const entry: PiQueueEditRecovery = { ...preparing, attachments, state: "prepared" };
  // A failed final index write leaves the indexed partial copy available for cleanup;
  // the caller never sends Pi's delete RPC until this prepared entry is returned.
  storage.setItem(key, JSON.stringify(entry));
  return entry;
}

/** A composer-only image reference needs its durable queue backup until the draft is gone. */
export function canDiscardPiQueueEditRecovery(draft: { hasContent: boolean; busy: boolean }): boolean {
  return !draft.hasContent && !draft.busy;
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
  if (entry.state === "preparing") throw new Error("Pi queued image backup is incomplete; cannot restore");
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
  for (const [index, file] of files.entries()) {
    const actualSha = await imageSha256(new Uint8Array(await file.arrayBuffer()));
    if (!SHA256_PATTERN.test(entry.attachments[index]!.sha256) ||
      actualSha !== entry.attachments[index]!.sha256) {
      throw new Error("Saved Pi queued image SHA changed or is damaged");
    }
  }
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
  if (entry.state === "preparing") throw new Error("Pi queue edit recovery copy is incomplete");
  const next = { ...entry, state: input.state };
  input.storage.setItem(storageKey(input.workspaceKey, input.sessionId, input.queueItemId),
    JSON.stringify(next));
  return next;
}

/** A non-accepting ACK cannot prove another window has not removed the Pi item. */
export async function settlePiQueueEditDelete(input: PurgeInput & { status: string }): Promise<void> {
  if (input.status === "accepted" || input.status === "duplicate") {
    markPiQueueEditRecoveryState({ ...input, state: "withdrawn" });
  }
}

export function shouldDiscardPiQueueRecoveryAfterSend(
  saved: { sessionId: string; text: string; refs: readonly AttachmentRef[] },
  submission: { sessionId: string | null; text: string; attachments?: readonly AttachmentRef[];
    result: string; durablePiRecord: boolean },
): boolean {
  const actual = submission.attachments ?? [];
  // A send ACK can mean an in-memory Pi queue admission. The profile bookmark
  // or Pi JSONL may still fail to persist, so an ACK alone cannot retire bytes.
  return submission.durablePiRecord && submission.result === "sent" &&
    saved.sessionId === submission.sessionId &&
    saved.text === submission.text && saved.refs.length === actual.length &&
    saved.refs.every((ref, index) => ref.ref === actual[index]?.ref &&
      ref.fileName === actual[index]?.fileName && ref.mime === actual[index]?.mime &&
      ref.bytes === actual[index]?.bytes);
}

/** Call only after confirmed deletion of the real Pi session JSONL. */
export async function forgetPiQueueEditRecoveriesForSession(input: Omit<PurgeInput, "queueItemId">): Promise<void> {
  const current = readPiQueueEditRecoveries(input.storage, input.workspaceKey, input.sessionId);
  for (const item of current) await purgeOne({ ...input, queueItemId: item.queueItemId });
  input.storage.removeItem(deleteIntentKey(input.workspaceKey, input.sessionId));
}

/** Reconcile the crash window between the Pi delete ACK and local profile cleanup. */
export async function retryPendingPiQueueRecoveryDeletions(input: {
  storage: Storage;
  sessionExists: (intent: PiSessionRecoveryDeletionIntent) => Promise<boolean>;
  forgetImages?: (scope: string) => Promise<void>;
}): Promise<void> {
  const pending: PiSessionRecoveryDeletionIntent[] = [];
  for (let index = 0; index < input.storage.length; index += 1) {
    const key = input.storage.key(index);
    if (!key?.startsWith(DELETE_INTENT_PREFIX)) continue;
    const value: unknown = JSON.parse(input.storage.getItem(key) ?? "null");
    if (!isRecord(value) || typeof value.workspaceKey !== "string" ||
      typeof value.workspacePath !== "string" || typeof value.sessionId !== "string" ||
      (value.workspaceIdentity !== undefined && typeof value.workspaceIdentity !== "string") ||
      key !== deleteIntentKey(value.workspaceKey, value.sessionId)) {
      throw new Error("Pi session recovery deletion intent is damaged");
    }
    pending.push(value as unknown as PiSessionRecoveryDeletionIntent);
  }
  for (const intent of pending) {
    if (await input.sessionExists(intent)) {
      // Pi still owns the JSONL. Keep the marker: deletion may still be in
      // flight in another window, so a later check must reconcile its ACK.
      continue;
    } else {
      await forgetPiQueueEditRecoveriesForSession({ storage: input.storage,
        workspaceKey: intent.workspaceKey, sessionId: intent.sessionId,
        forgetImages: input.forgetImages });
    }
  }
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
