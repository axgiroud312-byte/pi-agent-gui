import { piFileSnapshotEpilogueStart } from "./pi-file-references.js";
import { assertPiPromptRecordFits, type PiPromptImage } from "./pi-prompt-images.js";

const supportedImageMimeTypes = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
const maxImageBytes = 20 * 1024 * 1024;

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

/** Require the exact text-then-images shape that Pi RPC can re-submit without changing content. */
export function retryablePiHistoryContent(content: unknown): { text: string; images: PiPromptImage[] } {
  const parts = typeof content === "string" ? [{ type: "text", text: content }] : content;
  if (!Array.isArray(parts) || parts.length === 0) throw new Error("Pi history content cannot be replayed losslessly");
  const first = object(parts[0]);
  if (!first || first.type !== "text" || typeof first.text !== "string" ||
    Object.keys(first).some(key => key !== "type" && key !== "text")) {
    throw new Error("Pi history content cannot be replayed losslessly");
  }
  const text = first.text;
  if (text.startsWith("/")) throw new Error("Pi history slash command cannot be retried as an ordinary prompt");
  const images: PiPromptImage[] = [];
  for (const part of parts.slice(1)) {
    const image = object(part);
    if (!image || image.type !== "image" || typeof image.data !== "string" ||
      typeof image.mimeType !== "string" || !supportedImageMimeTypes.has(image.mimeType) ||
      Object.keys(image).some(key => key !== "type" && key !== "data" && key !== "mimeType") ||
      image.data.length === 0 || image.data.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/u.test(image.data)) {
      throw new Error("Pi history contains an image or content block that cannot be replayed losslessly");
    }
    const bytes = Buffer.from(image.data, "base64");
    if (bytes.length === 0 || bytes.length > maxImageBytes || bytes.toString("base64") !== image.data) {
      throw new Error("Pi history image is invalid or exceeds the 20 MiB replay limit");
    }
    images.push({ type: "image", data: image.data, mimeType: image.mimeType });
  }
  if (!text.trim() && images.length === 0) throw new Error("Pi history input is empty");
  assertPiPromptRecordFits(text, images);
  return { text, images };
}

/** Inline editing cannot preserve media or an old captured file snapshot in the native text composer. */
export function editablePiHistoryText(content: unknown): string {
  const prompt = retryablePiHistoryContent(content);
  if (prompt.images.length) throw new Error("Pi history image cannot be restored to the text editor losslessly");
  if (piFileSnapshotEpilogueStart(prompt.text) !== undefined) {
    throw new Error("Pi history file snapshot cannot be restored to the text editor losslessly");
  }
  return prompt.text;
}
