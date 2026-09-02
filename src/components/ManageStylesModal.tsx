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
import { Input, Select } from "./field-primitives";
import StyleApplyDialog from "./StyleApplyDialog";
import DocTypeChangeDialog from "./DocTypeChangeDialog";
import type { StyleEntry } from "@/lib/document-styles";
import type { AiRequest } from "@/lib/types";
import type { SectioningCommand } from "@/lib/document-class";
import { useStyleLibrary } from "@/hooks/useStyleLibrary";
import { useDocumentStyle } from "@/hooks/useDocumentStyle";
import { drainDoc, readTex } from "@/lib/storage";
import { extractPreambleAndPostamble } from "@/lib/latex-parser";
import { stripAutoInjectedLines } from "@/lib/latex-requirements";
import {
  extractDocumentClass,
  rewriteDocumentClass,
  unsupportedSectioningFor,
} from "@/lib/document-class";
import { DOC_TYPES } from "@/lib/doc-types";

/**
 * The distinct `\documentclass` names offered by the doc-type control,
 * sourced from the `DOC_TYPES` SSOT and de-duplicated by class (blank and
 * article both map to `article`, so the change control — which only swaps the
 * class — lists `article` once). Labels are the class name title-cased.
 */
const DOC_CLASS_CHOICES: { className: string; label: string }[] = (() => {
  const seen = new Set<string>();
  const out: { className: string; label: string }[] = [];
  for (const dt of DOC_TYPES) {
    if (seen.has(dt.documentClass)) continue;
    seen.add(dt.documentClass);
    out.push({
      className: dt.documentClass,
      label: dt.documentClass.charAt(0).toUpperCase() + dt.documentClass.slice(1),
    });
  }
  return out;
})();

/** Drift compare on normalized forms — the serializer auto-injects
 *  requirement lines (packages + `\v*id` shims) into the doc's preamble,
 *  which must not read as user drift against the registered style. */
