import type { ExtensionMessageRow, ToolCallRow } from "@zcode/shared/zcode-protocol-v4";

type Data = Record<string, unknown>;
type RichParts = Pick<ExtensionMessageRow, "parts" | "attachments" | "details">;

function object(value: unknown): Data {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Data : {};
}

/** Keep Pi JSONL's content order; image refs never contain image bytes or paths. */
export function piRichMessageParts(message: Data, messageIndex: number, imageName: string): RichParts {
  const attachments: NonNullable<ExtensionMessageRow["attachments"]> = [];
  const source = typeof message.content === "string" ? [{ type: "text", text: message.content }]
    : Array.isArray(message.content) ? message.content : [message.content];
  const parts = source.map((rawPart, partIndex) => {
    const part = object(rawPart);
    if (part.type === "text" && typeof part.text === "string") return { type: "text" as const, text: part.text };
    if (part.type === "image" && typeof part.mimeType === "string" && typeof part.data === "string") {
      const ref = `pi-image:${messageIndex}:${partIndex}`;
      const bytes = Buffer.from(part.data, "base64").length;
      const attachmentIndex = attachments.length;
      const extension = part.mimeType === "image/jpeg" ? "jpg" : part.mimeType.split("/")[1] ?? "image";
      attachments.push({ ref, fileName: `${imageName}-${attachmentIndex + 1}.${extension}`,
        mime: part.mimeType, bytes });
      return { type: "image" as const, ref, mimeType: part.mimeType, bytes, attachmentIndex };
    }
    return { type: "unknown" as const, value: rawPart };
  });
  return { parts, ...(attachments.length ? { attachments } : {}),
    ...(message.details !== undefined ? { details: message.details } : {}) };
}

/** Native read cards hide output; keep their Pi text alongside every rich result. */
export function piToolRichResult(message: Data, messageIndex: number,
  includePlainText = false): ToolCallRow["piResult"] {
  const result = piRichMessageParts(message, messageIndex, "tool-image");
  return (includePlainText && result.parts.length > 0) || result.attachments?.length || result.details !== undefined ||
    result.parts.some(part => part.type === "unknown")
    ? result : undefined;
}
