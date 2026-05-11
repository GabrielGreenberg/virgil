"use client";

/**
 * ManageStylesModal — the single chrome surface for the user's style
 * library. Lets the user:
 *
 *   - Apply a style to the active document (silent if no drift; via
 *     StyleApplyDialog when the doc's preamble has drifted).
 *   - Pick the default style for new documents.
 *   - Edit, rename, duplicate, delete entries.
 *   - Save the active document's current preamble as a new entry.
 *   - Add a new empty style.
 *
 * Mounted from the Virgil bar's "Style" mode button — opened/closed in
 * lock-step with that button's `aria-pressed` state.
 */

import { useCallback, useEffect, useState } from "react";
import SystemDialog, {
  SystemDialogBody,
  SystemDialogButton,
  SystemDialogFooter,
  SystemDialogHeader,
} from "./system-dialog";
import StyleEditorModal from "./StyleEditorModal";
import StyleApplyDialog from "./StyleApplyDialog";
import type { StyleEntry } from "@/lib/document-styles";
import type { AiRequest } from "@/lib/types";
import { useStyleLibrary } from "@/hooks/useStyleLibrary";
import { useDocumentStyle } from "@/hooks/useDocumentStyle";
import { readTex } from "@/lib/storage";
import { extractPreambleAndPostamble } from "@/lib/latex-parser";

interface ManageStylesModalProps {
  onClose: () => void;
  /** Active doc id, or null when no document is open. When null, the
   *  modal hides the "Active" column and disables save-current. */
  docId: string | null;
  /** Pending AI requests on the active doc — used to detect an
   *  in-flight `style-merge` and show the banner. */
  aiRequests: AiRequest[];
  /** File a style-merge AI request. Same signature as the formerly
   *  inlined DocStyleDropdown prop. */
  addStyleMergeRequest: (args: {
    targetStyleId: string;
    targetStyleName: string;
    targetPreamble: string;
    currentPreamble: string;
    note?: string;
  }) => AiRequest;
}

