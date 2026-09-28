const MESSAGE_IDS: Record<string, string> = {
  FILE_NOT_FOUND: "chat.error.piFileReference.missing",
  OUTSIDE_WORKSPACE: "chat.error.piFileReference.outside",
  FILE_TOO_LARGE: "chat.error.piFileReference.large",
  DIRECTORY_TOO_LARGE: "chat.error.piFileReference.large",
  FILE_REFERENCES_TOO_LARGE: "chat.error.piFileReference.large",
  TOO_MANY_FILE_REFERENCES: "chat.error.piFileReference.many",
  FILE_CHANGED: "chat.error.piFileReference.changed",
  UNSUPPORTED_FILE_REFERENCE: "chat.error.piFileReference.unsupported",
  SYMLINK_REFERENCE_UNSUPPORTED: "chat.error.piFileReference.unsupported",
  INVALID_WORKSPACE: "chat.error.piFileReference.workspace",
};

/** Only map the stable Host reason code; never show arbitrary filesystem errors as user text. */
export function piFileReferenceFailureMessageId(detail: string | undefined): string | undefined {
  const code = /^pi\.fileReference\.([A-Z_]+)$/u.exec(detail ?? "")?.[1];
  return code ? MESSAGE_IDS[code] : undefined;
}
