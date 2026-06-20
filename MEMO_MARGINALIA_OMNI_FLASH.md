# Marginalia / Omni note-card "flash stacked at the top" — diagnosis + deep fix

Branch `marginalia-omni-flash` (off main `e61a06a`). Reported symptom: while editing
(esp. **backspace**, in Section 1 scrolled down, a doc with ~30 notes), the **right-panel
note cards** periodically **flash up and stack at the top**, then snap back — ~every 10–15
keystrokes.

## Root cause (confirmed live + by test)

The surface is the **Omni right-panel cascade** (`useInTextPositions`), NOT the marginalia
gutter / orphan dock. A 6-agent adversarial audit (`docs/memos/marginalia-omni-flash/` if
kept) **refuted** every UUID-race / orphan-dock theory: React always renders the *settled*
committed doc, so an orphan classification would be *permanent*, not a transient flash.

The real cause is **stale baked positions for paragraph-anchored Omni cards**:

- Entity-anchored kinds (footnote/citation/example) resolve a **live** position from the
  `DocStructureObserver` snapshot via `useLivePosResolver` (re-mapped every transaction).
- **Paragraph-anchored kinds (note/todo/cutter/revision/report/archive)** were left on the
  **baked** `findParagraphPos` value, refreshed only on a *structural* `items` rebuild. It
  goes stale as plain typing shifts content.
- `useInTextPositions.measure()` re-runs on the editor **ResizeObserver** (line-wraps /
  height changes ≈ the 10–15-keystroke cadence, bigger on backspace). With a stale pos,
  `coordsAtPos(stalePos)` resolves above the pod top → the cascade **clamps `naturalTop` to
  0** (`useInTextPositions.ts:284`) and packs cards **from the top** → "stacked at the top".

**Live proof (running app, `Symbol.for("virgil.docStructureBus")` snapshot):** a 40-char
upstream insert shifted an anchor **739 → 779**; the baked pos stayed **739** (stale by 40)
while the snapshot tracked to **779**. That's the exact divergence the fix closes.

## The fix (unified: all Omni cards track live)

1. **Core** — `OmniItem.anchorUuid` carries each paragraph-anchored card's anchor uuid (all 6
   builders). `useLivePosResolver(editor, keyOf, paragraphAnchors)` now also indexes
   `structure.blocks.get(uuid).pos` for those ids (`buildParagraphAnchorMap` builds the
   `omniId → uuid` map). `omni-host` + `OmniViewPanel` pass it, so the cascade resolves notes
   live at measure time. Keystroke-safe: snapshot/anchors-identity cached; resolved at measure
   time, no doc walk.
2. **Binning** — `OmniViewPanel`'s anchored/orphaned split prefers the live pos
   (`resolvePos(id) ?? item.pos`), so the bin/sort is live too (conservative: a since-deleted
   anchor falls back to baked, not newly orphaned).
3. **Adjacent bug A** (`step-inspector.ts`) — a uuid AttrStep (backfill re-mint of a split
   clone) emitted `removed.blocks[oldUuid]` even though the **original** still carried it,
   desyncing `structure.blocks` + stripping a live `data-uuid`. Now guarded by a lazy
   live-uuid check (off the keystroke path).
4. **Adjacent bug B** (`useMarginaliaRegistry.ts`) — `useRegistryVersion` snapshotted
   `recomputes`, so an **intersection-only** cache change (block scrolled into the near-zone
   and measured) didn't re-render the gutter. Now snapshots `version` (bumped by every
   `notify()`).
5. **Adjacent bug C** (`linked-anchor.ts`) — `TextObjectOrphanGuard` fired
   `virgil-textobject-orphaned` for a block that `MarginaliaAnchorGuard` **resurrected** in
   the same dispatch, so the Mode-A sweep (useTodos/useArchive) permanently stripped a valid
   link (silent data loss). Now re-checks the **settled doc** in the deferred dispatch and
   skips any uuid that's still live (order-independent).

## Verification

- `tsc --noEmit` clean; eslint adds no new errors (4 pre-existing baseline errors only).
- Full suite **2390 passed / 249 files**. New guards:
  - `useLivePosResolver-paragraph-anchors.test.tsx` — live tracking (before+30) + map builder.
  - `step-inspector.test.ts` — re-mint survival + genuine-death control (bug A).
  - `useRegistryVersion-intersection.test.tsx` — version bumps on ENTER while recomputes flat (bug B).
  - `textobject-orphan-guard-resurrection.test.tsx` — resurrected→no event, removed→event (bug C).
- **OWED:** user visual confirm on the real doc (production FSA) — the backgrounded dev
  preview can't faithfully drive the RAF-gated `measure()` reflow.

NOT pushed; worktree `marginalia-omni-flash`.
