# Action-alignment matrix — findings

Per-defect root-cause + fix log for the action-alignment matrix sweep. Each
entry: the empirical repro, the culprit (file:line), the exact trigger, and the
fix.

---

## F2 — deleting/archiving a paragraph silently removes a trailing `graphicsBlock`

**Status:** ROOT-CAUSED + repro'd (live + vitest) + FIXED + **MERGED (`741c1fa`, on `origin/main`) + VERIFIED LIVE** by the manager, 2026-06-14. Live re-check after merge: `delete 4413` removes only `4413` (Δ−1), `94cf` survives. Full suite 1108 green.

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

---

## Follow-up nits (post-CHIP-8 cleanup, 2026-06-15) — 4 fixed, 1 deferred-by-design

Three worktree chips, all merged to `origin/main` (`bd5252c` / `c3515a3` / `a2f08a9`), full suite 1357 green:
- **#3 heading no-op → FIXED** (`bd5252c`): heading rows now grey (`applies:'disabled'`) where `setBlockType(heading)` would no-op — schema-driven `selectionCanHostHeading` (mirrors PM's own predicate), so `listItem`/`exampleItem` carets grey, top-level + blockquote-inner-paragraph stay `'ok'`.
- **Stale-ref silent-break → FIXED** (`c3515a3`): the silent return was the shared `if (!resolved) return;` after `resolveRefRange` (duplicate's per-case fail-loud was unreachable for a stale uuid). Now archive/delete/duplicate on an unresolvable ref fail loud via a shared `notifyStaleRef` (console.warn + notify, matching duplicate's B1 convention); annotation actions still bail silently.
- **highlight empty-break → ALREADY GUARDED** (`c3515a3`, comment only): two independent guards already prevent it (`if (!text) break;` + `createLinkedAnchor` returns null on a zero-width range). Whole-block-wrap on a non-empty block is intentional (documented).
- **#5 empty-cite → FIXED** (`a2f08a9`): `parseCiteCommand("\cite{}")` now returns `keys:[]` not `[""]`, so `addCitation`'s `keys.length===0` pristine branch fires.

## F4 — RESOLVED + SHIPPED (`5257b1a`) — `todo` range-anchor symmetry

> **Outcome:** user chose to make todos range-anchored. Shipped via `fa7b898` (the cross-cutting
> feature: "todo" → `LinkedAnchorKind` SSOT + `createTodo` anchor opt + dispatch range-anchor +
> **todos in `useLinkedAnchorReconciler`'s alive-set** + legacy-token wiring) and `5257b1a` (the
> reload-restore fix below). A pre-ship **adversarial verification Workflow** (5 refuters) caught a
> regression the 1362-green suite missed: the `applyLinkedAnchors` restore loop omitted todos →
> the range mark wasn't re-stamped on **reload** (tint vanished, jump-to degraded to paragraph).
> `5257b1a` added todos to the restore loop + a load-bearing reload round-trip test. Mode-A
> (cursor/block) todos unchanged.

Original analysis (why it needed coordinated changes, not a naive fix):

The §7 "todo selection-range loss" nit is **structurally deliberate, not a simple bug.** Chip B
confirmed: `createTodo` has no Mode-B text-anchor path, AND `useLinkedAnchorReconciler`
(`src/links/_shared/useLinkedAnchorReconciler.ts`) builds its alive-set from
`{notes, highlights, cutterCards, comments, reportCards}` — **todos are excluded**. So dropping a
`linkedAnchor` mark for a todo (to match note/cutter/revision) would be reaped as an orphan on the
next sweep → a phantom-tint break. True symmetry needs coordinated out-of-scope changes
(createTodo + the todo store + the reconciler alive-set). **OPEN QUESTION for the user: should todos
support range anchors at all, or is paragraph-level (Mode-A) the intended todo UX?** Not fixed —
forcing it would ship a regression.

---

## F1 — UX (low) — `archive` on a `latexComment` surfaces no destructive confirm

**Status:** RESOLVED — **BY DESIGN, not a bug.** `latexComment` declares
`confirmDestructive: () => null` ([text-object-registry.ts:544](../../../src/text-objects/text-object-registry.ts))
with the explicit rationale *"Author noise, cheap to redo — never warn."* The silent archive/delete
is intentional (a `%`-comment is low-stakes), distinct from the math/`\ref`/figure/tex blocks that
`63ccace` deliberately gave confirms. No action.

---

## F3 — observation (triage) — new footnote cards are not written to `footnotes.json`

**Status:** observed (CHIP 8 footnote alignment). Creating a footnote via any surface
(typed/slash/grab) sets the body in the footnote atom's `content` attr (→ round-trips via `.tex`),
but does NOT add an entry to `footnotes.json`, whereas a new citation DOES add a `citations.json`
entry. Uniform across all 3 footnote surfaces (so NOT a cross-surface divergence). May be intended
(footnote body is atom/`.tex`-resident; the sidecar may be a derived/legacy cache) or a persistence
gap. Delegated to the chip8-realstack citation/footnote agent to determine intent. Low priority.
