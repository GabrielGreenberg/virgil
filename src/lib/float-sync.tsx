"use client";

/**
 * Bidirectional sync plumbing between a floating editor (the per-kind
 * bodies under `src/text-objects/floats/` — paragraph, heading, list,
 * tex-block, example-block, linked-range) and the main editor. Each
 * float owns its own Tiptap instance and a "source" in the main doc
 * (paragraph by uuid, section range by heading uuid, range tracked by
 * `linkedAnchor` mark, etc.).
 *
 * Sync model:
 *  - Float → main: caller does the write inside Tiptap's `onUpdate`. It
 *    must tag the transaction with `tr.setMeta(FLOAT_WRITE_META, floatId)`
 *    so this hook's main-listener skips its own echo.
 *  - Main → float: this hook subscribes to the main editor's transactions.
 *    For each transaction that wasn't ours, it calls `readSource(doc)`. If
 *    the source content differs from what's currently in the float, the
 *    float's content is replaced via `setContent(..., false)` (the false
 *    suppresses the float's `onUpdate`, breaking the feedback loop).
 *  - Stale source: when `readSource` reports `missing: true`, the hook
 *    flips `sourceMissing` on. If a later transaction makes the source
 *    available again (e.g. undo restored a deleted paragraph), the flag
 *    clears and sync resumes.
 *
 * Cursor preservation: the float's current selection {from, to} is
 * captured before `setContent` and re-applied clamped to the new doc
 * size. For single-paragraph floats this maps cleanly; for multi-block
 * floats (HeadingFloat) the cursor lands at the same absolute offset.
 */

import { useEffect, useState } from "react";
import type { Editor, JSONContent } from "@tiptap/react";

export type FloatSourceKind =
  | "paragraph"
  | "section"
  | "selection"
  | "list"
  | "example";

const KIND_LABEL: Record<FloatSourceKind, string> = {
  paragraph: "Source paragraph deleted",
  section: "Source section deleted",
  selection: "Source selection deleted",
  list: "Source list deleted",
  example: "Source example deleted",
};

/**
 * Strip rendered when the float's source no longer exists in the main
 * doc. Edits in the float won't propagate; closing the float drops it
 * cleanly. Lives across all three float types so the chrome stays
 * uniform.
 */
export function SourceMissingBanner({
  kind,
  onClose,
}: {
  kind: FloatSourceKind;
  onClose: () => void;
}) {
  return (
    <div
      role="status"
      className="flex items-center gap-2 px-2 h-6 text-[11px] bg-[var(--surface-warning,#fdf3d1)] border-b border-[var(--edge-warning,#e7d49a)] text-[var(--ink-warning,#7a5a16)]"
    >
      <span className="flex-1 truncate">
        {KIND_LABEL[kind]} — float is disconnected.
      </span>
      <button
        type="button"
        onClick={onClose}
        className="text-[11px] underline underline-offset-2 hover:opacity-80"
      >
        Close
      </button>
    </div>
  );
}

export const FLOAT_WRITE_META = "from-float";

export interface ReadSourceResult {
  /** The full doc the float should render. May be empty/placeholder when
   *  `missing` is true; callers usually ignore content in that case. */
  doc: JSONContent;
  /** True when the source UUID / range no longer resolves in main. */
  missing: boolean;
}

export interface UseFloatMainSyncArgs {
  mainEditor: Editor | null;
  floatEditor: Editor | null;
  /** Stable id used to tag transactions the caller dispatches into main,
   *  so this hook's listener can skip its own echoes. */
  floatId: string;
  /** Pure function reading from the main doc snapshot. Called for every
   *  main transaction that isn't this float's own write. */
  readSource: (doc: import("@tiptap/pm/model").Node) => ReadSourceResult;
}

export function useFloatMainSync({
  mainEditor,
  floatEditor,
  floatId,
  readSource,
}: UseFloatMainSyncArgs): { sourceMissing: boolean } {
  const [sourceMissing, setSourceMissing] = useState(false);

  useEffect(() => {
    if (!mainEditor || !floatEditor) return;

    // Seed once on attach: cover the case where main was edited while the
    // float was unmounted, or where the float seeded from a stale value.
    syncFromMain(mainEditor, floatEditor, readSource, setSourceMissing);

    const handler = ({
      transaction,
    }: {
      transaction: import("@tiptap/pm/state").Transaction;
    }) => {
      if (transaction.getMeta(FLOAT_WRITE_META) === floatId) return;
      if (!transaction.docChanged) return;
      syncFromMain(mainEditor, floatEditor, readSource, setSourceMissing);
    };

    mainEditor.on("transaction", handler);
    return () => {
      mainEditor.off("transaction", handler);
    };
  }, [mainEditor, floatEditor, floatId, readSource]);

  return { sourceMissing };
}

function syncFromMain(
  mainEditor: Editor,
  floatEditor: Editor,
  readSource: UseFloatMainSyncArgs["readSource"],
  setSourceMissing: (v: boolean) => void,
): void {
  const { doc, missing } = readSource(mainEditor.state.doc);
  if (missing) {
    setSourceMissing(true);
    return;
  }
  setSourceMissing(false);
  if (sameDoc(doc, floatEditor.getJSON())) return;

  const { from, to } = floatEditor.state.selection;
  floatEditor.commands.setContent(doc, { emitUpdate: false });
  const size = floatEditor.state.doc.content.size;
  const safeFrom = Math.min(Math.max(from, 0), size);
  const safeTo = Math.min(Math.max(to, 0), size);
  try {
    floatEditor.commands.setTextSelection({ from: safeFrom, to: safeTo });
  } catch {
    /* selection target may not be a valid text position post-reset; OK */
  }
}

function sameDoc(a: JSONContent, b: JSONContent): boolean {
  // Cheap structural equality. Both are TipTap JSON trees — small enough
  // that JSON.stringify is fine, and stable key ordering is preserved
  // because both come from the same node.toJSON / editor.getJSON path.
  return JSON.stringify(a) === JSON.stringify(b);
}
