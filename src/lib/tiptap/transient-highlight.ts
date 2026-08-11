import { Extension } from "@tiptap/react";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { EditorState, Transaction } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

/**
 * TransientHighlightDecorator — the ONE carrier for every *transient* (view-only,
 * never-persisted) text-range highlight the app paints over the main document:
 * the search-result band, the diagnostics error range, and the
 * revision/suggestion text band. (The linked-anchor hover/click band is NOT
 * here — it is painted on the anchor mark itself by `useLinkHighlight`'s
 * `data-link-highlight` coupling plus `AnchorHighlightDecorator`. A fourth
 * branch of `applyHighlight` claimed it via an `activeAnchorId` prop that no
 * caller ever passed; task 120 deleted that orphan.)
 *
 * THE BUG THIS FIXES (root-root, task 120). All of them used to be painted as
 * ordinary `highlight` MARKS by `Editor.applyHighlight` — real document
 * mutations, dispatched WITHOUT `addToHistory: false`. A transient, UI-derived
 * signal was therefore living in the document, with three consequences that
 * look unrelated but share one cause:
 *
 *   1. **Redo destruction.** The mark-add is a history entry, so clicking a
 *      search result (or hovering a margin card) clears the redo branch —
 *      undone edits become unrecoverable.
 *   2. **Undo pollution / resurrection.** The clear — select the whole doc,
 *      unset the mark — was itself a recorded doc-changing transaction, so the
 *      first Cmd+Z after closing the search panel UNDID the clear and
 *      resurrected the amber band, with the panel closed and nothing left to
 *      clear it.
 *   3. **Phantom dirty + autosave.** A mark tx is `docChanged`, so it armed the
 *      `useDocument` autosaver: hovering a card wrote an unedited doc to disk
 *      and exercised the disk-ledger / DiskWatcher machinery for a no-op.
 *
 * Plus two the mark model made unavoidable: the transient painter had to select
 * the WHOLE doc and unset every highlight to clear (a mark cannot be scoped to
 * "the transient one", so any REAL highlight the document carried was
 * collateral), and it had to move the SELECTION onto
 * the range to apply the mark at all — leaving a doc-spanning selection whose
 * grey "inactive selection" ghost needed its own restore-the-caret workaround.
 *
 * THE FIX. A decoration is not document content. The set is replaced by a
 * META-ONLY transaction (`!docChanged`), so it is invisible to history, to the
 * autosaver, and to `DocStructureObserver`; it cannot collide with a user mark;
 * and it needs no selection of its own. Same shape as the sibling
 * {@link import("./anchor-highlight-deco").AnchorHighlightDecorator}, which
 * already owns the card hover/selection ATTRS on node targets — this one owns
 * transient TEXT RANGES, which must be `Decoration.inline` (a node decoration
 * cannot paint a partial-block span).
 *
 * (Unlike the card-attr case, an inline decoration's fresh inner `<span>` is
 * harmless here: the only thing being painted is a background color, not an
 * `attr`+`class` pair the CSS needs on one element.)
 *
 * KEYSTROKE SANCTITY. The set is rebuilt ONLY on a transaction carrying the
 * `transientHighlightKey` meta. Every other transaction — a plain keystroke
 * included — does `DecorationSet.map(tr.mapping, tr.doc)` on a set that holds at
 * most one decoration, then returns. No doc walk, no structural emit, and the
 * meta dispatch itself never sets `docChanged`, so `emitCount` stays flat.
 */

/** Geometry class for the painted span; the COLOR rides an inline style because
 *  it varies per consumer. Mirrors `.tiptap mark` in globals.css so the swap
 *  from mark → decoration is pixel-neutral — which holds only because the
 *  decoration always builds its OWN wrapper element (see `nodeName` below), so
 *  the class can never land on a document node's element. */
export const TRANSIENT_HIGHLIGHT_CLASS = "virgil-transient-highlight";

/** The amber every transient band uses today. Was inlined at three call sites
 *  in `Editor.applyHighlight`. The per-target `color` stays a parameter because
 *  a tinted band (per-card accent) is the natural next consumer. */
export const TRANSIENT_HIGHLIGHT_COLOR = "#fbbf2480";

