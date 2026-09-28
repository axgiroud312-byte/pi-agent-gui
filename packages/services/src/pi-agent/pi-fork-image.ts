import { createHash } from "node:crypto";

const REF = /^pi-entry-image:([A-Za-z0-9._-]{1,256}):(0|[1-9]\d*)$/u;
const MIME = ["image/png", "image/jpeg", "image/gif", "image/webp"] as const;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;
const MAX_BYTES = 20 * 1024 * 1024;

type ImageMime = typeof MIME[number];

export function piForkImageRef(entryId: string, partIndex: number): string {
  if (!/^[A-Za-z0-9._-]{1,256}$/u.test(entryId) || !Number.isSafeInteger(partIndex) || partIndex < 0) {
    throw new Error("Invalid Pi fork image identity");
  }
  return `pi-entry-image:${entryId}:${partIndex}`;
}

/** Resolve only an exact user message entry owned by the requested Pi session. */
export function piForkImageFromEntries(entries: unknown, ref: string): {
  bytes: Buffer; mimeType: ImageMime; fileName: string; sha256: string;
} {
  const match = REF.exec(ref);
  if (!match || !Array.isArray(entries)) throw new Error("Invalid Pi fork image reference");
  const selected = entries.filter(entry => entry && typeof entry === "object" && entry.id === match[1]);
  if (selected.length !== 1 || selected[0].type !== "message" || selected[0].message?.role !== "user") {
    throw new Error("Pi fork image entry is unavailable in this source session");
  }
  const partIndex = Number(match[2]);
  const parts = selected[0].message.content;
  const image = Array.isArray(parts) ? parts[partIndex] : undefined;
  if (!image || image.type !== "image" || !MIME.includes(image.mimeType) ||
    typeof image.data !== "string" || !BASE64.test(image.data)) {
    throw new Error("Pi fork image bytes are unavailable in the selected entry");
  }
  const bytes = Buffer.from(image.data, "base64");
  if (!bytes.length || bytes.length > MAX_BYTES || bytes.toString("base64") !== image.data) {
    throw new Error("Pi fork image bytes are empty, too large, or damaged");
  }
  const extension = image.mimeType === "image/jpeg" ? "jpg" : image.mimeType.split("/")[1];
  return { bytes, mimeType: image.mimeType, fileName: `image-${partIndex + 1}.${extension}`,
    sha256: createHash("sha256").update(bytes).digest("hex") };
}

export function isPiForkImageRef(ref: string): boolean { return ref.startsWith("pi-entry-image:"); }