function preamblesDiffer(a: string, b: string): boolean {
  return stripAutoInjectedLines(a) !== stripAutoInjectedLines(b);
}

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
  const { styleId, setStyle, setDocumentClass } = useDocumentStyle(docId);

  // null = list view; "new" = create flow; "fromCurrent" = seed from
  // doc preamble; string id = edit flow
  const [editor, setEditor] = useState<null | "new" | "fromCurrent" | string>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [docPreamble, setDocPreamble] = useState<string | null>(null);
  const [applyTarget, setApplyTarget] = useState<string | null>(null);
  // The doc's current `\documentclass` name — derived from the loaded
  // preamble, and updated locally on a swap so the control reflects the new
  // class without a disk re-read. null when there's no document open or no
  // live `\documentclass` to swap (the control is then hidden).
  const [currentClass, setCurrentClass] = useState<string | null>(null);
  // The structural-downgrade confirmation (target class + the commands it
  // would drop). null = no prompt open.
  const [docTypeDowngrade, setDocTypeDowngrade] = useState<{
    targetClass: string;
    offenders: SectioningCommand[];
  } | null>(null);

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

  // Track the doc's current `\documentclass` off the loaded preamble (the
  // class line lives in the preamble). Recomputes whenever the preamble is
  // (re)loaded for a new doc; a swap updates it locally below.
  useEffect(() => {
    setCurrentClass(
      docPreamble != null
        ? extractDocumentClass(docPreamble)?.className ?? null
        : null,
    );
  }, [docPreamble]);

  const pendingMerge = aiRequests.find(
    (r) => r.kind === "style-merge" && r.status === "submitted",
  );

  const activeStyle = styles.find((s) => s.id === styleId);
  const drifted =
    !!activeStyle &&
    docPreamble != null &&
    preamblesDiffer(docPreamble, activeStyle.preamble);
  const canSaveCurrent =
    !!docId &&
    docPreamble != null &&
    !!activeStyle &&
    preamblesDiffer(docPreamble, activeStyle.preamble);

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
      if (!preamblesDiffer(current, activeRegistered)) {
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

  // Reflect a just-applied class swap in local state without a disk re-read:
  // bump the tracked class and rewrite the cached preamble's class line so the
  // style-drift indicator (which compares against the active style's preamble)
  // stays accurate.
  const applyClassLocally = useCallback((targetClass: string) => {
    setCurrentClass(targetClass);
    setDocPreamble((p) => (p != null ? rewriteDocumentClass(p, targetClass) : p));
  }, []);

  // The doc-type control's gate. A class swap is byte-mechanical
  // (`rewriteDocumentClass`), but its SAFETY depends on sectioning: if the
  // target class supports every command the body uses (any upgrade, or a
  // lateral swap) it applies as a silent, instant hard swap; if it would drop
  // a command the body relies on (the structural-downgrade case) it routes to
  // the restructuring prompt instead of silently producing a non-compiling doc.
  const changeDocType = useCallback(
    async (targetClass: string) => {
      if (!docId || pendingMerge) return;
      if (!currentClass || targetClass === currentClass) return;
      let latex: string;
      try {
        // Flush the autosave/code-pane debounce first so the gate sees the
        // LIVE body — otherwise a just-typed `\chapter` could still be in the
        // 1500 ms window, the gate would read stale disk bytes, decide "hard",
        // and silently produce the very non-compiling doc it exists to prevent.
        await drainDoc(docId);
        latex = await readTex(docId);
      } catch {
        return;
      }
      const offenders = unsupportedSectioningFor(latex, targetClass);
      if (offenders.length === 0) {
        await setDocumentClass(targetClass);
        applyClassLocally(targetClass);
      } else {
        setDocTypeDowngrade({ targetClass, offenders });
      }
    },
    [docId, pendingMerge, currentClass, setDocumentClass, applyClassLocally],
  );

  const confirmDocTypeDowngrade = useCallback(async () => {
    if (!docTypeDowngrade) return;
    const { targetClass } = docTypeDowngrade;
    setDocTypeDowngrade(null);
    await setDocumentClass(targetClass);
    applyClassLocally(targetClass);
  }, [docTypeDowngrade, setDocumentClass, applyClassLocally]);

  // The class options shown in the control. If the doc's current class isn't
  // one of the SSOT choices (a custom journal .cls), surface it as a leading
  // read-only-ish option so the select isn't blank — the user can still swap
  // AWAY from it to a known class.
  const classChoices =
    currentClass && !DOC_CLASS_CHOICES.some((c) => c.className === currentClass)
      ? [{ className: currentClass, label: `${currentClass} (current)` }, ...DOC_CLASS_CHOICES]
      : DOC_CLASS_CHOICES;

  const targetEntry = applyTarget
    ? styles.find((s) => s.id === applyTarget)
    : null;

  const showActiveColumn = !!docId;
  const gridTemplate = showActiveColumn
    ? "auto auto 1fr auto"
    : "auto 1fr auto";

  return (
    <>
      <SystemDialog
        open
        onClose={onClose}
        size="xl"
        /* A dismissal is FREE: the only draft in this dialog's OWN body is the
           inline style-rename field, which commits on Enter or on blur — so a
           close loses at most an uncommitted style NAME. The nested
           `StyleEditorModal` below is a separate dialog and carries its own
           `dismissGuard`. */
        dismissIsFree
      >
        <SystemDialogHeader
          title="Manage styles"
          subtitle={
            showActiveColumn
              ? "Apply a style to the current document, manage entries, or pick the default for new docs."
              : "Edit, rename, duplicate, or delete styles. Pick which one new documents start with."
          }
        />
        <SystemDialogBody className="pb-2">
          {/* ── Document type ──────────────────────────────────────────
              Swaps the doc's `\documentclass` in place (options preserved).
              Instant/hard when the target class supports every sectioning
              command the body uses (any upgrade, e.g. article→book); routes to
              a restructuring prompt when it would drop one the body relies on
              (e.g. book→article with `\chapter`s). Only shown with a doc open
              that has a live `\documentclass`. */}
          {showActiveColumn && currentClass && (
            <div className="mb-3 flex items-center gap-2">
              <label
                htmlFor="doc-type-select"
                className="text-[11px] font-medium uppercase tracking-wide text-ink-subtle shrink-0"
                data-hint="Swap the document class — instant unless the doc uses chapters a smaller class can't hold"
              >
                Document type
              </label>
              <Select
                id="doc-type-select"
                value={currentClass}
                disabled={!!pendingMerge}
                onChange={(e) => void changeDocType(e.target.value)}
                className="text-xs px-2 py-1"
              >
                {classChoices.map((c) => (
                  <option key={c.className} value={c.className}>
                    {c.label}
                  </option>
                ))}
              </Select>
              <span className="text-[11px] text-ink-subtle">
                Changes <code className="font-mono">\documentclass</code>.
              </span>
            </div>
          )}
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
              <span data-hint="Default style for new docs">Default</span>
              {showActiveColumn && <span data-hint="Active style for the current doc">Active</span>}
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
                      data-hint="Set as default for new docs"
                      className="cursor-pointer"
                    />
                    {showActiveColumn && (
                      <div className="flex items-center justify-center">
                        {isActive ? (
                          <span
                            className="inline-flex items-center gap-1 text-[var(--accent)]"
                            data-hint={drifted ? "Active — preamble has drifted from this style" : "Active style for this doc"} aria-label={drifted ? "Active — preamble has drifted from this style" : "Active style for this doc"}
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
                            className="text-[11px] px-2 py-1 hover-on-light rounded disabled:opacity-40 disabled:cursor-not-allowed"
                            data-hint={pendingMerge ? "AI merge in progress…" : "Apply this style to the current doc"}
                          >
                            Apply
                          </button>
                        )}
                      </div>
                    )}
                    <div className="flex items-center gap-2 min-w-0">
                      {isRenaming ? (
                        <Input
                          autoFocus
                          value={renameValue}
                          onChange={(e) => setRenameValue(e.target.value)}
                          onBlur={() => commitRename(s.id)}
                          onKeyDown={(e) => {
                            // preventDefault is load-bearing, not decoration: it
                            // is how an in-dialog control tells the shell "this
                            // Enter is MINE". Without it the shell would fall
                            // through to the cued default ("Done") and a rename
                            // would close the whole modal.
                            if (e.key === "Enter") {
                              e.preventDefault();
                              commitRename(s.id);
                            } else if (e.key === "Escape") {
                              setRenamingId(null);
                            }
                          }}
                          className="flex-1 px-2 py-1 text-sm"
                        />
                      ) : (
                        <>
                          <span className="text-sm text-ink-body truncate">
                            {s.name}
                          </span>
                          {s.origin === "seed" && (
                            <span
                              data-hint="Seeded on first launch — fully editable like any other style."
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
                        className="px-2 py-1 hover-on-light rounded"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => duplicateStyle(s.id)}
                        className="px-2 py-1 hover-on-light rounded"
                      >
                        Duplicate
                      </button>
                      <button
                        type="button"
                        onClick={() => startRename(s)}
                        className="px-2 py-1 hover-on-light rounded"
                      >
                        Rename
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteId(s.id)}
                        disabled={isOnlyOne}
                        data-hint={
                          isOnlyOne
                            ? "Library must contain at least one style"
                            : undefined
                        }
                        className="px-2 py-1 hover-on-light rounded text-[var(--danger)] disabled:opacity-40 disabled:cursor-not-allowed"
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
                <SystemDialogButton
                  variant="secondary"
                  onClick={() => setConfirmDeleteId(null)}
                >
                  Cancel
                </SystemDialogButton>
                <SystemDialogButton
                  variant="danger"
                  onClick={() => handleDelete(confirmDeleteId)}
                >
                  Delete
                </SystemDialogButton>
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

      {docTypeDowngrade && (
        <DocTypeChangeDialog
          targetClass={docTypeDowngrade.targetClass}
          offenders={docTypeDowngrade.offenders}
          onChangeAnyway={() => void confirmDocTypeDowngrade()}
          onCancel={() => setDocTypeDowngrade(null)}
        />
      )}

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
