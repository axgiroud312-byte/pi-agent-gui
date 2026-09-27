/** Versioned Pi queue facts. Image bytes never appear in a whole-queue response. */
export interface PiQueueImageV1 {
  type: "image";
  data: string;
  mimeType: string;
}

export interface PiQueueItemV1 {
  id: string;
  text: string;
  images: PiQueueImageV1[];
}

export interface PiQueueCatalogItemV1 {
  id: string;
  text: string;
  images: Array<{ mimeType: string; bytes: number }>;
}

export interface PiQueueCatalogV1 {
  revision: number;
  paused: boolean;
  steering: PiQueueCatalogItemV1[];
  followUp: PiQueueCatalogItemV1[];
}

export type PiQueueOperationV1 =
  | { kind: "take"; id: string }
  | { kind: "move"; id: string; beforeId: string | null }
  | { kind: "replace"; id: string; text: string; images?: PiQueueImageV1[] };

export interface PiQueueMutationV1 {
  catalog: PiQueueCatalogV1;
  takenId?: string;
}

function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Pi queue returned an invalid object");
  }
  return value as Record<string, unknown>;
}

function parseImage(value: unknown): PiQueueImageV1 {
  const raw = object(value);
  if (raw.type !== "image" || typeof raw.data !== "string" || typeof raw.mimeType !== "string") {
    throw new Error("Pi queue returned an invalid image");
  }
  return { type: "image", data: raw.data, mimeType: raw.mimeType };
}

export function parsePiQueueItem(value: unknown): PiQueueItemV1 {
  const raw = object(value);
  if (typeof raw.id !== "string" || !raw.id || typeof raw.text !== "string" || !Array.isArray(raw.images)) {
    throw new Error("Pi queue returned an invalid item");
  }
  return { id: raw.id, text: raw.text, images: raw.images.map(parseImage) };
}

function parseCatalogItem(value: unknown): PiQueueCatalogItemV1 {
  const raw = object(value);
  if (typeof raw.id !== "string" || !raw.id || typeof raw.text !== "string" || !Array.isArray(raw.images)) {
    throw new Error("Pi queue returned an invalid catalog item");
  }
  return { id: raw.id, text: raw.text, images: raw.images.map(value => {
    const image = object(value);
    if (typeof image.mimeType !== "string" || !Number.isSafeInteger(image.bytes) || Number(image.bytes) < 0) {
      throw new Error("Pi queue returned invalid image metadata");
    }
    return { mimeType: image.mimeType as string, bytes: image.bytes as number };
  }) };
}

export function parsePiQueueCatalog(value: unknown): PiQueueCatalogV1 {
  const raw = object(value);
  if (!Number.isSafeInteger(raw.revision) || typeof raw.paused !== "boolean" ||
    !Array.isArray(raw.steering) || !Array.isArray(raw.followUp)) {
    throw new Error("Pi queue returned an invalid catalog");
  }
  const steering = raw.steering.map(parseCatalogItem);
  const followUp = raw.followUp.map(parseCatalogItem);
  const ids = [...steering, ...followUp].map(item => item.id);
  if (new Set(ids).size !== ids.length) throw new Error("Pi queue returned duplicate item IDs");
  return { revision: raw.revision as number, paused: raw.paused as boolean, steering, followUp };
}

export function parsePiQueueMutation(value: unknown): PiQueueMutationV1 {
  const raw = object(value);
  if (raw.takenId !== undefined && typeof raw.takenId !== "string") {
    throw new Error("Pi queue returned an invalid taken ID");
  }
  return { catalog: parsePiQueueCatalog(raw.catalog),
    ...(raw.takenId === undefined ? {} : { takenId: raw.takenId as string }) };
}

export function parsePiQueueTakeAll(value: unknown): { catalog: PiQueueCatalogV1; takenIds: string[] } {
  const raw = object(value);
  if (!Array.isArray(raw.takenIds) || raw.takenIds.some(id => typeof id !== "string")) {
    throw new Error("Pi queue returned invalid taken IDs");
  }
  return { catalog: parsePiQueueCatalog(raw.catalog), takenIds: raw.takenIds as string[] };
}
