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
 *    For each transaction that wasn't ours AND that actually touched this
 *    float's source region, it calls `readSource(doc, hint)`. If the source
 *    content differs from what's currently in the float, the float's content
 *    is replaced via `setContent(..., false)` (the false suppresses the
 *    float's `onUpdate`, breaking the feedback loop).
 *  - Stale source: when `readSource` reports `missing: true`, the hook
 *    flips `sourceMissing` on. If a later transaction makes the source
 *    available again (e.g. undo restored a deleted paragraph), the flag
 *    clears and sync resumes.
 *
 * Source-touch gate (task 140 — the keystroke-sanctity half): `readSource` is
 * O(doc) in every body, so calling it for EVERY docChanged transaction made
 * each main-editor keystroke cost a full-document walk PER OPEN FLOAT. A body
 * that reports its source's `range` gets that walk gated behind
 * `trackSourceRange` — one O(steps) pass that maps the range forward and asks
 * whether any step intersected it. Typing anywhere but inside the mirrored
 * region now costs a few integer comparisons per float; the same live range
 * then rides back INTO `readSource` as a position hint, so even the touching
 * keystroke resolves its source in O(depth) instead of walking. A body that
 * reports no range keeps the old always-read behavior — the gate is opt-in and
 * fails safe.
 *
 * Cursor preservation: the float's current selection {from, to} is
 * captured before `setContent` and MAPPED through the structural diff
 * (old↔new) via `reseedPreservingCaret`, so a foreign main edit upstream
 * of the caret shifts the caret with its logical text rather than leaving
 * it at a stale raw offset (EX-F8-02 class).
 */

import { type RefObject, useCallback, useEffect, useRef, useState } from "react";
import type { Editor, JSONContent } from "@tiptap/react";
import { reseedPreservingCaret } from "@/lib/reseed-caret";
import { trackSourceRange, type SourceRange } from "@/lib/float-source-range";

export type { SourceRange };

/**
 * Kinds the source-missing banner can describe. Roughly tracks
 * `TextObjectKind` but intentionally collapses the persistent-node
 * variants into a small label set — "Source paragraph deleted",
 * "Source list deleted", etc. — since the banner is for the user and
 * doesn't need to distinguish bulletList vs orderedList (both →
 * "Source list deleted"). Block kinds that read distinctly to the user
 * (blockquote, codeBlock) get their own label. Add a new entry here when
 * a new TextObject kind ships a float body that this banner could surface.
 */
export type FloatSourceKind =
  | "paragraph"
  | "section"
  | "list"
  | "example"
  | "linkedRange"
  | "texBlock"
  | "blockquote"
  | "codeBlock"
  | "displayMath"
  | "latexComment"
  | "titleField"
  | "listItem"
  | "exampleItem"
  | "figureBlock"
  | "graphicsBlock";

const KIND_LABEL: Record<FloatSourceKind, string> = {
  paragraph: "Source paragraph deleted",
  section: "Source section deleted",
  list: "Source list deleted",
  example: "Source example deleted",
  linkedRange: "Linked range deleted",
  texBlock: "Source TeX block deleted",
  blockquote: "Source quote deleted",
  codeBlock: "Source code block deleted",
  displayMath: "Source equation deleted",
  latexComment: "Source comment deleted",
  titleField: "Source title field deleted",
  listItem: "Source list item deleted",
  exampleItem: "Source example item deleted",
  figureBlock: "Source figure deleted",
  graphicsBlock: "Source graphic deleted",
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

export interface UseMainTransactionSyncArgs {
  mainEditor: Editor | null;
  /** Stable id used to tag transactions the caller dispatches into main,
   *  so this hook's listener can skip its own echoes. */
  floatId: string;
  /** Called once on attach (seed) and again after every main transaction
   *  that isn't this float's own write-back, actually changed the doc, AND
   *  touched this float's source region (see `sourceRangeRef`). Selection-only
   *  transactions never reach it. */
  onMainDocChanged: () => void;
  /** The float's LIVE source region in the main doc — the gate's input and
   *  output. The hook maps it forward through every docChanged transaction
   *  (including this float's own write-backs, which move it too) and, when it
   *  holds a range, skips `onMainDocChanged` for transactions whose steps
   *  didn't intersect it.
   *
   *  `null` means "position unknown" — the source is missing, or the body
   *  doesn't report a range — and disables the gate (every docChanged
   *  transaction fires, the pre-task-140 behavior). That fail-safe default is
   *  load-bearing for the missing case: a float whose source was deleted must
   *  keep re-reading so an undo that restores it is noticed. */
  sourceRangeRef?: RefObject<SourceRange | null>;
}

/**
 * Low-level main→float subscription shared by every float body. Owns the
 * three gates the keystroke-sanctity rule (AGENTS.md) requires of any
 * main-editor transaction listener whose callback does O(doc) work: the
 * own-write `FLOAT_WRITE_META` filter, the `docChanged` gate, and the
 * source-touch gate that keeps the O(doc) callback off the keystroke path
 * entirely (task 140).
 *
 * `useFloatMainSync` layers the TipTap-on-TipTap doc replacement on top;
 * non-TipTap bodies (tex-block-body's CodeMirror-over-string-attr) consume
 * this directly instead of hand-rolling the subscription — hand-rolled
 * copies are how a gate gets forgotten.
 */
export function useMainTransactionSync({
  mainEditor,
  floatId,
  onMainDocChanged,
  sourceRangeRef,
}: UseMainTransactionSyncArgs): void {
  useEffect(() => {
    if (!mainEditor) return;

    // Seed once on attach: cover the case where main was edited while the
    // float was unmounted, or where the float seeded from a stale value. This
    // is also what primes `sourceRangeRef` — until it runs the gate is open.
    onMainDocChanged();

    const handler = ({
      transaction,
      appendedTransactions,
    }: {
      transaction: import("@tiptap/pm/state").Transaction;
      appendedTransactions?: import("@tiptap/pm/state").Transaction[];
    }) => {
      // The APPENDED transactions matter as much as the root one. TipTap emits
      // this event once per dispatch, carrying the root transaction plus
      // whatever the `appendTransaction` plugins produced (uuid backfill,
      // footnote/example renumbering, structural guards) — and those land in
      // the state too. Reading only `transaction` would leave the tracked range
      // un-mapped for their steps, which is how a gate goes silently stale. The
      // old always-re-read code was immune to this only because it never
      // tracked anything.
      const all = appendedTransactions?.length
        ? [transaction, ...appendedTransactions]
        : [transaction];

      // Track the source region FIRST, and across every docChanged transaction
      // here — including this float's own write-back and ones we go on to skip.
      let docChanged = false;
      let touched = false;
      let range = sourceRangeRef?.current ?? null;
      for (const tr of all) {
        if (!tr.docChanged) continue;
        docChanged = true;
        if (!range) {
          // No known region — the gate is open by design (see `sourceRangeRef`).
          touched = true;
          continue;
        }
        const tracked = trackSourceRange(tr, range);
        range = tracked.mapped;
        if (tracked.touched) touched = true;
      }
      if (sourceRangeRef) sourceRangeRef.current = range;

      if (!docChanged) return;
      if (transaction.getMeta(FLOAT_WRITE_META) === floatId) return;
      if (!touched) return;
      onMainDocChanged();
    };

    mainEditor.on("transaction", handler);
    return () => {
      mainEditor.off("transaction", handler);
    };
  }, [mainEditor, floatId, onMainDocChanged, sourceRangeRef]);
}

export interface ReadSourceResult {
  /** The full doc the float should render. May be empty/placeholder when
   *  `missing` is true; callers usually ignore content in that case. */
  doc: JSONContent;
  /** True when the source UUID / range no longer resolves in main. */
  missing: boolean;
  /** Where the source sits in the main doc RIGHT NOW — the node range for a
   *  single-node body, the whole section for a heading, the marked run for a
   *  linked range. Reporting it opts this float into the source-touch gate
   *  (task 140) and, on the next read, into the position-hint fast path.
   *  Omit (or `null`) to keep the ungated read-on-every-transaction behavior. */
  range?: SourceRange | null;
}

export interface UseFloatMainSyncArgs {
  mainEditor: Editor | null;
  floatEditor: Editor | null;
  /** Stable id used to tag transactions the caller dispatches into main,
   *  so this hook's listener can skip its own echoes. */
  floatId: string;
  /** Pure function reading from the main doc snapshot. Called for every main
   *  transaction that isn't this float's own write AND touched the source.
   *
   *  `hint` is the float's live source range, mapped forward from the last
   *  read — a body should use it to resolve its source without walking the
   *  doc, and MUST verify what it finds there (identity + extent) before
   *  trusting it. It is `null` on the seed read and whenever the source's
   *  position is unknown. */
  readSource: (
    doc: import("@tiptap/pm/model").Node,
    hint: SourceRange | null,
  ) => ReadSourceResult;
}

export function useFloatMainSync({
  mainEditor,
  floatEditor,
  floatId,
  readSource,
}: UseFloatMainSyncArgs): {
  sourceMissing: boolean;
  /** The float's live source range in main — mapped through every transaction
   *  by `useMainTransactionSync`. Bodies pass it as the position hint for
   *  their float→main write-back, so that direction stops walking the doc on
   *  every float keystroke too. Read-only for callers; a `ref` (not state) so
   *  tracking it never re-renders. */
  sourceRangeRef: RefObject<SourceRange | null>;
} {
  const [sourceMissing, setSourceMissing] = useState(false);
  const sourceRangeRef = useRef<SourceRange | null>(null);

  const onMainDocChanged = useCallback(() => {
    if (!mainEditor || !floatEditor) return;
    syncFromMain(
      mainEditor,
      floatEditor,
      readSource,
      setSourceMissing,
      sourceRangeRef,
    );
  }, [mainEditor, floatEditor, readSource]);

  useMainTransactionSync({
    // Subscribe (and seed) only once both editors exist — the seed call
    // must be able to write into the float.
    mainEditor: floatEditor ? mainEditor : null,
    floatId,
    onMainDocChanged,
    sourceRangeRef,
  });

  return { sourceMissing, sourceRangeRef };
}

function syncFromMain(
  mainEditor: Editor,
  floatEditor: Editor,
  readSource: UseFloatMainSyncArgs["readSource"],
  setSourceMissing: (v: boolean) => void,
  sourceRangeRef: RefObject<SourceRange | null>,
): void {
  const { doc, missing, range } = readSource(
    mainEditor.state.doc,
    sourceRangeRef.current,
  );
  // Re-arm the gate from the read we just did. A missing source (or a body
  // that reports no range) parks it at null, which OPENS the gate — exactly
  // what a disconnected float needs so an undo that restores its source is
  // seen.
  sourceRangeRef.current = missing ? null : (range ?? null);
  if (missing) {
    setSourceMissing(true);
    return;
  }
  setSourceMissing(false);
  if (sameDoc(doc, floatEditor.getJSON())) return;

  // Caret restore mapped through the structural change (EX-F8-02 class): a
  // foreign main edit upstream of the float's caret shifts the content, so the
  // raw {from,to} offset would land the caret earlier than its logical
  // position. `reseedPreservingCaret` diffs old↔new and maps the caret through
  // the edit — the shared single owner with ExampleCard's re-seed.
  reseedPreservingCaret(floatEditor, doc);
}

function sameDoc(a: JSONContent, b: JSONContent): boolean {
  // Cheap structural equality. Both are TipTap JSON trees — small enough
  // that JSON.stringify is fine, and stable key ordering is preserved
  // because both come from the same node.toJSON / editor.getJSON path.
  return JSON.stringify(a) === JSON.stringify(b);
}
