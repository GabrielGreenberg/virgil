# Focus View — perf + UX rework (2026-06-19)

**Worktree:** `focus-view-perf-rework` (branched from local `main` @ `1e00f6e`, since
the prior focus work is local-only/unpushed). **Manager/ultracode session.** SSOT for
this rework. Supersedes nothing in `MEMO_FOCUS_VIEW_REWORK.md` (that one stands as the
history of the UUID-band rework); this builds on it.

## The ask (user)
1. Focus view is **slow/unresponsive** — "feels like it walks the whole doc on every
   mouse down." Part is outline-view-wide (deferred to another session), part is
   focus-specific.
2. **Central change:** a mere FOCUS selection (no lock) must NOT change the text
   viewer — it's just a preference. The view only confines on **LOCK**.
3. Clicking any outline object should easily select **that** range; dragging the band
   edges should easily change the range. All slow/buggy/inconsistent today.
4. Design principle: **deep, unified, architectural** fixes over surgical patches.

## Decisions (user, 2026-06-19)
- **Unlocked focus = band overlay ONLY.** Editor unchanged; outline shows just the
  highlighted band — **no dimming anywhere** until lock. Lock confines.
- **Click selects the clicked object's own extent.** Heading → its subtree; a
  paragraph/parTitle row → just that block. (Today a body click wrongly grabs the
  whole enclosing section.)
- **Drag edges = free row-to-row, symmetric.** Both edges snap to the nearest outline
  row; band = `[topRow, bottomRow]`; no section re-expansion; crossing swaps/clamps
  instead of freezing.
- **Fix the outline content source NOW** (stabilize identity; stop per-render
  `getJSON`). Defer deeper outline-wide work (virtualization, full DocStructureBus
  outline model) to the separate outline session.

## Verified diagnosis (15-agent audit + my own code reads)
The slowness is NOT per-keystroke (the UUID-band core is keystroke-safe). It's the
**band-change/interaction path** plus an **outline-wide content-serialization** wart.

ROOT CAUSES (confirmed against code):
- **[D] CRITICAL — outline `content` = inline `editor.getJSON()` per render**
  (`EditorPane.tsx:4212` docked-ish + `:4285`, both panel branches, docked AND
  floating). O(doc) serialize + fresh identity on EVERY EditorPane render → busts
  `memo(OutlinePanel)` + its 3 O(doc) `useMemo`s (`extractHeadings`/`getDocTitle`/
  `buildPerBlockCounts`). Every focus-state change re-renders EditorPane → re-walks
  the whole doc 3×. **This is the engine of "walks the whole doc on every mouse down."**
  (Note: `docForOutline = latestDoc` at `EditorLayout.tsx:2326` is a SEPARATE,
  debounced source feeding only the focus *engine* heading inputs + focus word-count —
  NOT the panel rows. The dual source is also finding FV-outline-hide-band-divergence.)
- **[A] HIGH/ARCH — hide gated on `active`, not `locked`.** SSOT `resolveFocusBand`
  (`focus-view.ts:111`) returns a range whenever `active`; the plugin
  (`buildFocusDecoSet`/apply `:217-236,:300-321`) hides on `active`. Mirror consumers
  also key on `active`: breadcrumb `skipHidden` (`EditorLayout.tsx:2012,:2142`, set by
  CHIP 4b), omni outsideFocus bin (`omni-fold-focus-filter.ts:57`), outline dim/cull
  (`OutlinePanel.tsx`). Cursor coercion is ALREADY correctly `active && locked`
  (`EditorLayout.tsx:1946-1968`) — the template for the new model.
- **[B] HIGH — band change → real meta tx → `buildFocusDecoSet` full rebuild** + main &
  mirror editor redraw, per snapped row during a drag. `focus.json` is `debounceMs:0`
  → synchronous disk write per snapped row (in-flight write races → "inconsistent"
  feel); `bandFromIndices` returns a fresh object so the no-op write guard never fires.
- **[C] MED — section-path/breadcrumb effects** (`EditorLayout.tsx:1981-2109,:2113-2201`)
  list band indices in their dep arrays → tear down/re-attach listeners + run
  `compute()` (`doc.forEach` + `coordsAtPos` forced reflow) per snap, doubled with the
  mirror.
- **[E] HIGH UX — range model is ad-hoc + asymmetric.** Body/parTitle click →
  `sectionRange` → whole enclosing section (`useFocusMode.ts:128-156,:292-300`). Drag
  edges asymmetric: top = raw row, bottom = `sectionRange`→section end (`:351-373`) →
  bottom border jumps past cursor. Crossing handles silently no-op (frozen feel).
  `nudgeBoundary`/`setRange` are dead (no consumers).

## Architecture — separate three fused concerns (the deep frame)
The focus band today fuses **selection**, **confinement**, and **persistence** onto one
record consulted by one `active`-gated resolver. Split them:

- **Selection** (`active` + a structural region) → drives ONLY the outline band
  overlay. Cheap; never touches the editor.
- **Confinement** (`locked`) → the SINGLE predicate that hides editor content +
  breadcrumb skip + omni bin + outline dim/cull + cursor coercion. One concept
  (`bandConfines(band) = band.active && band.locked`), routed everywhere instead of a
  scattered `.active` boolean.
- **Persistence** (`focus.json`) → committed once on mouseup / debounced — decoupled
  from live drag.

Plus: **one `ResolvedBand`** consumed by both outline-highlight and editor-hide (kill
divergence); **free row-to-row symmetric** band edits keyed to the clicked node's own
extent; **stable structurally-versioned outline content** (no per-render getJSON).

