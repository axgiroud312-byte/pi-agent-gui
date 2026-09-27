import { PROTOCOL_V4_LIMITS } from "@zcode/shared/zcode-protocol-v4";

/** The manifest is small and synchronous; image bytes live in Chromium's profile-backed IndexedDB. */
const MANIFEST_PREFIX = "zcode-v4-composer-images:v1:";
const DATABASE_NAME = "zcode-v4-composer-images";
const OBJECT_STORE = "images";
const MAX_IMAGES_PER_SCOPE = 8;
const MAX_IMAGE_BYTES = Math.min(20 * 1024 * 1024, PROTOCOL_V4_LIMITS.attachmentMaxBytes);
const MAX_PROFILE_IMAGES = 64;
const MAX_PROFILE_IMAGE_BYTES = 256 * 1024 * 1024;
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
/** A damaged index is a visible, removable failed attachment, never an empty draft. */
export const DAMAGED_IMAGE_DRAFT_ID = "__damaged_image_draft_manifest__";

interface ImageDraftManifest {
  version: 1;
  ids: string[];
}

interface StoredImageDraft {
  id: string;
  scopeKey: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  blob: Blob;
}

export interface RestoredImageDraft {
  id: string;
  fileName: string;
  mimeType: string;
  file: File;
}

export interface FailedImageDraft {
  id: string;
  fileName: string;
  error: string;
}

let databaseFlight: Promise<IDBDatabase> | null = null;
interface PendingImageDraftPromotion {
  targetScopeKey: string;
  done: Promise<void>;
  resolve: () => void;
  error?: Error;
}
const pendingPromotionsBySource = new Map<string, PendingImageDraftPromotion>();
const pendingPromotionsByTarget = new Map<string, PendingImageDraftPromotion>();

/** Pi has accepted the first submission; the old composer's ACK cleanup owns the move. */
export function beginComposerImageDraftPromotion(sourceScopeKey: string, targetScopeKey: string): void {
  if (sourceScopeKey === targetScopeKey) return;
  if (pendingPromotionsBySource.has(sourceScopeKey)) return;
  let resolve!: () => void;
  const done = new Promise<void>(ready => { resolve = ready; });
  const pending = { targetScopeKey, done, resolve };
  pendingPromotionsBySource.set(sourceScopeKey, pending);
  pendingPromotionsByTarget.set(targetScopeKey, pending);
}

export function pendingComposerImageDraftPromotionTarget(sourceScopeKey: string): string | null {
  return pendingPromotionsBySource.get(sourceScopeKey)?.targetScopeKey ?? null;
}

export function finishComposerImageDraftPromotion(sourceScopeKey: string, error?: Error): void {
  const pending = pendingPromotionsBySource.get(sourceScopeKey);
  if (!pending) return;
  pendingPromotionsBySource.delete(sourceScopeKey);
  pending.error = error;
  pendingPromotionsByTarget.delete(pending.targetScopeKey);
  pending.resolve();
}

/** Keep a removable failed chip if promotion fails after the old pane navigates away. */
export function markFailedComposerImageDraftPromotion(targetScopeKey: string, ids: readonly string[]): void {
  const current = readManifest(targetScopeKey);
  const next = [...new Set([...current.ids, ...ids])];
  writeManifest(targetScopeKey, next);
}

function manifestKey(scopeKey: string): string {
  return `${MANIFEST_PREFIX}${encodeURIComponent(scopeKey)}`;
}

function readManifest(scopeKey: string): ImageDraftManifest {
  const raw = window.localStorage.getItem(manifestKey(scopeKey));
  if (!raw) return { version: 1, ids: [] };
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || !("version" in parsed) || parsed.version !== 1 ||
    !("ids" in parsed) || !Array.isArray(parsed.ids) || parsed.ids.length > MAX_IMAGES_PER_SCOPE ||
    parsed.ids.some(id => typeof id !== "string" || !id.trim()) ||
    new Set(parsed.ids).size !== parsed.ids.length) {
    throw new Error("Saved image draft index is damaged");
  }
  return { version: 1, ids: parsed.ids as string[] };
}

