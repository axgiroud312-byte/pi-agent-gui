import { PROTOCOL_V4_LIMITS } from "@zcode/shared/zcode-protocol-v4";

/** The manifest is small and synchronous; image bytes live in Chromium's profile-backed IndexedDB. */
const MANIFEST_PREFIX = "zcode-v4-composer-images:v1:";
const DATABASE_NAME = "zcode-v4-composer-images";
const OBJECT_STORE = "images";
const MAX_IMAGES_PER_SCOPE = 8;
const MAX_IMAGE_BYTES = Math.min(20 * 1024 * 1024, PROTOCOL_V4_LIMITS.attachmentMaxBytes);
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
  finish: (value: T) => void) => void): Promise<T> {
  const database = await openDatabase();
  return new Promise<T>((resolve, reject) => {
    const transaction = database.transaction(OBJECT_STORE, mode);
    let value: T;
    transaction.oncomplete = () => resolve(value);
    transaction.onerror = () => reject(transaction.error ?? new Error("Image draft transaction failed"));
    transaction.onabort = () => reject(transaction.error ?? new Error("Image draft transaction aborted"));
    operation(transaction.objectStore(OBJECT_STORE), result => { value = result; });
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
  await transact<void>("readwrite", (store, finish) => {
    store.put(entry);
    finish(undefined);
  });
  try {
    // Another window may have removed an image while bytes were written. Re-read its latest order.
    const current = readManifest(scopeKey);
    if (!current.ids.includes(input.id)) writeManifest(scopeKey, [...current.ids, input.id]);
  } catch (error) {
    await deleteImageRecords([input.id]).catch(() => {});
    throw error;
  }
}

async function deleteImageRecords(ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return;
  await transact<void>("readwrite", (store, finish) => {
    for (const id of ids) store.delete(id);
    finish(undefined);
  });
}

/** The manifest is removed first, so a crash during blob cleanup cannot resurrect a sent image. */
export function forgetComposerImageDrafts(scopeKey: string, ids?: readonly string[]): Promise<void> {
  const current = readManifest(scopeKey);
  const removed = ids ? current.ids.filter(id => ids.includes(id)) : current.ids;
  writeManifest(scopeKey, current.ids.filter(id => !removed.includes(id)));
  return deleteImageRecords(removed);
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

export async function readComposerImageDrafts(scopeKey: string): Promise<Array<RestoredImageDraft | FailedImageDraft>> {
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
