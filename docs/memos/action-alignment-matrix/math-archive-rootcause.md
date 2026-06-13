# Root cause: the "math paragraph won't archive/delete" defect (CHIP V-a)

**Status:** ROOT-CAUSED + repro'd (vitest), 2026-06-13. Fix not yet implemented
(this chip is diagnosis only).

**TL;DR.** The defect is **not math-specific** and **not in the archive/delete
orchestration**. It is `MarginaliaAnchorGuard` doing exactly what it was designed
to do: when a **uuid-bearing block that is anchored by a card** is deleted, the
guard's `appendTransaction` **re-inserts an empty paragraph carrying the same
uuid** at the deletion site, so the card's Mode-A anchor stays valid. The block
therefore "survives" (empty, same uuid) and the lifecycle action looks like a
silent no-op. The CHIP-V reporter saw it only on the math paragraph because the
sample's math paragraph (`3311`) *also* happens to have a cutter card anchored to
it; the plain control (`1102`) has no card, so it deletes cleanly. **Inline math
is a coincidence.**

---

## 1. The mechanism (file:line)

### The guard

[`MarginaliaAnchorGuard`](../../../src/lib/tiptap/linked-anchor.ts) —
`src/lib/tiptap/linked-anchor.ts:205-299`. Its ProseMirror plugin runs an
`appendTransaction` (lines 221-295):

1. Reads the typed diff the `DocStructureObserver` already published
   (`readPendingDiff(newState)`), so no doc walk — `src/lib/tiptap/linked-anchor.ts:226`.
2. Bails unless a block or an anchor was removed (`removedBlocks.length === 0 &&
   removedAnchors.length === 0` → return null) — `:228-233`.
3. For each `diff.removedBlocks` entry, if `anchored.has(b.uuid)` **OR** any
   linkedAnchor mark vanished in the same tx (`anchorVanished`), it marks the
   block as "vanished, must preserve" — `:245-253`.
4. Maps the old start position forward and **`tr.insert(insertPos,
   paraType.create({ uuid: spec.uuid }))`** — a fresh **empty** paragraph with
   the **same uuid** — `:280-292`. Tagged `addToHistory:false` (`:293`).

`anchored` is `anchoredUuidsRef.current`. That set is populated in
[`EditorPane.tsx:1865-1870`](../../../src/components/EditorPane.tsx) from
`marginaliaMarkers` — every paragraph uuid that hosts a gutter card marker
(note / highlight / todo / **cutter** / revision / report). So *any* paragraph
with a card on it is in the set.

### Why the archive/delete dispatcher is innocent

The archive case
([`drag-handle-actions.ts:546-547`](../../../src/components/editor-layout/card-actions/drag-handle-actions.ts))
and the delete case (`:579-580`) both end in:

```ts
const tr = ed.state.tr.delete(extended.from, extended.to);
ed.view.dispatch(tr);
```

That `tr.delete` is correct and *does* remove the block in the dispatched
transaction. But the dispatch runs the plugin pipeline, and
`MarginaliaAnchorGuard.appendTransaction` appends a **second** step in the same
dispatch that re-inserts the empty placeholder. Net result of the combined
transaction: the block is replaced by an empty same-uuid paragraph. No throw, no
console error — because nothing failed; the guard is functioning as specified.

`cleanupLinksInRange` ([`delete-range.ts:117`](../../../src/text-objects/delete-range.ts))
is indeed a no-op for inline-math (it only handles footnote / citation /
linkedAnchor) — but that is a **red herring**: it only deletes *sidecar* entries,
never the doc node, so it has nothing to do with the survival. The math atom's
KaTeX node-view (`math.ts:89-114`) likewise plays no role — `update()` /
`selectNode()` are view-only, not a transaction guard, and the atom is gone with
its parent in the delete step regardless.

