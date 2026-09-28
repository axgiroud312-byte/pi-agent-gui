const DRAFT_PREFIX = "pi-editable-file-draft:v1:";

export interface EditableFileTarget {
  rootPath: string;
  path: string;
}

export interface EditableFileDraft {
  baseVersion: string;
  content: string;
}

function draftKey(target: EditableFileTarget): string {
  return `${DRAFT_PREFIX}${encodeURIComponent(target.rootPath)}:${encodeURIComponent(target.path)}`;
}

export function loadEditableFileDraft(
  storage: Pick<Storage, "getItem">,
  target: EditableFileTarget,
): EditableFileDraft | null {
  const raw = storage.getItem(draftKey(target));
  if (raw === null) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (
      typeof value === "object" &&
      value !== null &&
      "version" in value &&
      value.version === 1 &&
      "baseVersion" in value &&
      typeof value.baseVersion === "string" &&
      "content" in value &&
      typeof value.content === "string"
    ) {
      return { baseVersion: value.baseVersion, content: value.content };
    }
  } catch {
    // The draft stays on disk for explicit recovery or removal by the user.
  }
  throw new Error("INVALID_FILE_DRAFT");
}

export function saveEditableFileDraft(
  storage: Pick<Storage, "setItem">,
  target: EditableFileTarget,
  draft: EditableFileDraft,
): void {
  storage.setItem(draftKey(target), JSON.stringify({ version: 1, ...draft }));
}

export function clearEditableFileDraft(
  storage: Pick<Storage, "removeItem">,
  target: EditableFileTarget,
): void {
  storage.removeItem(draftKey(target));
}
