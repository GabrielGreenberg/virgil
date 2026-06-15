# Action-alignment matrix — findings

Per-defect root-cause + fix log for the action-alignment matrix sweep. Each
entry: the empirical repro, the culprit (file:line), the exact trigger, and the
fix.

---

## F2 — deleting/archiving a paragraph silently removes a trailing `graphicsBlock`

**Status:** ROOT-CAUSED + repro'd (live + vitest) + FIXED, 2026-06-14.

**TL;DR.** Deleting a paragraph that is immediately followed by a
`graphicsBlock` removed the graphicsBlock too — silent **data loss** (the
confirm said only "Delete this paragraph?"). It is **not** caused by the delete
range itself and **not** by any `appendTransaction` plugin. The Delete/Archive
dispatcher computes its deletion range, then calls `cleanupLinksInRange`, whose
citation/footnote card-lifecycle `delete` **synchronously dispatches a doc
transaction that strips the inline atom** from inside the range. That shrinks
the targeted paragraph, so the *originally-computed* `to` boundary (which equals
the paragraph's end, i.e. the next sibling's start) goes **stale** and
over-reaches by the removed size into the next sibling. A size-1 block atom
(`graphicsBlock` / `displayMath` / `texBlock`) sitting there is swallowed whole.
A `figureBlock` survived only **incidentally**: the demo paragraph above it
(`3303`) carries no atom to clean up, so its range never went stale. The bug is
general — any block following a deleted paragraph that contains an inline atom
(or linkedAnchor) is at risk; graphicsBlock was just the demonstrated victim.

### Live repro (sample paper / dev doc)

- `delete` on paragraph `4413` (text + a `\cite{nonexistent2026}` atom),
  immediately followed by `graphicsBlock 94cf` -> doc `childCount` drops by **2**;
  both `4413` AND `94cf` are gone.
- `delete` on paragraph `3303` (no atom), followed by `figureBlock 48cc` ->
  `childCount` drops by **1**; the figureBlock survives.

Driven live through the real `dispatch('delete', { kind:'paragraph', id:'4413' })`
(the drag-handle menu API). Instrumenting `view.dispatch` showed **three**
transactions:

1. selection-plant (`setTextSelection`, no doc change);
2. `ReplaceStep from:6544 to:6545 sliceSize:0` — the **citation atom removed**
   by `cleanupLinksInRange` -> `cardLifecycle.get("citation").delete(id)` ->
   `deleteCitation` -> `deleteLink` (`src/components/Editor.tsx:1403`). This
   shrinks the paragraph by 1, sliding `94cf` from pos 6745 -> 6744;
3. `ReplaceStep from:6498 to:6745` (`virgilLifecycleDelete`) — the paragraph
   delete using the **stale** `to:6745`. The paragraph now ends at 6744, so
   `6744..6745` is the graphicsBlock atom -> swallowed. `removedG: true`.

A raw `tr.delete(6498,6745).setMeta(LIFECYCLE_DELETE_META)` dispatched on its own
(no preceding cleanup) keeps the graphicsBlock — confirming the range is only
stale *because of the intervening cleanup transaction*, not on its own.

### The culprit (file:line)

`src/components/editor-layout/card-actions/drag-handle-actions.ts` — the
`delete` case (was ~`:591-604`) and the identical `archive` case (was
~`:510-566`):

```
const extended = expandCascadeRange(ed.state.doc, outer);        // range vs doc D0
cleanupLinksInRange(ed.state.doc, extended.from, extended.to, …); // dispatches atom-strip tx -> D1
const tr = ed.state.tr.delete(extended.from, extended.to)…;       // ed.state is D1, range is D0 -> STALE
```

The atom-stripping transaction comes from the citation lifecycle:
`src/components/Editor.tsx:1403` (`deleteCitation` -> `deleteLink`); the footnote
lifecycle's `delete` is analogous. `cleanupLinksInRange` lives in
`src/text-objects/delete-range.ts`.

**Exact trigger condition:** the deleted/archived block's range contains an
inline atom (or linkedAnchor-marked text) whose card lifecycle removes a live
doc node, AND another block sits immediately after the deleted block. The next
block is fully consumed when it is a size-1 block atom; a multi-position block
loses content at its leading boundary.

### Why an `appendTransaction` was (correctly) ruled out

Running `editor.state.applyTransaction(deleteTr)` — which executes *every*
plugin's `appendTransaction` — on the live doc kept the graphicsBlock and
appended no transaction. The removal is not a plugin reaction; it is the
dispatcher's own second transaction using a stale range.

### The fix (whole-class)

New helper `cleanupAndComputeDeleteRange(editor, from, to, lifecycle)` in
`src/text-objects/delete-range.ts`: runs the cleanup, then corrects `to` by the
document-size delta the cleanup produced. Every cleanup removal is, by
construction, strictly inside `[from, to)` (the walker only deletes atoms/marks
it found within the range, never the block boundaries), so `from` is unchanged
and `to` shifts left by exactly the removed size. Ref-kind-agnostic (paragraph
TextObject delete and selection-range delete) and atom-kind-agnostic (citation,
footnote, or any future atom whose lifecycle removes a doc node). Both the
`delete` and `archive` branches now call it and dispatch
`tr.delete(range.from, range.to)` against the post-cleanup state, so positions
are internally consistent. The archive `richContent` snapshot is still taken
*before* cleanup, so the archived copy keeps the atom.

### Tests

`src/lib/tiptap/__tests__/graphics-block-delete-neighbour.test.ts` — drives the
real `buildEditorExtensions("main")` stack + the real
`cleanupAndComputeDeleteRange`, with a stub `CardLifecycle` whose citation
`delete` strips the `\cite` atom (mirroring `deleteCitation` -> `deleteLink`):

- graphicsBlock after the atom-bearing paragraph **survives** (childCount -1).
- figureBlock in the same position survives (same class, no longer incidental).
- characterization: the OLD sequence (`cleanupLinksInRange` + stale-range
  `tr.delete`) DOES swallow the graphicsBlock (childCount -2, block gone) —
  proving the test exercises the defect and the fix is load-bearing.

Full suite: 127 files / 1108 tests green; `tsc --noEmit` clean.