export function listComposerImageDraftIds(scopeKey: string): string[] {
  return readManifest(scopeKey).ids;
}

/** Reserve every forked image before restoring text or copying bytes.
 * A crash mid-copy leaves failed chips that block sending a text-only fork. */
export function reserveComposerImageDrafts(scopeKey: string, ids: readonly string[]): void {
  if (ids.length === 0 || ids.length > MAX_IMAGES_PER_SCOPE ||
    ids.some(id => !id.trim()) || new Set(ids).size !== ids.length) {
    throw new Error("Invalid Pi fork image draft reservation");
  }
  if (readManifest(scopeKey).ids.length > 0) {
    throw new Error("Pi fork child already has saved image drafts");
  }
  writeManifest(scopeKey, ids);
}

function writeManifest(scopeKey: string, ids: readonly string[]): void {
  if (ids.length > MAX_IMAGES_PER_SCOPE) throw new Error("Too many saved image drafts");
  const key = manifestKey(scopeKey);
  if (ids.length === 0) window.localStorage.removeItem(key);
  else window.localStorage.setItem(key, JSON.stringify({ version: 1, ids: [...ids] } satisfies ImageDraftManifest));
}

function openDatabase(): Promise<IDBDatabase> {
  if (databaseFlight) return databaseFlight;
  if (typeof indexedDB === "undefined") return Promise.reject(new Error("Image draft storage is unavailable"));
  databaseFlight = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(OBJECT_STORE)) {
        request.result.createObjectStore(OBJECT_STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Image draft database failed to open"));
    request.onblocked = () => reject(new Error("Image draft database is blocked"));
  }).catch(error => {
    databaseFlight = null;
    throw error;
  });
  return databaseFlight;
}

async function transact<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore,
  finish: (value: T) => void, abort: (error: Error) => void) => void): Promise<T> {
  const database = await openDatabase();
  return new Promise<T>((resolve, reject) => {
    const transaction = database.transaction(OBJECT_STORE, mode);
    let value: T;
    let failure: Error | undefined;
    transaction.oncomplete = () => resolve(value);
    transaction.onerror = () => reject(transaction.error ?? new Error("Image draft transaction failed"));
    transaction.onabort = () => reject(failure ?? transaction.error ?? new Error("Image draft transaction aborted"));
    operation(transaction.objectStore(OBJECT_STORE), result => { value = result; }, error => {
      failure = error;
      transaction.abort();
    });
  });
}

async function sha256(blob: Blob): Promise<string> {
  const bytes = await blob.arrayBuffer();
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, "0")).join("");
}

