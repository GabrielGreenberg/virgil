"use client";

/**
 * ManageStylesModal — list view for the user's style library. Surfaces
 * the per-row CRUD affordances (Edit, Duplicate, Rename, Delete) and a
 * radio that picks the default style for new docs. Stacks above
 * StyleEditorModal when "Edit" or "+ New" is clicked.
 */

import { useCallback, useState } from "react";
import SystemDialog, {
  SystemDialogBody,
  SystemDialogButton,
  SystemDialogFooter,
  SystemDialogHeader,
} from "./system-dialog";
import StyleEditorModal from "./StyleEditorModal";
import type { StyleEntry } from "@/lib/document-styles";
import { useStyleLibrary } from "@/hooks/useStyleLibrary";

interface ManageStylesModalProps {
  onClose: () => void;
}

export default function ManageStylesModal({ onClose }: ManageStylesModalProps) {
  const {
    styles,
    defaultStyleId,
    addStyle,
    updateStyle,
    deleteStyle,
    duplicateStyle,
    setDefaultStyleId,
  } = useStyleLibrary();

  // null = list view; "new" = create flow; string id = edit flow
  const [editor, setEditor] = useState<null | "new" | string>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const editingEntry: StyleEntry | undefined =
    typeof editor === "string" && editor !== "new"
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

  return (
    <>
      <SystemDialog open onClose={onClose} size="xl">
        <SystemDialogHeader
          title="Manage styles"
          subtitle="Edit, rename, duplicate, or delete styles. Pick which one new documents start with."
        />
        <SystemDialogBody className="pb-2">
          <div className="border border-edge-subtle rounded-md overflow-hidden bg-surface">
            <div
              className="grid items-center gap-2 px-3 py-2 text-[10px] font-medium uppercase tracking-wide text-ink-subtle border-b border-edge-subtle bg-surface-muted/40"
              style={{ gridTemplateColumns: "auto 1fr auto" }}
            >
              <span title="Default style for new docs">Default</span>
              <span>Name</span>
              <span>Actions</span>
            </div>
            <div className="max-h-[55vh] overflow-y-auto">
              {styles.map((s) => {
                const isDefault = s.id === defaultStyleId;
                const isRenaming = renamingId === s.id;
                const isOnlyOne = styles.length <= 1;
                return (
                  <div
                    key={s.id}
                    className="grid items-center gap-2 px-3 py-2 border-b border-edge-subtle/50 last:border-b-0"
                    style={{ gridTemplateColumns: "auto 1fr auto" }}
                  >
                    <input
                      type="radio"
                      name="default-style"
                      checked={isDefault}
                      onChange={() => setDefaultStyleId(s.id)}
                      title="Set as default for new docs"
                      className="cursor-pointer"
                    />
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
                Delete <strong>{styles.find((s) => s.id === confirmDeleteId)?.name}</strong>? This can't be undone.
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
            onClick={() => setEditor("new")}
          >
            + New style
          </SystemDialogButton>
          <SystemDialogButton variant="primary" onClick={onClose} autoFocus>
            Done
          </SystemDialogButton>
        </SystemDialogFooter>
      </SystemDialog>

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
