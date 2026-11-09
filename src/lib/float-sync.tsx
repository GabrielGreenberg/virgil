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
 *    is replaced through the re-seed door (`reseedPreservingCaret`), which
 *    suppresses the float's `onUpdate` (breaking the feedback loop) and keeps
 *    the foreign content out of the float's undo history (task 1398).
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

import {
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import type { Editor, JSONContent } from "@tiptap/react";
import { reseedPreservingCaret } from "@/lib/reseed-caret";
import { useReportFloatSourceMissing } from "@/floats/float-source-report";
import { trackSourceRange, type SourceRange } from "@/lib/float-source-range";
import { nextWriteRefusal, type FloatWriteOutcome } from "@/lib/float-write-back";
import { InlineError } from "@/components/InlineError";
import { useMainEditable } from "@/components/editor-layout/contexts/use-main-editable";

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
  | "forestBlock"
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
  forestBlock: "Source tree deleted",
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
 *
 * It is ALSO the report (task 435): mounted iff the user is being told the
 * source is gone, it declares that fact up to the enclosing `FloatWindow`,
 * which withdraws the jump chevron for as long as the banner stands. Binding
 * the two to one mount is what makes the header and the body agree
 * structurally rather than by two call sites staying in step — see
 * `floats/float-source-report.tsx` for the whole argument. A banner rendered
 * outside a float resolves no channel and the hook is inert.
 */
export function SourceMissingBanner({
  kind,
  onClose,
}: {
  kind: FloatSourceKind;
  onClose: () => void;
}) {
  useReportFloatSourceMissing();
  return (
    <FloatStatusStrip
      action={
        <button
          type="button"
          onClick={onClose}
          className="text-2xs underline underline-offset-2 hover:opacity-80"
        >
          Close
        </button>
      }
    >
      {KIND_LABEL[kind]} — float is disconnected.
    </FloatStatusStrip>
  );
}

/**
 * The ONE amber strip a float body states a STANDING condition through —
 * the float is showing something it cannot write back (its source is gone:
 * `SourceMissingBanner`; its range holds what it cannot represent:
 * linked-range-body's refusal notice). One primitive so a retone reaches
 * every such strip at once (task 1346 — linked-range's strip used to be a
 * byte copy of this class string). A one-off REFUSED write is a different
 * fact with its own voice: `WriteRefusedBanner`.
 */
export function FloatStatusStrip({
  children,
  action,
}: {
  children: ReactNode;
  /** Trailing control (e.g. the source-missing "Close"). */
  action?: ReactNode;
}) {
  return (
    <div
      role="status"
      className="flex items-center gap-2 px-2 h-6 text-2xs bg-[var(--surface-warning,#fdf3d1)] border-b border-[var(--edge-warning,#e7d49a)] text-[var(--ink-warning,#7a5a16)]"
    >
      <span className="flex-1 truncate">{children}</span>
      {action}
    </div>
  );
}

export const FLOAT_WRITE_META = "from-float";

/**
 * Strip rendered when this float's last write-back was REFUSED (task 1170) —
 * the edit has no faithful representation in main, so main kept what it had.
 * The float-side twin of the Example card's EX-F5-03 banner: a refusal is
 * never silent. Cleared by the next write that lands, or by a re-seed from
 * main (which replaces the refused content with what the paper holds).
 */
export function WriteRefusedBanner({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <InlineError className="px-2 py-1 border-b border-[var(--edge-warning,#e7d49a)]">
      {message}
    </InlineError>
  );
}

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
  /** The span of main this float's OWN last write-back now occupies (task
   *  1399) — the float's write TARGET while it still holds more than its
   *  source's identity spans. Set from the own write's step maps, mapped
   *  forward through every later transaction, and cleared by every re-read
   *  (`useFloatMainSync`'s `syncFromMain`), because a re-read re-seeds the
   *  float from the identity's own extent. A foreign transaction touching it
   *  forces that re-read even when `sourceRangeRef` would not. */
  writtenRangeRef?: RefObject<SourceRange | null>;
}

/**
 * The extent an own write-back occupies in the doc it produced: the union of
 * its steps' NEW ranges, each mapped through the steps after it. O(steps).
 * Null when the transaction moved nothing (a pure attr/mark step).
 */