/** Commit bytes before exposing the ID in the synchronous manifest. A crash cannot expose a partial image. */
export async function saveComposerImageDraft(scopeKey: string, input: {
  id: string; fileName: string; mimeType: string; file: File;
}): Promise<void> {
  if (!IMAGE_TYPES.has(input.mimeType) || input.file.size > MAX_IMAGE_BYTES || input.file.size === 0) {
    throw new Error("Only PNG, JPEG, GIF and WebP images up to 20 MiB can be saved as drafts");
  }
  const before = readManifest(scopeKey);
  if (!before.ids.includes(input.id) && before.ids.length >= MAX_IMAGES_PER_SCOPE) {
    throw new Error("Too many saved image drafts");
  }
  const entry: StoredImageDraft = { id: input.id, scopeKey, fileName: input.fileName,
    mimeType: input.mimeType, sizeBytes: input.file.size, sha256: await sha256(input.file), blob: input.file };
  // The cursor and put share one readwrite transaction, so concurrent windows
  // cannot both pass the profile budget before committing their own image.
  await transact<void>("readwrite", (store, finish, abort) => {
    let imageCount = 0;
    let totalBytes = 0;
    const request = store.openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        if (imageCount >= MAX_PROFILE_IMAGES || totalBytes + entry.sizeBytes > MAX_PROFILE_IMAGE_BYTES) {
          abort(new Error("Image draft profile capacity limit reached; remove an old draft before adding another"));
          return;
        }
        store.put(entry);
        return;
      }
      const row = cursor.value as StoredImageDraft;
      if (!row || typeof row.id !== "string" || typeof row.scopeKey !== "string" ||
        !(row.blob instanceof Blob) || !Number.isSafeInteger(row.blob.size)) {
        abort(new Error("Image draft profile storage is damaged; remove an old draft before adding another"));
        return;
      }
      if (row.id === entry.id) {
        if (row.scopeKey !== scopeKey) {
          abort(new Error("Image draft ID belongs to another workspace or session"));
          return;
        }
      } else {
        imageCount += 1;
        totalBytes += row.blob.size;
      }
      cursor.continue();
    };
    finish(undefined);
  });
  try {
    // Another window may have removed an image while bytes were written. Re-read its latest order.
    const current = readManifest(scopeKey);
    if (!current.ids.includes(input.id)) writeManifest(scopeKey, [...current.ids, input.id]);
  } catch (error) {
    await deleteImageRecords(scopeKey, [input.id]).catch(() => {});
    throw error;
  }
}

async function deleteImageRecords(scopeKey: string, ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return;
  await transact<void>("readwrite", (store, finish) => {
    for (const id of ids) {
      const request = store.get(id);
      request.onsuccess = () => {
        if ((request.result as StoredImageDraft | undefined)?.scopeKey === scopeKey) store.delete(id);
      };
    }
    finish(undefined);
  });
}

/** The manifest is removed first, so a crash during blob cleanup cannot resurrect a sent image. */
export function forgetComposerImageDrafts(scopeKey: string, ids?: readonly string[]): Promise<void> {
  const current = readManifest(scopeKey);
  const removed = ids ? current.ids.filter(id => ids.includes(id)) : current.ids;
  writeManifest(scopeKey, current.ids.filter(id => !removed.includes(id)));
  return deleteImageRecords(scopeKey, removed);
}

/** Only invoked after the user removes the damaged chip. No unknown image is silently sent. */
export function discardDamagedComposerImageDrafts(scopeKey: string): Promise<void> {
  try { window.localStorage.removeItem(manifestKey(scopeKey)); }
  catch { /* Explicit removal still clears the visible blocker if browser storage is unavailable. */ }
  return transact<void>("readwrite", (store, finish) => {
    const request = store.openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      if ((cursor.value as StoredImageDraft).scopeKey === scopeKey) cursor.delete();
      cursor.continue();
    };
    finish(undefined);
  });
}

/** A deleted session has no draft owner. Reclaim even orphaned rows left by a past interrupted write. */
export async function forgetComposerImageDraftScope(scopeKey: string): Promise<void> {
  window.localStorage.removeItem(manifestKey(scopeKey));
  await deleteImageRecordsByScope(value => value === scopeKey);
}

/** Removing a project must not match another project's path with the same prefix. */
export async function forgetComposerWorkspaceImageDrafts(workspaceKey: string): Promise<void> {
  const prefix = `${workspaceKey}\0`;
  const keys: string[] = [];
  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index);
    if (!key?.startsWith(MANIFEST_PREFIX)) continue;
    let scopeKey: string;
    try { scopeKey = decodeURIComponent(key.slice(MANIFEST_PREFIX.length)); }
    catch { continue; }
    if (scopeKey.startsWith(prefix)) keys.push(key);
  }
  for (const key of keys) window.localStorage.removeItem(key);
  await deleteImageRecordsByScope(value => value.startsWith(prefix));
}