export default function ManageStylesModal({
  onClose,
  docId,
  aiRequests,
  addStyleMergeRequest,
}: ManageStylesModalProps) {
  const {
    styles,
    defaultStyleId,
    addStyle,
    updateStyle,
    deleteStyle,
    duplicateStyle,
    setDefaultStyleId,
  } = useStyleLibrary();
  const { styleId, setStyle } = useDocumentStyle(docId);

  // null = list view; "new" = create flow; "fromCurrent" = seed from
  // doc preamble; string id = edit flow
  const [editor, setEditor] = useState<null | "new" | "fromCurrent" | string>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [docPreamble, setDocPreamble] = useState<string | null>(null);
  const [applyTarget, setApplyTarget] = useState<string | null>(null);

  // Load the doc's current preamble. Re-read whenever docId changes —
  // the user might have edited the preamble in code view between opens.
  // The async wrapper keeps all setState calls off the synchronous
  // effect path so React's set-state-in-effect linter stays happy.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!docId) {
        if (!cancelled) setDocPreamble(null);
        return;
      }
      try {
        const latex = await readTex(docId);
        if (cancelled) return;
        const d = extractPreambleAndPostamble(latex);
        setDocPreamble(d?.preamble ?? null);
      } catch {
        if (!cancelled) setDocPreamble(null);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [docId]);

  const pendingMerge = aiRequests.find(
    (r) => r.kind === "style-merge" && r.status === "submitted",
  );

  const activeStyle = styles.find((s) => s.id === styleId);
  const drifted =
    !!activeStyle &&
    docPreamble != null &&
    docPreamble !== activeStyle.preamble;
  const canSaveCurrent =
    !!docId &&
    docPreamble != null &&
    !!activeStyle &&
    docPreamble !== activeStyle.preamble;

  const editingEntry: StyleEntry | undefined =
    typeof editor === "string" && editor !== "new" && editor !== "fromCurrent"
      ? styles.find((s) => s.id === editor)
      : undefined;

  const startEdit = useCallback((id: string) => {
    setEditor(id);
  }, []);

  const startRename = useCallback((entry: StyleEntry) => {
    setRenamingId(entry.id);
    setRenameValue(entry.name);
  }, []);

  const commitRename = useCallback(
    (id: string) => {
      const trimmed = renameValue.trim();
      if (trimmed.length > 0) updateStyle(id, { name: trimmed });
      setRenamingId(null);
    },
    [renameValue, updateStyle],
  );

  const handleDelete = useCallback(
    (id: string) => {
      deleteStyle(id);
      setConfirmDeleteId(null);
    },
    [deleteStyle],
  );

  // Resolve the doc's current preamble synchronously if cached, else
  // fetch it from disk. Used by `apply` to decide drift before showing
  // the confirmation.
  const ensureDocPreamble = useCallback(async (): Promise<string> => {
    if (docPreamble != null) return docPreamble;
    if (!docId) return "";
    try {
      const latex = await readTex(docId);
      const d = extractPreambleAndPostamble(latex);
      const p = d?.preamble ?? "";
      setDocPreamble(p);
      return p;
    } catch {
      return "";
    }
  }, [docId, docPreamble]);

  const apply = useCallback(
    async (id: string) => {
      if (!docId) return;
      if (pendingMerge) return;
      if (id === styleId) return;
      const target = styles.find((s) => s.id === id);
      if (!target) return;
      const current = await ensureDocPreamble();
      const activeRegistered = activeStyle?.preamble ?? "";
      if (current === activeRegistered) {
        // No drift — silent apply.
        void setStyle(id);
      } else {
        setApplyTarget(id);
      }
    },
    [docId, pendingMerge, styleId, styles, ensureDocPreamble, activeStyle, setStyle],
  );

  const onApplyHard = useCallback(() => {
    if (!applyTarget) return;
    void setStyle(applyTarget);
    setApplyTarget(null);
  }, [applyTarget, setStyle]);

  const onApplyAi = useCallback(async () => {
    if (!applyTarget) return;
    const target = styles.find((s) => s.id === applyTarget);
    if (!target) {
      setApplyTarget(null);
      return;
    }
    const current = await ensureDocPreamble();
    addStyleMergeRequest({
      targetStyleId: target.id,
      targetStyleName: target.name,
      targetPreamble: target.preamble,
      currentPreamble: current,
    });
    setApplyTarget(null);
  }, [applyTarget, styles, ensureDocPreamble, addStyleMergeRequest]);

  const targetEntry = applyTarget
    ? styles.find((s) => s.id === applyTarget)
    : null;

  const showActiveColumn = !!docId;
  const gridTemplate = showActiveColumn
    ? "auto auto 1fr auto"
    : "auto 1fr auto";

  return (
    <>
      <SystemDialog open onClose={onClose} size="xl">
        <SystemDialogHeader
          title="Manage styles"
          subtitle={
            showActiveColumn
              ? "Apply a style to the current document, manage entries, or pick the default for new docs."
              : "Edit, rename, duplicate, or delete styles. Pick which one new documents start with."
          }
        />
        <SystemDialogBody className="pb-2">
          {pendingMerge && (
            <div className="mb-3 px-3 py-2 rounded-md border border-edge-subtle bg-surface-muted/60 text-xs text-ink-body">
              AI merge in progress for <strong>{activeStyle?.name ?? "current style"}</strong>. The
              doc&apos;s <code>.tex</code> stays untouched until the agent finishes.
            </div>
          )}
          <div className="border border-edge-subtle rounded-md overflow-hidden bg-surface">
            <div
              className="grid items-center gap-2 px-3 py-2 text-[10px] font-medium uppercase tracking-wide text-ink-subtle border-b border-edge-subtle bg-surface-muted/40"
              style={{ gridTemplateColumns: gridTemplate }}
            >
              <span title="Default style for new docs">Default</span>
              {showActiveColumn && <span title="Active style for the current doc">Active</span>}
              <span>Name</span>
              <span>Actions</span>
            </div>
            <div className="max-h-[55vh] overflow-y-auto">
              {styles.map((s) => {
                const isDefault = s.id === defaultStyleId;
                const isActive = showActiveColumn && s.id === styleId;
                const isRenaming = renamingId === s.id;
                const isOnlyOne = styles.length <= 1;
                return (
                  <div
                    key={s.id}
                    className="grid items-center gap-2 px-3 py-2 border-b border-edge-subtle/50 last:border-b-0"
                    style={{ gridTemplateColumns: gridTemplate }}
                  >
                    <input
                      type="radio"
                      name="default-style"
                      checked={isDefault}
                      onChange={() => setDefaultStyleId(s.id)}
                      title="Set as default for new docs"
                      className="cursor-pointer"
                    />
                    {showActiveColumn && (
                      <div className="flex items-center justify-center">
                        {isActive ? (
                          <span
                            className="inline-flex items-center gap-1 text-[var(--accent)]"
                            title={drifted ? "Active — preamble has drifted from this style" : "Active style for this doc"}
                          >
                            <span aria-hidden>✓</span>
                            {drifted && (
                              <span
                                aria-hidden
                                className="inline-block w-1.5 h-1.5 rounded-full bg-[var(--accent)]"
                              />
                            )}
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => void apply(s.id)}
                            disabled={!!pendingMerge}
                            className="text-[11px] px-2 py-1 hover:bg-surface-muted rounded disabled:opacity-40 disabled:cursor-not-allowed"
                            title={pendingMerge ? "AI merge in progress…" : "Apply this style to the current doc"}
                          >
                            Apply
                          </button>
                        )}
                      </div>
                    )}
                    <div className="flex items-center gap-2 min-w-0">
                      {isRenaming ? (
                        <input
                          autoFocus
                          type="text"
                          value={renameValue}
                          onChange={(e) => setRenameValue(e.target.value)}
                          onBlur={() => commitRename(s.id)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") commitRename(s.id);
                            else if (e.key === "Escape") setRenamingId(null);
                          }}
                          className="flex-1 px-2 py-1 text-sm bg-surface border border-edge-strong rounded focus:outline-none text-ink-body"
                        />
                      ) : (
                        <>
                          <span className="text-sm text-ink-body truncate">
                            {s.name}
                          </span>
                          {s.origin === "seed" && (
                            <span
                              title="Seeded on first launch — fully editable like any other style."
                              className="text-[9px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-surface-muted text-ink-subtle border border-edge-subtle/60"
                            >
                              seeded
                            </span>
                          )}
                        </>
                      )}
                    </div>
                    <div className="flex items-center gap-1 text-[11px]">
                      <button
                        type="button"
                        onClick={() => startEdit(s.id)}
                        className="px-2 py-1 hover:bg-surface-muted rounded"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => duplicateStyle(s.id)}
                        className="px-2 py-1 hover:bg-surface-muted rounded"
                      >
                        Duplicate
                      </button>
                      <button
                        type="button"
                        onClick={() => startRename(s)}
                        className="px-2 py-1 hover:bg-surface-muted rounded"
                      >
                        Rename
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteId(s.id)}
                        disabled={isOnlyOne}
                        title={
                          isOnlyOne
                            ? "Library must contain at least one style"
                            : undefined
                        }
                        className="px-2 py-1 hover:bg-surface-muted rounded text-[var(--danger,#b91c1c)] disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {confirmDeleteId && (
            <div className="mt-3 px-3 py-2 border border-edge-subtle rounded-md bg-surface-muted/40 flex items-center justify-between gap-3">
              <span className="text-xs text-ink-body">
                Delete <strong>{styles.find((s) => s.id === confirmDeleteId)?.name}</strong>? This can&apos;t be undone.
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setConfirmDeleteId(null)}
                  className="text-[11px] px-2 py-1 hover:bg-surface rounded"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => handleDelete(confirmDeleteId)}
                  className="text-[11px] px-2 py-1 rounded text-white bg-[var(--danger,#b91c1c)] hover:opacity-90"
                >
                  Delete
                </button>
              </div>
            </div>
          )}
        </SystemDialogBody>

        <SystemDialogFooter>
          <SystemDialogButton
            variant="secondary"
            onClick={() => setEditor("fromCurrent")}
            disabled={!canSaveCurrent}
            title={
              !docId
                ? "Open a document to save its preamble as a new style"
                : !canSaveCurrent
                ? "Current preamble matches the active style — nothing new to save"
                : undefined
            }
          >
            Save current as new…
          </SystemDialogButton>
          <SystemDialogButton
            variant="secondary"
            onClick={() => setEditor("new")}
          >
            + New style
          </SystemDialogButton>
          <SystemDialogButton variant="primary" onClick={onClose} autoFocus>
            Done
          </SystemDialogButton>
        </SystemDialogFooter>
      </SystemDialog>

      {targetEntry && docPreamble != null && (
        <StyleApplyDialog
          targetStyleName={targetEntry.name}
          currentPreamble={docPreamble}
          targetPreamble={targetEntry.preamble}
          onHard={onApplyHard}
          onAi={() => void onApplyAi()}
          onCancel={() => setApplyTarget(null)}
        />
      )}

      {editor === "new" && (
        <StyleEditorModal
          title="New style"
          subtitle="Define a new preamble. Available across all your documents."
          takenNames={styles.map((s) => s.name)}
          onSave={({ name, preamble }) => {
            addStyle({ name, preamble });
            setEditor(null);
          }}
          onCancel={() => setEditor(null)}
        />
      )}

      {editor === "fromCurrent" && docPreamble != null && (
        <StyleEditorModal
          title="Save current preamble as new style"
          subtitle="The current document's preamble is pre-filled below."
          initialPreamble={docPreamble}
          takenNames={styles.map((s) => s.name)}
          onSave={({ name, preamble }) => {
            addStyle({ name, preamble });
            setEditor(null);
          }}
          onCancel={() => setEditor(null)}
        />
      )}

      {editingEntry && (
        <StyleEditorModal
          title={`Edit "${editingEntry.name}"`}
          initialName={editingEntry.name}
          initialPreamble={editingEntry.preamble}
          takenNames={styles
            .filter((s) => s.id !== editingEntry.id)
            .map((s) => s.name)}
          onSave={({ name, preamble }) => {
            updateStyle(editingEntry.id, { name, preamble });
            setEditor(null);
          }}
          onCancel={() => setEditor(null)}
        />
      )}
    </>
  );
}