export function writtenSpanOf(
  tr: import("@tiptap/pm/state").Transaction,
): SourceRange | null {
  const { maps } = tr.mapping;
  let from = Infinity;
  let to = -Infinity;
  for (let i = 0; i < maps.length; i++) {
    maps[i].forEach((_oldStart, _oldEnd, newStart, newEnd) => {
      let a = newStart;
      let b = newEnd;
      for (let j = i + 1; j < maps.length; j++) {
        a = maps[j].map(a, 1);
        b = maps[j].map(b, -1);
      }
      if (a < from) from = a;
      if (b > to) to = b;
    });
  }
  return from <= to ? { from, to } : null;
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
  writtenRangeRef,
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

      // The echo to ignore is our OWN write — not what the document's plugins
      // then did on top of it. An appended transaction that reshaped our write
      // (a uuid re-mint on a split-off sibling, a renumber, the latexComment
      // normalizer replacing the block outright) left the source different from
      // what the float believes it wrote, so that one must re-read. Re-reading
      // there cannot loop: the reseed is stamped `preventUpdate` (the re-seed
      // door), so it never provokes another write-back.
      const ownWrite = transaction.getMeta(FLOAT_WRITE_META) === floatId;

      // Track the source region FIRST, and across every docChanged transaction
      // here — including our own write and ones we go on to skip.
      let docChanged = false;
      let touchedByOthers = false;
      let range = sourceRangeRef?.current ?? null;
      let written = writtenRangeRef?.current ?? null;
      for (let i = 0; i < all.length; i++) {
        const tr = all[i];
        if (!tr.docChanged) continue;
        docChanged = true;
        const ours = ownWrite && i === 0;
        // The float's write target (task 1399): our own write REPLACES it with
        // the span that write now occupies; every other transaction maps it,
        // and one that touches it is a foreign edit to content this float holds.
        if (ours) {
          written = writtenSpanOf(tr);
        } else if (written) {
          const w = trackSourceRange(tr, written);
          written = w.mapped;
          if (w.touched) touchedByOthers = true;
        }
        if (!range) {
          // No known region — the gate is open by design (see `sourceRangeRef`).
          if (!ours) touchedByOthers = true;
          continue;
        }
        const tracked = trackSourceRange(tr, range);
        range = tracked.mapped;
        if (tracked.touched && !ours) touchedByOthers = true;
      }
      if (sourceRangeRef) sourceRangeRef.current = range;
      if (writtenRangeRef) writtenRangeRef.current = written;

      if (!docChanged) return;
      if (!touchedByOthers) return;
      onMainDocChanged();
    };

    mainEditor.on("transaction", handler);
    return () => {
      mainEditor.off("transaction", handler);
    };
  }, [mainEditor, floatId, onMainDocChanged, sourceRangeRef, writtenRangeRef]);
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

/**
 * THE float editability gate (task 1546) — the ONE answer every float body
 * mounts its editor with and `useFloatMainSync` keeps it at.
 *
 * A float's edits land in MAIN, and main refuses every doc-changing write
 * while it is read-only (`readOnlyEnforcer.filterTransaction` — silently: main
 * pins `view.editable` true so the grab handle can still LIFT text out of a
 * Reader). So a float that accepted typing on a read-only paper accepted text
 * that could never land, and the next main→float re-read wiped it. The live
 * half is `useMainEditable` (main's declarative `data-editable`, which follows
 * a mid-session flip — pen handed to a partner, file turned read-only); the
 * static half is the body's own reason to be read-only (a Reader chrome
 * preset, a display-math float, a linked range the popout cannot represent).
 *
 * Which modules must take it is `float-editable-gate-census.test.ts`.
 */
export function useFloatEditable(
  mainEditor: Editor | null | undefined,
  staticAllow: boolean = true,
): boolean {
  const mainEditable = useMainEditable(mainEditor);
  return staticAllow && mainEditable;
}

export interface UseFloatMainSyncArgs {
  mainEditor: Editor | null;
  floatEditor: Editor | null;
  /** The float's editability — `useFloatEditable`'s value, the same one the
   *  body mounts its editor with. The hook keeps the live editor at it, so a
   *  read-only flip after mount reaches the float (task 1546). Required: a
   *  body cannot join the sync and forget the gate. */
  editable: boolean;
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
   *  position is unknown.
   *
   *  `state` is the main editor state `doc` belongs to — for a body whose
   *  source has no single node to resolve (a marked run), so it can bound its
   *  lookup by the DocStructure snapshot (`resolveLinkedAnchorRange`, task 926)
   *  instead of walking the doc. */
  readSource: (
    doc: import("@tiptap/pm/model").Node,
    hint: SourceRange | null,
    state: import("@tiptap/pm/state").EditorState,
  ) => ReadSourceResult;
}