/** One transient band, in live PM coordinates at dispatch time. */
export type TransientHighlightTarget = {
  from: number;
  to: number;
  /** Any CSS color. Callers pass {@link TRANSIENT_HIGHLIGHT_COLOR} unless they
   *  carry a tint of their own. */
  color: string;
};

/** Meta payload: the COMPLETE desired band list for this frame. The plugin
 *  replaces its whole set from it — callers are idempotent and always send the
 *  full picture, exactly like the anchor-highlight sibling. */
type TransientHighlightMeta = { targets: TransientHighlightTarget[] };

export const transientHighlightKey = new PluginKey<DecorationSet>(
  "transientHighlightDeco",
);

function buildSet(
  doc: EditorState["doc"],
  targets: TransientHighlightTarget[],
): DecorationSet {
  if (targets.length === 0) return DecorationSet.empty;
  const decos: Decoration[] = [];
  for (const t of targets) {
    // Defensive clamp: a range resolved a frame ago can be stale after an
    // interleaved edit. Skip rather than throw — the next reconcile repaints.
    if (t.from < 0 || t.to > doc.content.size || t.to <= t.from) continue;
    decos.push(
      Decoration.inline(
        t.from,
        t.to,
        {
          // `nodeName` is load-bearing, not decoration. Without it, a band that
          // COVERS an inline leaf (citation pill, footnote marker, inline math)
          // is applied as an OUTER decoration and PM merges `class`/`style`
          // straight onto the ATOM's own element (`computeOuterDeco` takes the
          // `needsWrap === false` path for an element-DOM child). Our class then
          // outranks `.citation-node` / `.footnote-marker` on specificity and
          // rewrites their padding + border, and the inline background replaces
          // the pill's own. Naming the element forces PM to build a WRAPPER in
          // both cases (text child and element child alike) — exactly what the
          // old `<mark>` did, which is why the mark carrier never had this
          // failure mode. The atom's own DOM is then left completely untouched.
          nodeName: "span",
          class: TRANSIENT_HIGHLIGHT_CLASS,
          style: `background-color:${t.color}`,
        },
        // Typing at either edge must NOT grow the band — a transient signal
        // tracks the range it was given, it doesn't accrete text. (Both are
        // PM's defaults; stated explicitly because it is the contract.)
        { inclusiveStart: false, inclusiveEnd: false },
      ),
    );
  }
  return decos.length > 0 ? DecorationSet.create(doc, decos) : DecorationSet.empty;
}

/**
 * Replace the transient-highlight bands with `targets` (pass `[]` to clear).
 *
 * Dispatches a META-ONLY transaction: no steps, no `docChanged`, no history
 * entry, no autosave arm, no structural emit. Idempotent at the caller — send
 * the complete desired set every frame.
 *
 * Bails without dispatching when clearing an already-empty set, so the frequent
 * "nothing to highlight" reconcile (every unrelated prop change on the owning
 * effect) costs zero transactions.
 */
export function setTransientHighlights(
  view: EditorView,
  targets: TransientHighlightTarget[],
): void {
  if (targets.length === 0) {
    const current = transientHighlightKey.getState(view.state);
    if (!current || current === DecorationSet.empty) return;
  }
  const meta: TransientHighlightMeta = { targets };
  view.dispatch(view.state.tr.setMeta(transientHighlightKey, meta));
}

/** Clear every transient band. Sugar for `setTransientHighlights(view, [])`. */
export function clearTransientHighlights(view: EditorView): void {
  setTransientHighlights(view, []);
}

export const TransientHighlightDecorator = Extension.create({
  name: "transientHighlightDecorator",

  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key: transientHighlightKey,
        state: {
          init() {
            return DecorationSet.empty;
          },
          apply(tr: Transaction, value: DecorationSet) {
            // KEYSTROKE SANCTITY: forward-map on every transaction
            // (O(#bands) — at most one), never a doc walk.
            let set = value.map(tr.mapping, tr.doc);
            const meta = tr.getMeta(transientHighlightKey) as
              | TransientHighlightMeta
              | undefined;
            // Rebuild ONLY when a consumer pushed a new frame. A plain
            // keystroke carries no meta → keep the mapped set and return.
            if (meta) set = buildSet(tr.doc, meta.targets);
            return set;
          },
        },
        props: {
          decorations(state) {
            return transientHighlightKey.getState(state) ?? DecorationSet.empty;
          },
        },
      }),
    ];
  },
});