/** Preserve newly added, unsent images when a first submission promotes the draft scope. */
export async function moveComposerImageDrafts(
  sourceScopeKey: string,
  targetScopeKey: string,
  ids: readonly string[],
): Promise<void> {
  if (sourceScopeKey === targetScopeKey || ids.length === 0) return;
  const requested = [...new Set(ids)];
  const source = readManifest(sourceScopeKey);
  if (requested.some(id => !source.ids.includes(id))) {
    throw new Error("An unsent image draft is missing from its source index");
  }
  const target = readManifest(targetScopeKey);
  if (requested.some(id => target.ids.includes(id))) {
    throw new Error("An unsent image draft already exists in the destination session");
  }
  if (target.ids.length + requested.length > MAX_IMAGES_PER_SCOPE) {
    throw new Error("Too many saved image drafts in the destination session");
  }
  // Expose the destination index first. An interruption can produce a visible
  // damaged chip there, but it cannot hide the source bytes from both scopes.
  writeManifest(targetScopeKey, [...target.ids, ...requested]);
  try {
    await transact<void>("readwrite", (store, finish, abort) => {
      for (const id of requested) {
        const request = store.get(id);
        request.onsuccess = () => {
          const row = request.result as StoredImageDraft | undefined;
          if (!row || row.id !== id || row.scopeKey !== sourceScopeKey) {
            abort(new Error("An unsent image draft cannot be moved safely"));
            return;
          }
          store.put({ ...row, scopeKey: targetScopeKey } satisfies StoredImageDraft);
        };
      }
      finish(undefined);
    });
  } catch (error) {
    // The IDB transaction is atomic; on failure the source index and bytes
    // remain valid. Remove only IDs introduced by this move.
    writeManifest(targetScopeKey, readManifest(targetScopeKey).ids.filter(id => !requested.includes(id)));
    throw error;
  }
  writeManifest(sourceScopeKey, readManifest(sourceScopeKey).ids.filter(id => !requested.includes(id)));
}

function deleteImageRecordsByScope(matches: (scopeKey: string) => boolean): Promise<void> {
  return transact<void>("readwrite", (store, finish) => {
    const request = store.openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      const scopeKey = (cursor.value as StoredImageDraft).scopeKey;
      if (typeof scopeKey === "string" && matches(scopeKey)) cursor.delete();
      cursor.continue();
    };
    finish(undefined);
  });
}

export async function readComposerImageDrafts(scopeKey: string): Promise<Array<RestoredImageDraft | FailedImageDraft>> {
  const pending = pendingPromotionsByTarget.get(scopeKey);
  if (pending) {
    await pending.done;
    if (pending.error) throw pending.error;
  }
  const ids = readManifest(scopeKey).ids;
  if (ids.length === 0) return [];
  const rows = await transact<Array<StoredImageDraft | undefined>>("readonly", (store, finish) => {
    const results: Array<StoredImageDraft | undefined> = Array(ids.length);
    ids.forEach((id, index) => {
      const request = store.get(id);
      request.onsuccess = () => { results[index] = request.result as StoredImageDraft | undefined; };
    });
    finish(results);
  });
  const restored: Array<RestoredImageDraft | FailedImageDraft> = [];
  for (let index = 0; index < ids.length; index += 1) {
    const row = rows[index];
    if (!row || row.id !== ids[index] || row.scopeKey !== scopeKey || !IMAGE_TYPES.has(row.mimeType) ||
      !(row.blob instanceof Blob) || row.blob.size !== row.sizeBytes || row.sizeBytes > MAX_IMAGE_BYTES ||
      await sha256(row.blob) !== row.sha256) {
      restored.push({ id: ids[index]!, fileName: row?.fileName ?? "Unrestored image draft",
        error: "Saved image draft is missing or damaged; remove and reattach it" });
      continue;
    }
    restored.push({ id: row.id, fileName: row.fileName, mimeType: row.mimeType,
      file: new File([row.blob], row.fileName, { type: row.mimeType }) });
  }
  return restored;
}
