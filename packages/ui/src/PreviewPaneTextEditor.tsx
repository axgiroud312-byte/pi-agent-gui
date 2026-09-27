import { useEffect, useRef, useState } from "react";
import type { IFileService } from "@zcode/services";
import { Button } from "@/components/ui/button.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import {
  clearEditableFileDraft,
  loadEditableFileDraft,
  saveEditableFileDraft,
} from "@/lib/editableFileDraft.js";

interface EditorState {
  content: string;
  baseVersion: string;
  diskContent: string;
  diskVersion: string;
}

export function PreviewPaneTextEditor({
  fileService,
  rootPath,
  path,
  onSaved,
}: {
  fileService: IFileService;
  rootPath: string;
  path: string;
  onSaved: () => void;
}) {
  const { intl } = useZCodeIntl();
  const [document, setDocument] = useState<EditorState | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draftError, setDraftError] = useState(false);
  const target = { rootPath, path };
  const targetIdentity = `${rootPath}\0${path}`;
  const targetScopeRef = useRef({ identity: targetIdentity, generation: 0 });
  if (targetScopeRef.current.identity !== targetIdentity) {
    targetScopeRef.current = { identity: targetIdentity, generation: targetScopeRef.current.generation + 1 };
  }
  const generation = targetScopeRef.current.generation;
  const mountedRef = useRef(false);
  const documentRef = useRef<EditorState | null>(null);
  const savingRef = useRef<number | null>(null);
  const isCurrentTarget = () => mountedRef.current && targetScopeRef.current.generation === generation;

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    let disposed = false;
    setSaving(false);
    setLoading(true);
    setError(null);
    documentRef.current = null;
    setDocument(null);
    void fileService
      .readEditableText({ rootPath, path })
      .then((snapshot) => {
        if (disposed) return;
        let draft = null;
        try {
          draft = loadEditableFileDraft(window.localStorage, { rootPath, path });
        } catch {
          setDraftError(true);
          setError(intl.formatMessage({ id: "codeViewer.edit.draftError" }));
        }
        const loaded: EditorState = {
          content: draft?.content ?? snapshot.content,
          baseVersion: draft?.baseVersion ?? snapshot.version,
          diskContent: snapshot.content,
          diskVersion: snapshot.version,
        };
        documentRef.current = loaded;
        setDocument(loaded);
      })
      .catch((readError: unknown) => {
        if (disposed) return;
        setError(readError instanceof Error ? readError.message : String(readError));
      })
      .finally(() => {
        if (!disposed) setLoading(false);
      });
    return () => {
      disposed = true;
    };
  }, [fileService, rootPath, path, intl, generation]);

  const updateDraft = (next: EditorState): boolean => {
    documentRef.current = next;
    setDocument(next);
    try {
      if (next.content === next.diskContent && next.baseVersion === next.diskVersion) {
        clearEditableFileDraft(window.localStorage, target);
      } else {
        saveEditableFileDraft(window.localStorage, target, {
          baseVersion: next.baseVersion,
          content: next.content,
        });
      }
      setDraftError(false);
      return true;
    } catch {
      setDraftError(true);
      setError(intl.formatMessage({ id: "codeViewer.edit.draftError" }));
      return false;
    }
  };

  const handleSave = async () => {
    const submitted = documentRef.current;
    if (!submitted || savingRef.current === generation ||
      submitted.baseVersion !== submitted.diskVersion) return;
    savingRef.current = generation;
    setSaving(true);
    setError(null);
    try {
      const saved = await fileService.saveEditableText({
        rootPath,
        path,
        expectedVersion: submitted.baseVersion,
        content: submitted.content,
      });
      if (!isCurrentTarget()) {
        // The old target may finish after a different file opens. Retire only
        // the exact draft that was saved and only while that target remains
        // closed. A-B-A can create a new draft identical to the old submitted
        // text, and the old ACK must never erase it.
        try {
          if (targetScopeRef.current.identity !== targetIdentity) {
            const stored = loadEditableFileDraft(window.localStorage, target);
            if (stored?.baseVersion === submitted.baseVersion && stored.content === submitted.content) {
              clearEditableFileDraft(window.localStorage, target);
            }
          }
        } catch { /* A damaged or unavailable draft remains for explicit recovery. */ }
        return;
      }
      const latest = documentRef.current;
      if (!latest) return;
      const next: EditorState = {
        content: latest.content,
        baseVersion: saved.version,
        diskContent: submitted.content,
        diskVersion: saved.version,
      };
      const persisted = updateDraft(next);
      if (latest.content === submitted.content && persisted) onSaved();
    } catch (saveError) {
      if (!isCurrentTarget()) return;
      if (saveError instanceof Error && saveError.message.includes("FILE_CHANGED")) {
        try {
          const latest = await fileService.readEditableText({ rootPath, path });
          if (!isCurrentTarget() || !documentRef.current) return;
          updateDraft({ ...documentRef.current, diskContent: latest.content, diskVersion: latest.version });
          setError(intl.formatMessage({ id: "codeViewer.edit.conflict" }));
        } catch (readError) {
          if (isCurrentTarget()) setError(readError instanceof Error ? readError.message : String(readError));
        }
      } else {
        setError(saveError instanceof Error ? saveError.message : String(saveError));
      }
    } finally {
      if (savingRef.current === generation) {
        savingRef.current = null;
        if (isCurrentTarget()) setSaving(false);
      }
    }
  };

  const conflict = Boolean(document && document.baseVersion !== document.diskVersion);
  return (
    <div className="flex h-full flex-col gap-2 p-3 text-ui-base" data-testid="pi-file-editor">
      {loading ? <p>{intl.formatMessage({ id: "codeViewer.edit.loading" })}</p> : null}
      {error ? (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      ) : null}
      {draftError ? (
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            clearEditableFileDraft(window.localStorage, target);
            setDraftError(false);
            setError(null);
          }}
        >
          {intl.formatMessage({ id: "codeViewer.edit.clearDamagedDraft" })}
        </Button>
      ) : null}
      {document ? (
        <>
          {conflict ? (
            <section
              className="rounded border border-destructive/50 p-2"
              data-testid="pi-file-save-conflict"
            >
              <p className="mb-2 text-destructive">
                {intl.formatMessage({ id: "codeViewer.edit.conflict" })}
              </p>
              <p>{intl.formatMessage({ id: "codeViewer.edit.diskVersion" })}</p>
              <pre className="max-h-32 overflow-auto whitespace-pre-wrap rounded bg-surface p-2">
                {document.diskContent}
              </pre>
              <div className="mt-2 flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() =>
                    updateDraft({
                      ...document,
                      content: document.diskContent,
                      baseVersion: document.diskVersion,
                    })
                  }
                >
                  {intl.formatMessage({ id: "codeViewer.edit.useDisk" })}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => updateDraft({ ...document, baseVersion: document.diskVersion })}
                >
                  {intl.formatMessage({ id: "codeViewer.edit.rebaseDraft" })}
                </Button>
              </div>
            </section>
          ) : null}
          <textarea
            aria-label={intl.formatMessage({ id: "codeViewer.edit.text" })}
            className="min-h-0 flex-1 resize-none rounded border border-border bg-background p-2 font-mono text-ui-base text-foreground"
            value={document.content}
            spellCheck={false}
            onChange={(event) => updateDraft({ ...document, content: event.currentTarget.value })}
          />
          <div className="flex items-center justify-between gap-2">
            <span className="text-foreground-subtle">
              {document.content !== document.diskContent
                ? intl.formatMessage({ id: "codeViewer.edit.unsaved" })
                : ""}
            </span>
            <Button
              type="button"
              onClick={() => void handleSave()}
              disabled={saving || conflict || document.content === document.diskContent}
            >
              {saving
                ? intl.formatMessage({ id: "codeViewer.edit.saving" })
                : intl.formatMessage({ id: "codeViewer.edit.save" })}
            </Button>
          </div>
        </>
      ) : null}
    </div>
  );
}