export function useFloatMainSync({
  mainEditor,
  floatEditor,
  editable,
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
  /** The span this float's own last write occupies in main, or null (task
   *  1399). Bodies hand it to `landFloatWrite` as the write target, so a float
   *  that has grown past its source's identity extent (an Enter-split list
   *  item, a section that gained a terminating heading) overwrites what it
   *  wrote rather than the shrunken identity span. Read-only for callers. */
  writtenRangeRef: RefObject<SourceRange | null>;
  /** The message of the float's last REFUSED write-back, or null (task
   *  1170). Render it through `WriteRefusedBanner`. */
  writeRefusal: string | null;
  /** Feed every `landFloatWrite` outcome here: a refusal raises the banner,
   *  a landed or `unchanged` write clears it. */
  reportWrite: (outcome: FloatWriteOutcome) => void;
} {
  const [sourceMissing, setSourceMissing] = useState(false);
  const sourceRangeRef = useRef<SourceRange | null>(null);
  const writtenRangeRef = useRef<SourceRange | null>(null);
  const [writeRefusal, setWriteRefusal] = useState<string | null>(null);
  const reportWrite = useCallback((outcome: FloatWriteOutcome) => {
    setWriteRefusal((prev) => nextWriteRefusal(prev, outcome));
  }, []);
  // The float now equals what main holds — by a re-seed, or because it had
  // already converged (an undo or a foreign edit that matched it; task 1223) —
  // so the banner describing refused content no longer describes anything.
  // Identity-bailed: a no-op when no banner is up.
  const onConverged = useCallback(() => {
    setWriteRefusal((prev) => (prev === null ? prev : null));
  }, []);

  const onMainDocChanged = useCallback(() => {
    if (!mainEditor || !floatEditor) return;
    syncFromMain(
      mainEditor,
      floatEditor,
      readSource,
      setSourceMissing,
      sourceRangeRef,
      writtenRangeRef,
      onConverged,
    );
  }, [mainEditor, floatEditor, readSource, onConverged]);

  // Keep the live float at the gate's answer: the mount took its value then,
  // and this follows every later flip (task 1546). Identity-bailed, and no
  // `update` emitted — the content did not change, so there is nothing for the
  // body's write-back to send.
  useEffect(() => {
    if (floatEditor && !floatEditor.isDestroyed && floatEditor.isEditable !== editable) {
      floatEditor.setEditable(editable, false);
    }
  }, [floatEditor, editable]);

  useMainTransactionSync({
    // Subscribe (and seed) only once both editors exist — the seed call
    // must be able to write into the float.
    mainEditor: floatEditor ? mainEditor : null,
    floatId,
    onMainDocChanged,
    sourceRangeRef,
    writtenRangeRef,
  });

  return { sourceMissing, sourceRangeRef, writtenRangeRef, writeRefusal, reportWrite };
}

function syncFromMain(
  mainEditor: Editor,
  floatEditor: Editor,
  readSource: UseFloatMainSyncArgs["readSource"],
  setSourceMissing: (v: boolean) => void,
  sourceRangeRef: RefObject<SourceRange | null>,
  writtenRangeRef: RefObject<SourceRange | null>,
  onConverged: () => void,
): void {
  // A re-read re-seeds the float from the source's identity extent (or finds
  // it already equal to it), so the span the float last wrote no longer
  // describes what the float holds — its next write targets the identity.
  writtenRangeRef.current = null;
  const { doc, missing, range } = readSource(
    mainEditor.state.doc,
    sourceRangeRef.current,
    mainEditor.state,
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
  if (sameDoc(doc, floatEditor.getJSON())) {
    onConverged();
    return;
  }

  // Caret restore mapped through the structural change (EX-F8-02 class): a
  // foreign main edit upstream of the float's caret shifts the content, so the
  // raw {from,to} offset would land the caret earlier than its logical
  // position. `reseedPreservingCaret` diffs old↔new and maps the caret through
  // the edit — the shared single owner with ExampleCard's re-seed.
  reseedPreservingCaret(floatEditor, doc);
  onConverged();
}

function sameDoc(a: JSONContent, b: JSONContent): boolean {
  // Cheap structural equality. Both are TipTap JSON trees — small enough
  // that JSON.stringify is fine, and stable key ordering is preserved
  // because both come from the same node.toJSON / editor.getJSON path.
  return JSON.stringify(a) === JSON.stringify(b);
}