## Chip plan (each independently landable + verified; commit per chip)
- **CHIP A — Confinement re-gate (the central change).** Add `bandConfines` to
  `focus-view.ts`; plugin hides only when confining (unlocked → `DecorationSet.empty`,
  no walk). Flip in lockstep: breadcrumb `skipHidden` → `active && locked` (revert
  CHIP 4b; add `locked` to deps), omni bin → `active && locked`, outline dim/cull →
  `locked` only (unlocked shows band overlay only, no dim). Leave cursor-coercion +
  outline band/drag affordances. DoD: unlocked focus shows all prose + just the band;
  lock hides out-of-band + coerces cursor + bins omni cards; breadcrumb correct in both.
- **CHIP D — Stable outline content.** Replace inline `getJSON()` (`EditorPane.tsx:4212
  /:4285`) with a memoized snapshot gated on `useStructuralRevisions` counters + the
  reactive editor + a debounced text tick (so word counts stay ~fresh without
  per-render re-serialize). DoD: focus snap / unrelated re-render → content identity
  stable → `memo(OutlinePanel)` short-circuits; `__virgilBusStats().emitCount` flat on
  typing; outline still updates on structural edits.
- **CHIP B — Decouple persistence + plugin rebuild from live drag.** Transient drag
  band (FocusBand already snapshots rows): drive the overlay locally during drag,
  commit ONE `update()` on mouseup. Debounce `focus.json`. Idempotent meta dispatch
  (skip when band unchanged; plugin no-op on structural-equal band). DoD: an N-row drag
  = 1 write + (if locked) 1 deco rebuild, not N.
- **CHIP C — Section-path effect de-thrash.** Drop band-index deps from the
  listener-bearing effects; read live state from `focusStateRef`; recompute on
  confinement change via a RAF-coalesced schedule, not an effect re-subscribe.
- **CHIP E — Unified range model.** Click → clicked node's extent (`regionForNode`:
  heading→subtree, paragraph→`[idx,idx]`). Drag edges → free row-to-row, symmetric,
  no section re-expansion; crossing swaps/clamps. One `ResolvedBand` shared by outline
  rect + plugin. Delete dead `nudgeBoundary`/`setRange` (or wire — chose delete).

## Sequencing
A and D are independent and highest-value → first. B/C are perf follow-ons (B benefits
from A: unlocked drag then never touches the plugin). E is UX correctness, independent.
Files overlap heavily (EditorLayout, OutlinePanel, useFocusMode, focus-view) → implement
chips SEQUENTIALLY on this one worktree, `tsc`+tests between, commit per chip. Merge to
main only after the full suite is green + a live preview smoke + user OK.

## Verify (must, per the keystroke-sanctity doctrine)
- `__virgilBusStats().emitCount` flat on plain typing; `__virgilFocusRebuilds()` flat on
  unlocked focus select/drag, bumps once per gesture when locked.
- Outline `content` identity stable across a focus snap (D).
- Unlocked focus: editor shows everything, only the band renders in the outline.
- Lock: out-of-band prose hidden, breadcrumb correct, cursor coerced, omni binned.
- Drag across N rows: 1 focus.json write, smooth, no editor reflow while unlocked.
- Click a paragraph row → band = that block; click a heading → band = its subtree.

## STATUS — end of session 2026-06-19 (worktree `focus-view-perf-rework`, NOT merged/pushed)
Base `1e00f6e`. Four chips landed; CHIP C deferred.
- **CHIP A** ✅ `f5da452` — confinement re-gated to `locked` (bandConfines). LIVE-VERIFIED.
- **CHIP D** ✅ `eeee6e3` — stable outline content (no per-render getJSON).
- **CHIP E** ✅ `b9159c6` — unified range model (node-extent click; free row-to-row
  symmetric drag; clamp-not-freeze; dead code deleted).
- **CHIP B** ✅ `75e5a89` — band drag = local overlay, commits ONCE on mouseup;
  focus.json debounced 150ms.
- **CHIP C** ⏸ DEFERRED (optional) — section-path/breadcrumb effects still re-subscribe
  listeners on each *discrete* band change (CHIP B removed the per-snap version). Lifting
  the band-index deps out of the listener-bearing effects (read from focusStateRef,
  recompute via a RAF schedule) is the clean follow-up. Low value now; delicate code.

**Verification:** `tsc` clean · full suite **2294/2294 green** · no NEW eslint errors
(3 pre-existing in OutlinePanel are on the base). **Live (dev preview, 6-block doc):**
unlocked band → 0 hidden; locked band → exactly the 2 out-of-band blocks hidden;
`__virgilFocusRebuilds` 0→0 (unlocked, no work) →1 (lock); typing 5 chars in-band under a
locked band → `emitCount` Δ0 + `focusRebuilds` Δ0 (maps, never rebuilds). App loads with
zero console errors.

**OWED (user):** a gesture FEEL-check on the real paper — turn focus on without lock (text
stays full, only the outline band shows) → drag the edges (should feel smooth, free
row-to-row) → lock (confines). The dev doc is empty so the drag *feel* wasn't headlessly
testable; the lock-gate logic + keystroke sanctity ARE verified above.
**Preview recipe** (dev doc is empty — use the real paper or refresh doc_devtest from
samples/annotation-history): worktree needs a REAL node_modules (Turbopack rejects the
symlink — `cp -al ../../virgil/node_modules node_modules`), a launch.json entry cd-ing
into the worktree with `NEXT_PUBLIC_DEV_STORAGE=true`, then in-page
`localStorage.setItem('virgil:force-dev-storage','1')` + reload.

## Audit artifact
Full structured findings (38 findings, 16 adversarially verified) in the workflow run
`wf_38fd1800-7d2` (transcript under the worktree session dir).