`DocStructureObserver` ([`observer-plugin.ts`](../../../src/lib/tiptap/doc-structure/observer-plugin.ts))
is a pure observer — its `apply` only updates plugin state; it has **no**
`appendTransaction`/`filterTransaction` and cannot revert anything. The
`readOnlyEnforcer` `filterTransaction`
([`editor-extensions.ts:1839`](../../../src/lib/editor-extensions.ts)) returns
`true` on an editable main doc, so it is not involved either.

---

## 2. The minimal reproduction

`src/lib/tiptap/__tests__/anchored-block-delete-reinsert.test.ts` (jsdom). Mounts
the **real** `buildEditorExtensions("main")` stack, builds a 2-paragraph doc, and
deletes the whole target paragraph with the dispatcher's exact step
(`tr.delete(pos, pos + nodeSize)`), toggling two independent variables:
*(has inline math?)* × *(uuid in `anchoredUuidsRef`?)*.

Observed `childCount before→after : survivor-state`:

| has math? | anchored? | result | block survives? |
|---|---|---|---|
| yes | **no** | `2→1 : absent` | clean delete ✅ |
| no  | **no** | `2→1 : absent` | clean delete ✅ |
| yes | **yes** | `2→2 : empty`  | resurrected empty ❌ |
| no  | **yes** | `2→2 : empty`  | resurrected empty ❌ |

**Conclusion the matrix forces:** the survivor is a function of `anchored`, not
of `hasMath`. Math drops out as a factor entirely.

Confirmatory control: rebuilding the same stack with `anchoredUuidsRef:
undefined` (so `MarginaliaAnchorGuard` is *not* added — see the
`isMain && ctx.anchoredUuidsRef` gate at `editor-extensions.ts:1811-1817`) makes
the anchored math delete clean (`2→1 : absent`). That isolates the guard as the
sole mechanism.

Run: `npx vitest run src/lib/tiptap/__tests__/anchored-block-delete-reinsert.test.ts`
(4 passing).

---

## 3. Blast radius

The trigger is **"a full-block-range `tr.delete`/`replace` over a block whose
uuid is anchored by a card"**. Derive the affected cells from that:

### Actions
- **archive** — `tr.delete(extended.from, extended.to)` over the whole block →
  **AFFECTED**.
- **delete** — same `tr.delete` → **AFFECTED**.
- **duplicate** — `tr.replace(outer.to, outer.to, cloned)` *inserts a clone*; it
  does **not** remove the source, so the guard never fires → **NOT affected**.
- **cutter / report / note / highlight / todo / suggest-edit** (this dispatcher)
  — annotation actions; they create a card + optional anchor, never remove the
  block → **NOT affected**.
- **suggest-cut / accept-suggestion text splice** (editor skills, `.tex`-side) —
  go through the skill writeback path, not this PM dispatcher, so *today* they
  don't hit the guard. But **any** future PM-side "cut removes the anchored range
  from the live doc" would hit it. Flag, don't fix here.

So within the live React dispatcher, the affected actions are exactly **archive
and delete** (2 actions).

### Atom kinds in the range — IRRELEVANT
inlineMath, displayMath, footnote, citation, labelRef — none matter. The guard
keys on the block uuid being anchored, never on node content. (footnote/citation
are additionally handled by `cleanupLinksInRange`, but that only touches sidecars
and does not change this outcome.) The original "inline-math-specific" framing is
**disproven**.

### Container kinds — ANY anchorable, uuid-bearing block
paragraph (confirmed), and by the same path: heading-section, listItem,
exampleItem, blockquote, figureBlock, etc. — *as long as the deleted block's uuid
is in `anchoredUuidsRef`* (i.e. it carries a gutter card marker) **or** a
linkedAnchor mark vanishes in the same tx (the `anchorVanished` branch, which
fires for highlight/note/cut text-range marks). The guard does not discriminate
by container kind.

### The action × kind matrix cells this ONE defect poisons
**`{archive, delete} × {any anchored block, of any kind, with or without any
atom}` = 2 actions × (every anchored cell).** Concretely: *every* archive/delete
cell in the matrix whose target block currently has a card on it is poisoned —
on every surface that reaches this dispatcher (grab handle + lightning bolt; the
slash/typed surfaces don't expose archive/delete). The "atom-bearing range"
sub-matrix the memo worried about is a strict **subset** that happens to overlap
with anchored cells in the sample — it is not the boundary of the bug.

---

## 4. Fix-spec

### Root cause restated
`MarginaliaAnchorGuard` cannot distinguish **"the user deleted an anchored block
incidentally (preserve it)"** from **"a lifecycle action deliberately removed an
anchored block (let it go; the action already relocated/snapshotted the card)"**.
It blanket-preserves, which is correct for stray keystroke deletes but wrong for
archive/delete.

### Minimal correct fix
Give the deliberate-removal path a way to **opt out of the guard** for that one
transaction, and have the guard honor it:

1. In the archive and delete cases of
   `drag-handle-actions.ts` (lines ~546 and ~579), tag the delete transaction
   with a meta, e.g. `tr.setMeta(LIFECYCLE_DELETE_META, true)` (a new exported
   symbol, sibling to the existing `ignoreReadOnly` convention).
2. In `MarginaliaAnchorGuard.appendTransaction`
   (`linked-anchor.ts:221`), early-return `null` when **any** input transaction
   carries that meta: `if (transactions.some(t => t.getMeta(LIFECYCLE_DELETE_META)))
   return null;`. (Read the meta off the originating transactions, not
   `newState` — `appendTransaction` receives the `transactions` array.)

This is surgical and local, but it is also the **correct seam**: the guard's
contract is "preserve cards through *incidental* edits," and a lifecycle action
is by definition not incidental. The archive path has *already* reanchored its
snippet to the previous block (`findPreviousAnchorableBlock`,
`drag-handle-actions.ts:533`) and the `TextObjectOrphanGuard` already emits
`virgil-textobject-orphaned` so Mode-A cards drop the dead uuid — so suppressing
the placeholder for these transactions does not orphan anything; it lets the
already-built relocation stand.

### Where it lives / chip mapping
This belongs in the **archive/delete `run()` work — CHIP 2/4** of the roadmap (or
a tiny standalone pre-fix, since it is data-loss-shaped and independent of the
registry). When the 623-line dispatch switch is relocated verbatim into per-action
`run()` bodies, the meta-tag is one line added to the archive + delete cases; the
guard edit is one line. Keep both behind a single shared `LIFECYCLE_DELETE_META`
symbol so the two halves can't drift.

### Risks to watch
- **Keystroke sanctity** — none. The guard already runs only on
  `removedBlocks/removedAnchors` (O(removed)); adding one `transactions.some(...
  getMeta)` check is O(transactions) and only on a delete. Plain typing is
  unaffected (no removed blocks → already bails).
- **LaTeX round-trip** — the fix makes archive/delete remove the `%!v:<uuid>`
  marker that today *survives* (the empty placeholder re-emits it). That is the
  desired correction; verify the sample's `3311`/`3312` markers disappear from
  `document.tex` after an archive once fixed.
- **Observer multi-step contract** — the lifecycle delete is a single-step
  `tr.delete`; suppressing the guard removes the guard's *own* second step, so
  the net transaction is simpler (one step), not more. No multi-step mapping
  hazard is introduced.
- **Do not over-suppress** — the meta must be set ONLY on the deliberate archive/
  delete transactions, never globally, or incidental keystroke deletes of
  anchored paragraphs would silently orphan cards (the exact thing the guard
  exists to prevent).

### Alternative considered (rejected)
Making the guard inspect *why* the block vanished (e.g. compare to a snapshot of
intended deletions) is heavier and racy. The meta-tag is the standard
ProseMirror idiom (the codebase already uses `ignoreReadOnly`, `addToHistory`,
`BACKFILL_META`, the fold-meta predicate) and keeps the decision at the call
site that has the intent.
