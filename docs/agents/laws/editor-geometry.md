<!-- last-verified: aea05929 2026-09-20 -->
<!-- derives-from: AGENTS.md#laws -->

# Editor geometry ("where is it on screen?")

> **Per-block screen geometry has ONE owner per editor: the EditorGeometry service** ([src/lib/editor-geometry/](../../../src/lib/editor-geometry/service.ts), perf Wave 2 — the marginalia registry's engine evolved editor-attached, the `getBus`/`getDocProducts` precedent). IO near-zone culling (viewport ±800 px), one per-editor RO, a sparse uuid-keyed metrics cache with ε bails and parked (positioned-but-unpainted) twins, a RAF-coalesced gesture-parked measure pass. A consumer that needs a block's Y asks `getGeometry(editor)` (`blocksAtY`, `getMetrics`) or derives from the DocStructure snapshot (`computeSectionPathAt` — the breadcrumb: ONE `posAtCoords` at the reference line + binary search over pos-sorted headings ∪ `BlockEntry.parTitled` blocks) — it does not walk the doc calling `coordsAtPos` per block, and it does not `querySelectorAll` + rect-read per candidate. The pre-service scans survive only as automatic fallbacks (service null) behind kill-switches (`virgil:geom-breadcrumb`, `virgil:geom-hover` — any OFF spelling reverts; declared in [src/lib/feature-flags.ts](../../../src/lib/feature-flags.ts)). `useMarginaliaRegistry` is a thin adapter over the service; its suites are the engine's parity gate. The service also owns the **viewport frame** (wave-2b C7): text edges / pod rect / scroll band / portal context, measured ONCE per editor by the engine's single RO (the editor element + its scroll container ride the same observer as the near-zone blocks) + window-resize + gesture park, equality-bailed, read through `useViewportFrame` ([src/lib/editor-geometry/use-viewport-frame.ts](../../../src/lib/editor-geometry/use-viewport-frame.ts)) by the placement overlays (`SelectionActionsMenu`, `TextObjectGrabHandle`, `PendingChangePill`, `LiftHost`) — plus ONE non-placement reader that takes the channel directly rather than through the hook, `Marginalia`'s `useLaneCols`, because it needs a per-side COLUMN COUNT rather than a frame and subscribes with a primitive snapshot so an unchanged regime costs no render (see "The lane regime" below) — the per-consumer `useEditorViewportCache` (4 hook instances, 8 ROs + 4 resize listeners per pane measuring identical geometry) is DELETED. Caret line boxes on the placement path go through `coordsAtPosCached` (per-frame + per-doc memo on the service; service-less editors fall back to a direct read). Same inversion for the active-paragraph nav history (wave-2b C6): `computeActiveParagraphId` ([src/lib/editor-geometry/active-block.ts](../../../src/lib/editor-geometry/active-block.ts)) — hidden-pane bail, `__DOC_TOP__` sentinel, ONE `posAtCoords` at the viewport top edge + snapshot binary search, legacy triple-walk retained as automatic fallback behind `virgil:geom-active-block`; its two wall-clock pollers (EditorLayout recorder, reader `useParaNavHistory`) gate on `document.hidden` + `isLayoutGestureActive()`. `useInTextPositions` (wave-2b C5) exact-reads only the scroll band and interpolates out-of-band anchors (`approxTopForPos`; scroll-idle refinement settles them exact) — with band membership decided on the anchor's document POSITION, never on the card's own last-committed top (see "The refinement gate" below). On the drop path, the per-move hit-test's block-rect read is THREADED into the placement builders (wave-2b C8) — one forced-layout read per move, with the builders' own read kept only as the fallback for rect-less callers. Probe: `window.__geometryStats()` (alias of `__marginaliaStats`; includes the `blocksAtY` hover-path counters). The wave-2 residual conversions (C5/C6/C7/C8) are all delivered.

### The refinement gate: an approximation never decides its own eligibility

> **A gate that chooses which items get the exact read must not read the estimate it exists to correct.** Ask the question in a space where the input is ground truth — for anchored geometry that is the document POSITION, maintained by the observer's mapping, and the band comes back from the view (`resolveVisiblePosBand`, [viewport-probe.ts](../../../src/lib/editor-geometry/viewport-probe.ts)) rather than from anything a previous pass wrote.

This is the "the card lane beside the text I'm reading is empty, and when cards do come in they overlap" class (task 327), and its lesson is about a defect that **no amount of care inside the gate could have prevented**, because the loop was in the gate's *shape*. C5 classified each already-measured card by its RETAINED pod-relative top: outside the ±`NEAR_ZONE_PX` band ⇒ deferred to `approxTopForPos`. That is a self-referential test, so its error mode is **absorbing** rather than merely occasional: a card whose retained top is wrong by more than the band's padding classifies out-of-band, is re-approximated from the same knots, and classifies out again — forever. *The exact read that would correct the retained top is exactly what the wrong retained top prevents.* Nothing throws, nothing degrades, and the scroll-idle refinement keeps running as a fixed-point iteration on its own output.

Every ingredient ships in production and none is exotic. The **seed** is the degeneracy guard's own deliberate choice — a first-paint measure that raced layout (FOUT, KaTeX / figure NodeViews, the FSA load) commits anyway, "rather than render a blank column". The **displacement** is an FSA open restoring a mid-doc scroll, so the viewport lands far from the only well-seeded region. And the **magnitude** comes free on a real paper: the two endpoint knots are linear in pos over `[0, docSize]`, so with structurally uneven px-per-pos density mid-doc interpolation error passes 600 px easily. The dev doc is small, uniform, and has no FSA timing — which is why this is a member of the FSA-masked class (`anchor_persistence_dev_masks_fsa`) and why the durable evidence is a unit harness, not a preview pass.

Four rules it earned:

- **The probe FAILS OPEN.** `resolveVisiblePosBand` widens anything unresolvable to the document's edge. The asymmetry is the whole point: a band that is too wide costs extra `coordsAtPos` reads for one pass (the pre-C5 cost — correct, just slower), while a band that is too narrow silently withholds the read from something the user can see, which is the defect itself. A padded extent already covering the content box resolves to the whole document with no probe at all — cheaper *and* exact.
- **A probe must land ON SCREEN, and the near-zone padding is therefore applied in POSITION space.** This one was caught by the adversarial pass on the fix, where the first cut probed at the ±600 px padded edges — off-screen by construction on the very mid-doc scroll the fix targets. `posAtCoords` asks the browser first, and the browser answers null for an off-viewport point; PM's fallback is a wrap-around `getClientRects()` sweep over every top-level block, and on an inter-block margin gap it returns `view.dom` and sweeps them all again. So an off-viewport probe is a doc-proportional forced-layout read wearing an O(1) call's clothes — on a path the editor RO already attributes keystroke work to. The probes now take the scroll container's REAL edges and the padding is converted through the density those two probes measure (the document average when both land on one position). The visible range, the part that must never be wrong, stays exact; the padding is a comfort margin, and under-estimating it only defers a card that far off-screen to the scroll-idle refinement that already exists. **The lesson generalizes past this hook: `posAtCoords` is O(1) only where the browser's own hit-test can answer.**
- **"Never measured" may still widen the exact set.** An item with no prior entry is exact-read whatever the band says. That is a fact about HISTORY, not a derived geometry estimate, and it only ever admits more items — so it cannot re-introduce the absorbing state, while it keeps the cold pass richly seeded with knots.
- **The heal has to reach the HEIGHT too.** The card-rect read lives inside the exact branch, so a permanently-deferred card is also a permanently `DEFAULT_ENTRY_HEIGHT` card — which is why the second symptom was arithmetic-exact overlap at the 60 + 4 px quantum rather than mere misplacement. One gate, two symptoms; fixing the classification fixes both, and the suite asserts the height half separately so a future change can't restore one without the other.

The two probes share the hit-test idiom `computeSectionPathAt` and `computeActiveBlockId` had each re-derived (probe at the CONTENT BOX's horizontal center — not the pod's, which is a different anchor and a defined term two sections down; clamp Y; try/catch; null on a miss) — now one `posAtViewportY` all three call, which is also where the viewport half of the clamp now lives for all of them. CI: [useInTextPositions-pos-band-classification.test.tsx](../../../src/hooks/__tests__/useInTextPositions-pos-band-classification.test.tsx) drives the REAL hook through the real story (compressed cold measure → real geometry → repeated passes) over a deliberately PIECEWISE synthetic map — a uniform document heals itself by accident and would prove nothing — and its four classification legs fail on the pre-fix gate while its fifth, "probes the band ON SCREEN", fails on the fix's own first cut. [viewport-probe.test.ts](../../../src/lib/editor-geometry/__tests__/viewport-probe.test.ts) pins both properties a later "tightening" would be most tempted to invert: the fail-open direction, and that no probe leaves the viewport however large the padding.

### The lane regime: pod-anchored chrome asks whether its slot still clears the prose

> **Every element in the marginalia lane is POD-anchored — its x is a fixed offset from the pod edge — while the prose text edge moves with the margin. So each one must ask, from the MEASURED margin, whether its slot still lands in the margin or back over the text. One predicate answers it for all of them: [`laneSlotClearsProse(inset, available)`](../../../src/lib/marginalia.ts).**

This is the "markers paint over the last words of every marked line" class (task 214), and its lesson is about a decision that was *scattered by omission*. The lane's width is floored only while the lane is RESERVED (`marginaliaLaneReserved`), and three consumers depended on that: the floor itself (`resolveHorizontalMargin`), the selection bolt (`computeBoltLeftFromPod`, which since task 045 tucks against the scrollbar and floors at the prose edge), and the marker grid — which **never asked at all**. It packed at the fixed 104px-lane offsets whatever the margin was, so opening the Code pane (which caps the margin at `CODE_VIEW_GUTTER_PX` = 48 and stops reserving the lane) put right col0's opaque badge 14px inboard of the text edge. The `EditorPane` comment claimed markers "gracefully degrade (same as zen / the Library reader)" — but zen and the reader HIDE and the bolt TUCKS, while the grid did neither. **A stated invariant with no consumer is not an invariant.**

Three rules it earned:

- **The question is geometric, not a flag.** `available` is the MEASURED pod-edge → text-edge distance (`podRight − editorRight`, `contentLeft − podLeft` from the geometry service's viewport frame), never the `--editor-pl`/`--editor-pr` pref — the pod sits inside the code-split clip, so `podRight` is the VISIBLE edge and the pref overstates the room. Reading geometry rather than a flag also covers every OTHER narrowing path (zen, a hand-dragged margin, the reader) without threading a second flag to a third consumer, which is exactly how the first one was missed.
- **The threshold is DERIVED per element, from where it actually paints.** `inset` is the distance from the pod edge to that element's INNERMOST edge: the bolt's inboard slot is 96 (⇒ needs a 104px margin — byte-identical to the inline comparison it replaced), the marker grid's is `marginGridInset(side)` — right 62 (⇒ 70), left 44 (⇒ 52, because the left grid is ONE column and the inner-left slot belongs to the popout button). **On the LEFT that 52 is no longer the binding threshold** — task 670 found the prose is not the left grid's inboard neighbour, the fold-chevron column is, and it binds at 88; see "The opposite-anchors half" below. The thresholds differing is the point: the bolt is inboard of the markers, so it tucks at margins where the markers still clear the prose honestly.
- **Failure mode per element, and the unmeasured frame FAILS OPEN.** The bolt tucks; the grid gives up COLUMNS, and at nothing-left it hides that side entirely — cells and the "+K" pill together, since both are pinned in the same column. (Pre-410 the orphan re-pin dock was culled with them, which was the wrong answer for a surface whose whole job is that an anchor-less card does NOT vanish; it has since left the lane — see "The occupancy half" below.) (The original text said "a two-column grid has no sub-lane left to tuck into" and that was the sentence task 325 had to retire: there is one, and the tuck was sitting on it.) An uncommitted viewport frame (`frame.editorEl === null`: pre-first-refresh, a keep-alive pane mounted while `display:none`, a detached view) is every-field-zero, so keying the regime on the arithmetic instead of that sentinel would cull every marker on the first commit of every pane and on every warm tab switch — far worse than the overlap being guarded.

`computeMarkerPositions` takes the resolved per-side COLUMN COUNTS as a REQUIRED argument (a defaulted answer is a decision nobody made), and `Marginalia`'s `useLaneCols` reads the service's viewport channel through `useSyncExternalStore` with a PRIMITIVE packed-integer snapshot — no new observer, no editor subscription, and React bails the re-render on every refresh that leaves the regime unchanged (which is every refresh a keystroke can cause: a height change moves the frame's vertical fields and the regime reads only horizontal ones). CI: [src/lib/\_\_tests\_\_/marginalia-lane-regime.test.ts](../../../src/lib/__tests__/marginalia-lane-regime.test.ts) sweeps every margin 0–200 on both sides through the REAL predicate into the REAL grid and asserts no cell (or pill) ever starts inside `text edge ± INNER_PAD`; it also censuses the production call sites, because a test of the predicate alone structurally cannot catch the original shape — the predicate was never the part that misbehaved, the call site that never asked was.

#### The ordering half: two thresholds that differ need one ORDER, not two answers

Same lane, one axis in (task 325) — and the case where both predicates were right and their *combination* was nobody's job. The grid clears the prose down to a 70px margin and the bolt loses its inboard slot below 104px, so between them BOTH render; the tucked bolt's band is `[64, 92]` in container coordinates and marker col1's is `[70, 92]`, so col1 was painted over — and, the bolt being a fixed portal above `pointer-events-auto` cells, unclickable. `RIGHT_LANE_BANDS` was built to make disjointness STRUCTURAL, and it delivered that only in the reserved regime: both cramped fallbacks were computed OUTSIDE the list, one in pod coordinates and one at wide-lane column offsets.

> **Where several pod-anchored elements share a lane, "does my slot clear the prose?" is not enough — the lane is RESOLVED once, outboard → inboard, in ONE coordinate space, and every element reads its answer off that resolution.**

[`resolveRightLane(available)`](../../../src/lib/marginalia.ts) is it: the scrollbar is fixed, the BOLT places (its reserved inboard band where the lane is whole, otherwise the tuck against the scrollbar floored at the prose edge), and the GRID takes the columns that remain entirely inboard of wherever the bolt landed. `computeBoltLeftFromPod` and `resolveMarkerCols` are both thin readers of it. Four rules it earned:

- **Priority is stated once, in the resolution, and it is a product call.** The bolt outranks the grid because it is the sole entry to `ActionsMenuPanel` (no other surface reaches it) and its 28px body cannot degrade, while the grid already has a graceful absence (214) and a graceful overflow (the "+K" pill). Nothing is dropped that does not have to be: in the 70–103 band the grid keeps col0 — the same single-column shape the LEFT lane has always had — rather than the whole side going dark, which is why option "raise the grid's threshold to 104" was rejected. It would have thrown away the honest band 214 derived.
- **Re-base the outlier into the shared space; don't compare across two.** `MARGINALIA_BOLT_TUCK_X_RIGHT` is the tuck as a container-relative lane offset (= 64), pinned byte-exact against BOTH its task-045 pod spelling and the band-list spelling, so the re-basing is provably neutral. "Which columns does the bolt cover?" is then arithmetic over one origin instead of a comparison between coordinate systems — the shape that let a fixed pod-offset sit on col1 for a year.
- **The count is DERIVED by walking the same column offsets `cellAt` packs against** (`rightColumnsClearingBolt`), never a hand-written "one", so it follows the bolt size, the icon width and the gaps automatically.
- **This cost nothing at the prose threshold, and the reason is worth knowing.** Right cells run OUTWARD from col0, so `marginGridInset("right")` is col0's left edge at ANY column count — losing col1 cannot move 214's derived 70. A future change that made the right grid pack INWARD would have to renegotiate that, which is why the suite pins the independence explicitly.

**The residual this section used to record is CLOSED by task 410.** It read: *the orphan re-pin dock is not a band — it is pinned at `right: 2` inside the same column, so it overlaps the scrollbar gutter in EVERY regime and the tucked bolt in this one … a visible chrome relocation to fix, so it is out of scope here and explicitly outside the disjointness sweep.* The relocation happened: the dock is gone from the lane entirely, so the sweep's scope ("cells and the pill") is now a statement about every occupant there is, rather than an exclusion. See "The occupancy half" immediately below.

CI: the same [marginalia-lane-regime.test.ts](../../../src/lib/__tests__/marginalia-lane-regime.test.ts), widened with the sweep in the prose-clearance sweep's own shape — every margin 0–200, markers enough to force a second row and a pill, and at each one the bolt's band must miss every rendered cell, with counters asserting the sweep crossed BOTH regimes *with markers up* so it cannot pass by hiding everything. Three legs fail when the cramped branch is reverted to the full column count.

#### The opposite-anchors half: a lane whose occupants ride DIFFERENT edges has no structural disjointness to inherit

Same law, the other margin (task 670). The right lane's disjointness is structural because `RIGHT_LANE_BANDS` is a sequential list and *every band in it is pod-anchored* — sequential non-overlapping bands in one coordinate space cannot collide. The LEFT lane looked like the same thing and was not. Its two occupants ride opposite edges:

- the **marker grid** is POD-anchored (`MarginColumn` is `left: 0` on the pod, so col0 sits at a fixed offset from `podLeft` whatever the margin is);
- the **fold chevron** is CONTENT-anchored (`.heading-fold-chevron` / `.source-pod-fold-chevron` are `position:absolute; left: var(--margin-col-chevron, -44px)` inside `.heading-wrapper` / `.source-pod`, whose left edge IS the prose content edge).

Two stacks growing toward each other from opposite ends of one strip coincide at exactly ONE margin. That margin was 88px — the shipped `--editor-pl` — which is why the collision was invisible for as long as nobody dragged. Below it the text half walks onto the pod half: at the pre-670 markers-on floor (80) the chevron's 14px box overlapped col0's badge by 8px, and at `MARGIN_MIN.left` (72, reachable with markers hidden) the chevron sat *entirely inside* the badge. The badge is `pointer-events:auto` under a `zIndex:10` container while the chevron is `z-index:1` in a pod that establishes no stacking context, so the overlap cost the chevron its **clicks**, not just its pixels — task 325's bolt-over-col1 shape rotated onto the other margin.

> **A lane band must declare the EDGE it is measured from. Where a lane's bands ride two edges, its width is not a container size — it is the smallest margin at which the two stacks are still disjoint, and every floor derived from it must be that sum.**

[`LEFT_LANE_BANDS` + `resolveLeftLane(available)`](../../../src/lib/marginalia.ts) are it: each band carries an `anchor` (`"pod" | "text"`), the lane reads `[outer-pad 22][col0 22] … [chevron 14][chevron-text-gap 30]`, and `MARGINALIA_MIN_MARGIN_LEFT` is Σ of both halves (= 88) instead of the container width (80) it used to alias. Four rules it earned:

- **Why nothing caught it: three restatements, no reader.** `marginalia.ts` claimed the left lane's occupants in PROSE only (`MARGINALIA_OUTER_PAD_LEFT` "widened to 22px to host the heading fold-chevron in that strip"), never derived from or checked against the CSS that places them. `block-frame.ts` / `handle-layout.ts` stated the chevron column as their OWN ordered law — explicitly "the LEFT margin's reading of the lane law the right margin already states" — importing nothing from `@/lib/marginalia`. `MARGIN_MIN.left = 72` was a third, its comment calling it the "heading fold-chevron breathing strip". Three spellings of one distance, in three modules, none of which could see another. **Prose that names an occupant is not a lane list; a lane list nothing reads is not an SSOT.**
- **Priority, again stated once in the resolution.** The CHEVRON places first and never degrades: it is the sole entry to folding a heading or a source pod, and it is text-anchored *by requirement* — `block-frame.ts#resolveChevronColumnRight` resolves its token against the BLOCK's font, so a `\part`-sized heading's column is wider than a `\subsection`'s, which pod anchoring would throw away. The GRID takes the columns entirely outboard of it (`leftColumnsClearingChevron`, walking the same offsets `cellAt` packs against) and hides when none does. With the left grid at one effective column that degradation is all-or-nothing, and that is the honest answer: **an icon under the chevron is not a narrower grid, it is a stolen click.**
- **A hand-tuned floor keeps its number and loses its authority.** `MARGIN_MIN.left` stays `Math.max(72, MARGINALIA_CHEVRON_INSET)` — 72 is a comfort value with no derivation, 44 is the structural requirement (below it the chevron renders left of the pod and is unreachable at any zoom). The `Math.max` is what makes the requirement bind if the comfort value is ever re-tuned downward, instead of a comment claiming the comfort value *is* the requirement.
- **A floor that is an EXACT band sum needs a sub-pixel tolerance.** The bands are tangent at the floor by construction, but `available` is a browser measurement: a fractional DPR, a browser zoom or a transformed ancestor returns 87.99 for an authored 88. Without `LANE_MEASUREMENT_EPSILON_PX` (0.5, the geometry service's own metric epsilon) the lane would degrade at its own design value and the left column would vanish at the shipped `--editor-pl` on those displays. Applied to BOTH sides' comparisons — it is a property of the measurement, not of either lane.

The stylesheet stays the renderer's spelling (`block-frame.ts` still reads the LIVE token, so a per-block override wins), and the two are pinned to each other rather than merged: `block-frame.ts` takes its token FALLBACKS from the lane SSOT, and a CSS-parity leg asserts `globals.css` authors exactly those numbers. That is the enforceable sense in which the CSS is a derived output.

CI: [src/lib/\_\_tests\_\_/marginalia-left-margin-geometry.test.ts](../../../src/lib/__tests__/marginalia-left-margin-geometry.test.ts) — the right lane's disjointness leg generalized: it sweeps `available` over `[0, MARGIN_MAX]` and asserts the chevron band misses every rendered marker column at every value, with a companion leg that reconstructs the retired placement and pins the collision band it produced (53…87 inclusive, 72 and 80 among them) so the sweep cannot pass vacuously. The sweep steps in whole pixels; the sub-pixel band inside the tolerance is deliberately not swept, and its own leg states what is accepted there.

#### The occupancy half: a lane packed by ONE walk has ONE kind of occupant

Same lane, and the case where the packer was complete, correct, and simply not
the only thing rendering into the column it packs (task 410). Task 366 made
"the LANE is packed, once, in one walk" true of the marker ROWS. `OrphanDock`
was a second owner in that column — `position: absolute; top: 6; zIndex: 12`,
`pointer-events-auto`, rendered as the last child of the same `MarginColumn`
and invisible to `computeMarkerPositions` by construction.

Three costs, measured, and the third is what made this a relocation rather
than a z-index nudge:

- **It overlapped the first blocks' cells, and it STOLE their clicks.** Its
  band is `6 … 12 + 26n`; the prose root sits below a 40px
  `doc-prose-leadin::before`, so the first cell lands at ≈83 at the default
  40px top margin and ≈43 at `MARGIN_MIN.top` — n ≥ 3 and n ≥ 2 respectively.
  Horizontally the dock is 32 wide, so on the LEFT it clipped col0 by 12px and
  on the RIGHT it covered col1 entirely. Being an opaque `pointer-events-auto`
  surface ABOVE the cells, a covered marker lost its pixels AND its clicks —
  the task-325 bolt-over-col1 shape, one axis over.
- **It was culled with the cells.** The `laneCols[side] <= 0` gate (a cramped
  margin, zen, the read-only reader) dropped the dock along with the grid, so
  the one surface that exists to stop an anchor-less card vanishing could
  itself vanish.
- **It was unreachable on any scrolled document.** `top: 6` inside a naturally
  tall, non-scrolling pod (`.editor-pane-pod` is `overflow: clip`) means the
  re-pin entry point is only on screen at the very top of the paper.

> **A lane whose packing is "one walk" has exactly ONE kind of occupant, or the
> claim is about the walk and not about the lane. And an affordance for a fact
> that is not POSITIONAL does not live in a positional lane: the unanchored set
> needs no metrics, no side and no lane regime, so it is derived at the marker
> SOURCE and surfaced in chrome that is visible from anywhere in the document.**

[`UnanchoredCardsChip`](../../../src/components/UnanchoredCardsChip.tsx) is that
surface — an "N unanchored" pill in the pod's STICKY chrome header, beside the
MenuBar. Six rules it earned:

- **The deep move is that the packer stops KNOWING about them.**
  `MarkerPositionsResult` no longer carries an `orphans` bucket at all, and
  `computeMarkerPositions` skips an `m.unanchored` marker before the side is
  even resolved. Reserving a band for the dock (the other candidate) was
  rejected for the reason 366 exists: it teaches the packer about a
  non-marker-row owner, which is exactly the claim being repaired. A bucket
  left behind is a bucket a future renderer reaches for.
- **The relocation is what makes the cramped-lane cull go away** — not a
  second exemption inside the gate. The chip takes no lane input, so its
  visibility cannot be decided by a margin width.
- **The entries are the SAME `MarkerButton` the lane renders**, in flow layout
  (the shape the "+K" overflow popover already uses). Click still opens the
  card's panel and the grab still starts the drop-mode re-anchor session —
  nothing about that gesture depends on where the button sits, which is why
  the relocation costs no behaviour.
- **It is fed from the UNFILTERED marker set.** The master "show marginalia"
  toggle and the per-type hide set are preferences about the LANE; a card that
  lost its anchor is the same class of fact as a save refusal, and this file's
  own rule is that a data-integrity notice is not hideable by a layout
  preference. Archived cards ARE excluded — an archived card is deliberately
  out of the margin and out of its panel's default list, and its home is the
  Archive panel.
- **The chip renders NOTHING at zero**, rather than a disabled control that
  does nothing (the false-affordance rule).
- **`MarginColumn` is exported for the sweep**, the way `MarkerButton` already
  is for the pin-gesture suite — the interception half is a DOM fact, and a
  geometry-only assertion passes on an implementation that paints correctly and
  still eats the click.

CI: [unanchored-cards-chip.test.tsx](../../../src/components/__tests__/unanchored-cards-chip.test.tsx).
The sweep drives the REAL grid into the REAL `MarginColumn` over n = 1..4
unanchored × margin 0–200 × both sides, with counters proving it crossed both
lane regimes, and asserts BOTH halves: no unanchored marker in either lane
bucket, and **no click-taking surface in the column that is not a marker
button**. Its fixture's `node.top` includes the 40px lead-in — without it the
sweep false-positives at n = 1. The leg with teeth is the CENSUS: the packer
was never the part that could misbehave, a second owner rendered into the
column is, and so is a chip fed from the view-filtered set or mounted inside
the scrolling pod — none of which any test of `computeMarkerPositions` can see.
Measured by neutering each half in turn: restoring the in-lane dock takes 2
legs (the sweep's interception half and the census), feeding the chip
`visibleMarginaliaMarkers` 1, and mounting it in the pod 1. The pre-410
contracts in `marginalia-grid.test.ts` ("it goes to `orphans`") and
`marginalia-lane-regime.test.ts` ("the dock goes with the cells") are
RENEGOTIATED in place with the reason at the site — both pinned the defect as
the contract.

**Owed, not claimed:** a real-FSA eyeball. Orphan state comes from real anchor
death, which is the FSA-masked class, so the durable proof here is the unit
sweep — delete a paragraph carrying three same-side cards, then click the first
block's markers (they answer) and open the chip (all three are there, and one
of them drags back onto a paragraph).

##### The one-surface half: an affordance drawn TWICE is a fork, and sticky chrome is an OWNER too

Same affordance, one surface too many (task 544, Gabriel's own reports with
screenshots). Task 410 put the chip in the pod's chrome header because it was
"visible from anywhere in the document"; task 421 then made the omni bins
sticky and reachable at every scroll position — which retired the chip's
whole justification without retiring the chip. Two surfaces answered one
fact, and not even the same fact: 410's chip counted BOTH sides unfiltered,
422's bins were per side AND category-filtered, so the numbers disagreed on
screen. Gabriel: *"still seeing this on-page unanchored bar — should be just
the gutter bar."* Three members, one shape:

- **The bin stack OCCLUDED the deck.** The bins live in the column's sticky
  band frame, which floats OVER the scrolled cascade pod, and the cascade knew
  nothing about the frame — so a note anchored to the first paragraph was
  painted UNDER the pills, its header unreachable. Same class as this lane's
  own occupancy laws: two owners painting into one column with no cross-owner
  resolution, one column over.
- **Two pills for one fact.** 422 split "N unanchored" (orphaned) from
  "N unplaced" (parked) so a parked card was not announced as an error.
  Gabriel ruled the split a distinction without a difference for the USER.
- **The chip was the second renderer.**

> **ONE owner for the no-anchor affordance — the gutter bin — with the
> occlusion closed at the CASCADE (the frame's measured occupancy is the
> cascade's floor), and the chip demoted to the FALLBACK for a side that has
> no bin surface at all.**

Six rules it earned:

- **The floor is measured, and it is measured AT SCROLL ZERO.** A sticky
  element is pinned in the VIEWPORT, so "how far into the pod does it reach"
  has one scroll-invariant answer, and `readStickyOccupancyFloor`
  ([omni-bin-slot.ts](../../../src/components/editor-layout/omni-bin-slot.ts))
  re-expresses the frame's stuck viewport Y against where the pod's top WAS
  at scroll zero (`podRect.top + scrollTop`). A frame that has not reached
  its pin clamps at 0 — the conservative direction. Never a constant: a
  constant lies the moment a band docks above the bins, which is why the
  OCCUPANT is the bin SLOT — the frame's last flex child, so its bottom is
  below every docked band by construction, and an empty slot under a band
  still reports the band.
- **The floor rides the channels the cascade already has.** `read` runs
  inside the measure pass beside the pod rect it is expressed against; the
  slot rides the pass's own per-card ResizeObserver (a pill expanding, a band
  docking); the committed value is held to the task-328 hysteresis and reaches
  the resolver through `measureVersion` like every natural. Nothing runs per
  scroll frame or per keystroke.
- **The forward pass binds to it, the pin included; the backward pass does
  not.** A pin above the floor rests AT the floor (a card under the bins is
  what the pin exists to escape); the cards BEFORE a floored pin may still be
  pulled above it, because the alternative is two cards on top of each other.
- **What 422 protected moved down a level, not away.** The `AnchorState`
  SSOT still splits free from orphaned; the pill counts both and wears the
  STRONGEST state it holds (error iff any orphaned); the distinction is
  per ROW (`BadgeOrphaned` vs the parked `◌`), orphaned rows first.
- **The bin reads the side's WHOLE item list.** "Hide all cards" and the
  category filter are preferences about the CASCADE; 410's rule for the chip
  arrives at the surface that replaces it — an affordance that exists so a
  card cannot vanish is not hideable by a layout preference. The column's
  content signal counts bin members for the same reason (the Reader's
  narrow-pane rule must not crush a bin-only column).
- **The surface fact is PUBLISHED, never re-derived.** The slot sits behind
  four render gates (zen, the code split, a side with no visible panels, a
  collapsed column); `PanelColumn.onBinSurfaceChange` fires on the slot's own
  mount/unmount edge, and the pane keeps the chip only for a marker whose
  RESOLVED side (the lane's own ladder, task 205) has no bin surface.

CI: [useInTextPositions-cascade-floor.test.tsx](../../../src/hooks/__tests__/useInTextPositions-cascade-floor.test.tsx)
drives the REAL hook and the REAL floor source over a fake stuck frame —
**no pre-544 suite mounted any sticky chrome beside the pod**, so the
occlusion was unrepresentable in all of them — and pins scroll-invariance,
the observer re-floor, the equality bail and the docked-band case.
[omni-one-gutter-surface.test.tsx](../../../src/panels/Omni/__tests__/omni-one-gutter-surface.test.tsx)
drives the bin over hidden / filtered items, the column's publish edges, and
the CENSUS (the chip handed exactly the fallback set, the fact threaded from
both rails and re-derived nowhere, the floor at the one hook call site).
[omni-bin-free-vs-orphaned.test.tsx](../../../src/panels/Omni/__tests__/omni-bin-free-vs-orphaned.test.tsx)
is 422's contract RENEGOTIATED in place with the reason at the site.
Measured by neutering each half in turn: the floor takes 5 legs, the observer
wiring 1, the scroll correction 2, the unfiltered bin 3, the chip's fallback
filter 2 (a census leg in each of two suites), and reverting `OmniViewPanel`
wholesale to its pre-544 shape 16 — the merged pill's own legs and the
renegotiated 410/421/422 contracts among them.

**Owed, not claimed:** the preview eyeball. The floor half is NOT FSA-masked
(a live editor, no disk): anchor several notes to the dev doc's first
paragraphs with one card parked, open one, and its header must clear the
pill. The chip half needs a real orphan (FSA-masked) — collapse a column and
confirm the chip lists only that side's cards.

#### The vertical half: a per-owner layout with no cross-owner resolution

Same lane, the other axis (task 366) — and the case where the resolver was
complete, correct, and answering a question one scope too small. The grid
resolves a collision WITHIN one anchor node (rows × cols, then the "+K" pill);
two nodes' grids were placed independently at their own `node.top`s, and
nothing owned the space between them.

That is safe exactly while consecutive block tops sit further apart than an
icon is tall — false for the shape at the top of every paper. A
title/author/date stack, a run of short headings, any small-print block: two
grids overprint, and the user sees two markers stacked half-on-half with no
error, no log line and a well-formed layout (Gabriel's screenshot).

> **Where several owners lay out into one shared lane, "did I place my own
> items correctly?" is not enough — the LANE is packed, once, in one walk.**
> `computeMarkerPositions` orders each side's node groups by document position
> and walks every row it is about to place against a running frontier, pushing
> a row just clear of the one above it. Same minimal-displacement forward pass
> the omni deck's card cascade runs one lane over (`resolveCascade`), which is
> the sibling that already had this and the reason the hole was invisible: the
> cards were packed and the markers beside them were not.

Four rules it earned:

- **The walk is UNIFORM over intra- and inter-node rows.** A user looking at
  two overlapping icons does not know which block each belongs to, and the walk
  does not have to ask — it asks only "does this row clear the one above it?".
  So a node whose own line pitch is tighter than an icon (18px small print)
  stops self-overlapping too, at the cost of its lower rows drifting off their
  lines. That is the right trade: line alignment that overlaps is not
  alignment.
- **The gap is the rhythm the uncrowded case already has**, which is what makes
  the byte-identity claim true rather than hopeful. `MARGINALIA_ROW_MIN_GAP` is
  2 = a canonical 24px line minus the 22px icon, so the walk cannot fire on the
  canonical pitch and an uncrowded document is placed exactly as it was
  pre-366. Raising it to 4 fails two legs, one of them in the pre-existing grid
  suite — measured, not assumed.
- **Past a stated bound the walk stops pushing and FOLDS.**
  `MARGINALIA_MAX_MARKER_DRIFT` (two icon heights) — beyond that a marker reads
  as belonging to a different paragraph, so the node's markers go into a "+K"
  pill instead, the affordance an over-full grid already uses. Consecutive
  folded nodes share ONE pill, and that is what bounds the cascade: the first
  fold costs a cell, every fold after it costs nothing, so a crowd of any depth
  collapses to a pill rather than a ladder of ever-more-drifted markers. Stated
  honestly at the site: the pill itself sits further than the bound from the
  anchor that minted it, because in a crowd that dense there is no room — one
  pill beats N drifting markers.
- **What a fold must preserve is IDENTITY, not position.** A hidden marker
  renders as an ordinary `MarkerButton` with no cell, and the click path
  resolves its card by `(entityKind, entityId)` — never by Y — so click, delete
  and re-anchor behave exactly as in-grid. The suite asserts the identity
  round-trip rather than assuming it.
- **Document order is a TOTAL order, or the pack reshuffles for reasons the
  reader cannot see.** `top` then `domTop` then the anchor UUID. The last rung
  looks decorative and is not: a full geometric tie is a real shape (a
  `bulletList` and its first `listItem` are both uuid-bearing and can measure to
  the same top AND domTop), and without it the walk falls through to
  `Array#sort`'s stability — i.e. to whichever PANEL emitted its markers first,
  so an unrelated panel's list changing would visibly reorder the pack. The uuid
  is arbitrary between two tied nodes and INTRINSIC, which is the property that
  matters.

CI: [marginalia-cross-node-collision.test.ts](../../../src/lib/__tests__/marginalia-cross-node-collision.test.ts).
Its shape is the point: **every marginalia fixture in the repo drives ONE node**
(`"p1"`), so two grids disagreeing is unrepresentable in all of them — which is
how this shipped with the grid suites green. Every fixture here is multi-node,
and the invariants are swept over the placed cells (zero pairwise overlap,
bounded drift, conservation — every input marker comes back exactly once,
placed or hidden) rather than pinned to hand-computed pixels. Measured by
neutering each half in turn: per-node independence takes 4 legs, the intra-node
half 1, the fold 3, a rigid row offset 4, the crowd-RESTART disjunct 1, each
tie-break rung 1, and a widened gap 2 (one of them in the old suite).

Two of those legs exist because the adversarial pass on this fix found their
branches **unreachable from every fixture** — the shape this file keeps
re-learning, one level down from a call site that never asks: a live branch with
no leg is deletable in silence. Both needed a fixture no natural crowd produces.
The crowd-restart rung only fires when a TALL grid at a tight pitch shoves the
frontier far below its own block and short blocks underneath then fold while
sliding past the open pill's anchor — a uniform run of short blocks keeps the
frontier only ~50px ahead and never reaches it. And the tie-break rungs need two
nodes at one `top`, which no fixture in the repo had, because `AnchorNodeMetrics`
fixtures are written one node at a time. The leg that pins the restart is a
PROPERTY (`no pill collects markers whose anchors span more than the bound`), not
the branch's shape, so it survives a rewrite of how the crowd is tracked.

#### The ink half: chrome NEVER paints on the ink it labels

Same question, other gutter (task 382) — and the case where the anchor knew
about the glyph, the two passes that could MOVE the anchor's answer did not, and
one of them was written a year later.

A grab handle's X is `markerLeft − gapPx − HANDLE_WIDTH`, and for a list `<li>`
`markerLeft` is the MIDDLE of the measured `padding-left` band — an anchor whose
whole stated point is "the handle clears the bullet", because the `::marker`
pseudo has no rect to read. Two later passes then took that answer as a starting
position rather than as a bound: the narrow-viewport FLOOR
(`editorColumnLeft − marginInset`), which pins a top-level list's CONTAINER
handle, and task 353's same-row SEPARATION, which pushes each inner handle
`MIN_SAME_ROW_GAP_PX` inboard of the one before it — **with no upper bound at
all**. On a top-level list the container is on the floor, so the whole 24px has
to come out of the item's side, and the item's box landed on the `•` (Gabriel's
screenshot). Nothing failed: the placement was well-formed and every pass was
self-consistent with the numbers it held.

> **Where several passes decide one affordance's position, they resolve a LANE,
> not a point: `[floor … cap]`, with the cap derived from the row's `inkLeft` —
> the leftmost DOCUMENT INK on that row, resolved BESIDE the anchor
> (`resolveMarkerGeometry`) so the two can never disagree. Every pass that moves
> the affordance moves it within the lane, and the cap outranks the spacing
> target.**

Five rules it earned:

- **The cap binds the RESTING position, not just a push** — which is what
  turned a list fix into a class fix. An ordered list's `10.` reaches further
  left than the band-middle anchor assumes, so that row collided with no push
  involved. A cap applied only to the separation would have closed the reported
  case and left its sibling live.
- **A measurement may only TIGHTEN a heuristic, never loosen it** (`min`). The
  band middle is what we are entitled to assume without a rect; the measured
  marker-string width (`text-metrics.ts` `measureTextWidth` — never a hardcoded
  px, per this same section's own rule) is what closes the gap where the
  assumption is false. Where there is no canvas the measurement answers "no
  opinion" and the heuristic stands alone.
- **The FLOOR outranks the CAP.** An unreachable handle is worse than an
  overlapping one, and a cap left of the floor means the row has no clear margin
  at all.
- **The bound is per-ROW and the widest marker is the safe one.** A list's
  ink boundary is computed from the widest marker the LIST can render
  (`children.length`, O(1)) rather than this item's own index (O(siblings) on
  every hover placement) — a bound that covers every row is the safe direction,
  and the cheap one.
- **Widening the lane is a real lever, and it is a layout decision.** The
  `.tiptap ul/ol` marker band went 1.5em → 2em in the same task, because at
  1.5em the cap fired on the everyday top-level list instead of being the
  rare-case net it is meant to be. Recorded in `STYLE_GUIDE.md` with the
  inequality that says what "fits" means, since it moves every list in every
  document.

CI: [handle-marker-ink-clearance.test.tsx](../../../src/text-objects/__tests__/handle-marker-ink-clearance.test.tsx)
drives the REAL component over a REAL marker band at TWO font sizes — the em/px
unit mix (band in em; floor, gap-min and handle width in px) is why the report
reads as intermittent — and states the contract as a CLEARANCE rather than as
non-intersection: at the reported geometry the pre-fix box ended **0.25px** short
of the band middle, so a bare "doesn't intersect" leg would have passed on the
very screenshot that produced the task. Each geometry leg asserts twice: against
the RESOLVED boundary (the contract) and against where the FIXTURE actually
paints the glyph (the reality), because a leg that checks only the code's own
estimate cannot tell a good estimate from a bad one — the same shape as "an
approximation never decides its own eligibility", one gutter over. Measured by
neutering each half in turn: the separation cap takes 4 legs, the lane cap 7,
the measured-ink half 4, and the shipped 2em band 1.

**Residual, stated rather than implied.** `inkLeft` is a LEFT edge, not a span,
so a handle is bounded by the ink it approaches and not by ink it has already
passed. The one shape where that shows is an expex row 1, whose `(n)` sits
between the block's handle and the item's: the item handle's box straddles the
`(n)` — pre-existing, unchanged by this task, and unfixable with left edges
alone. Closing it needs ink SPANS plus a row-lane packer, and the alternative
available today (treat an outboard marker's LEFT edge as a barrier) would force
both handles into the 1.5em `(n)` column and reproduce the unreadable blob task
353 exists to prevent.

##### The hierarchy half: a per-level answer is anchored to its OWN level

Same gutter, the VERTICAL axis (task 394) — and the case where the rule was
right about the shape it was measured on and generalized to a shape that
falsifies it. Task 353 (Gabriel's own spec) measured a FLAT list and concluded
that a container's handle must anchor to the HOVERED row, so that "a container
and its item produce the SAME opticalCenterY" holds at every row rather than
only at row 1; the implementation delivered it by threading a per-hover
`descendTo` HINT into `resolveFirstLineTarget`.

A nested list falsifies it. The hover set is every CONTAINING level, so
anchoring each of them to the pointer's row stacks one handle per level onto
that one row — Gabriel's screenshot: three handles bunched on "locations", the
innermost pushed onto the bullet glyph (the very 382 collision the ink cap
exists to bound, arriving from the axis the cap cannot see). Nothing failed:
every placement was well-formed, every handle was on the row 353 asked for.

> **Every grab handle anchors at its OWN block's first visual line, at its own
> marker-derived X.** Visibility stays hover-scoped to the containing chain
> (353 points 1-2 unchanged); the hovered — lowest — node contributes exactly
> one handle, on its own row. So the gutter reads outward-in as a structural
> breadcrumb: the outer list beside the outer list's top row, the outer item
> beside its own line, the inner list beside ITS top row, one handle on the
> hovered node.

Five rules it earned:

- **The fix is a DELETION.** `descendTo` is retired from `resolveFirstLineTarget`
  and from both public entry points (`resolveContentEdges` /
  `resolveBlockFrame`), so there is one rule with no special case — rather than
  a distribution pass layered on top of the stacking, which would have left both
  descriptions live and let them drift. It is uniform over the whole container
  family by construction (the descent is `CONTAINER_KINDS`-keyed), not a list
  special case.
- **A container's first grabbable child IS its own first visual line.** A `<ul>`
  has no text line and an `.expex-block`'s only direct text is its `(n)` chip at
  `0.95em` — the wrong metrics to anchor chrome to — so the descent that 353
  inherited was always answering the right question; what 353 added was the
  hint that overrode it.
- **The same-row machinery survives for GENUINE coincidences.** A list's first
  row, or a container whose first child is a container, really is one line
  shared by two levels: 353's separation and 382's ink cap still govern exactly
  those. With the levels distributed vertically they shrink to ≤2 handles in
  practice, which is what makes both mechanisms sufficient — and why the item
  handle's X on row 1 legitimately differs from its resting X on rows 2-N.
- **Interaction gets STRONGER, not weaker, and the reason is structural.** The
  hover band already returns every containing level, and a container's own first
  row is inside that container — so travelling UP the gutter toward a
  container's handle keeps the pointer inside it and the handle alive at an
  unmoving position. Pre-394 that handle MOVED as the pointer travelled, which
  is what the travel leg measures.
- **Decided default, stated at the site:** a container whose first line has
  scrolled off-screen paints its handle off-screen with it — the chrome belongs
  to its structure, and there is no viewport pinning in v1.

CI: the renegotiated [grab-handle-hover-spec.test.tsx](../../../src/text-objects/__tests__/grab-handle-hover-spec.test.tsx).
353's set-membership legs are untouched; its SAME-Y legs are renegotiated in
place with the reason at the site (the defect asserted as the contract, which is
this file's own rule about a guard that pins the wrong thing). The legs with
teeth drive the NESTED fixture, and its absence is why no pre-394 suite could
see this: **every grab-handle fixture in the repo is a FLAT list**, where a
container has exactly one containing level and "one handle per level on the
hovered row" is indistinguishable from "one handle" — the defect needs four
levels to be representable at all. Measured by neutering the fix back to the
hovered-row hint: 6 legs fail, and the X-order leg passes either way, which is
correct — X was never the defect and that leg is a non-regression pin.

**Owed, not claimed:** the preview eyeball on the screenshot's exact shape
(nested list, hover the last inner item → four handles at four distinct rows,
none touching a bullet). This class is NOT FSA-masked, so the check is cheap and
real.

###### The set half: both prior passes held the SET fixed and argued PLACEMENT

Same gutter, the third statement of one rule (task 425) — and the case where
two passes each corrected the other's geometry while carrying the same
unexamined premise. 353 said every containing level gets a handle, all on the
hovered row; 394 said every containing level gets a handle, each at its own
first line. Gabriel, on 394's own nested screenshot: FOUR handles on three rows
for a pointer on the deepest item is wrong. His rule, verbatim:

> If you are at the top row of a list of nested items, you get two handles —
> one for the item, one for the list. If you are not at the top row, you get
> one — for that item. And that's it. The same rule applies up and down the
> hierarchy.

So the hovered item ALWAYS gets its handle, and a container gets one ONLY when
the hovered line is that container's own top row. The visible set is ≤2 by
construction under the list schema — a `listItem`'s first child is a
paragraph, so no row is the top row of two nested lists at once — not by a
cap. And it is a SET change only: with the set fixed, 394's placement (each
level at its own first line) is already right, because under this rule a
container's first line IS the hovered row whenever its handle shows at all.

Four rules it earned:

- **"Top row" is STRUCTURAL, decided by the chain the placement already
  descends.** [`isTopRowOf`](../../../src/text-objects/block-frame.ts) walks
  `GRABBABLE_CHILD_SELECTOR` down from the container — the literal descent
  `resolveFirstLineTarget` performs to PLACE a container's handle — and asks
  whether it arrives at the hovered item. So "is this the top row" and "where
  does the container's handle go" cannot disagree, the answer costs zero rect
  reads, and a WRAPPED first item hovered on its second visual line still
  shows both handles (the geometric reading is the tempting one and differs
  exactly there).
- **The decision is made at the SET, never by computing and discarding.**
  `restrictToTopRowSet` runs inside `resolveTextObjectsAtMouse` on the
  innermost-first chain: keep the item, walk outward, keep a level only while
  it still owns the top row, stop at the first that does not (an inner list's
  non-first item cannot be the top row of anything above it). `computePlacement`
  therefore runs ≤2 times per hover, and the leg that pins it spies the
  non-qualifying levels' first-line rects rather than counting handles — a
  surgical "place every level, keep the ones on the hovered row" paints the
  same pixels on the common case and fails that leg.
- **A non-container ancestor grants nothing.** An outer `listItem` above a
  nested list has no top row of its own to confer, so the walk stops there:
  that is what keeps liB off the inner list's top row in the nested fixture,
  and it is the rule rather than a list special case (the descent is
  `CONTAINER_KINDS`-keyed).
- **394's "travel up the gutter" property is given up deliberately**, stated
  at the renegotiated leg: hovering a deep row shows no list handle, and to
  grab the list you go to its top row. The same-row machinery (353's
  separation, 382's ink cap) now governs the ONE shape that produces two
  handles on a row, and the ink-clearance suite gains level-2 and level-3
  top-row cases with both handles present — measured, the band between the
  floor and the bullet widens by one marker band per level, so two handles
  fit at every depth with room to spare and no "item wins, list dropped" arm
  is needed in the lane resolver today.

CI: the renegotiated [grab-handle-hover-spec.test.tsx](../../../src/text-objects/__tests__/grab-handle-hover-spec.test.tsx)
— 353's per-row set legs and 394's four-handle and travel legs renegotiated in
place with the reason at the site, the nested fixture swept per row, a wrapped
first-item fixture, and the rect-spy leg above — plus the nested legs in
[handle-marker-ink-clearance.test.tsx](../../../src/text-objects/__tests__/handle-marker-ink-clearance.test.tsx).
Measured by neutering the set restriction back to the 394 tree: 8 legs fail;
the 5 that pass are the controls (row 1, the outer top row, the wrapped row 1,
X consistency, the margin lane).

**Owed, not claimed:** the preview eyeball, REQUIRED here — the last two passes
each shipped green and looked wrong. Add a nested list to the dev doc, hover
each row in a real Chrome tab: two handles on a top row, one everywhere else,
none on a bullet.

###### The column half: a CONTAINER has no marker to hug, so it OCCUPIES one

Same gutter, the horizontal axis the last three passes each argued about and
none renegotiated (tasks 483 + 487) — and the case where a placement rule was
right for every block that HAS a marker and VACUOUS for the one kind that does
not.

`markerLeft − gapPx − HANDLE_WIDTH` is a hug: it puts a handle one uniform gap
left of the glyph it labels. A markerless CONTAINER renders no glyph on its own
row, so there was nothing to hug and the rule degraded to a STEP — an arbitrary
`--margin-track-width` off its first item's anchor. Measured live against `main`
on a top-level bullet list's top row (task 483, the audit that found it): the
LIST handle at x 514.5–526.5 and the ITEM handle at 522.25–534.25, a **4.25px
overlap**, with the list winning the z-order across the shared band — so the two
pills read as one ~20px blob and a press in the left of the ITEM's box grabbed
the LIST. With task 480 unfixed that mis-grabbed payload then extracted the item
out of its own list. And the geometry is not width-dependent: both positions are
column-relative constants for a top-level list, so it reproduced at every window
size, on the commonest list shape there is, while task 425's suite claimed "two
handles fit at every depth with room to spare" — true of ITS fixtures.

Gabriel ruled on it directly rather than accepting a separation bump: *"In
bullets, the outer grab handle should justify right under the the bullet point
above. this does require making the depth of the bullet indents slightly
deeper."*

> **A block with a marker of its own HUGS it. A markerless container OCCUPIES
> the marker column of the level ABOVE it — the column its structure hangs
> from, whose glyph sits a row up and which is therefore EMPTY on this row —
> right-justified to that column's inner edge.** Which of the two readings
> applies is decided ONCE, in `block-frame.ts` (`BlockFrame.columnRight`: a
> column, or `null` for "hug your own marker"), never at a call site.

Seven rules it earned:

- **Non-overlap stops being a target and becomes a PROPERTY.** Two levels sit
  in two different marker columns, so their handles are disjoint by
  construction. That is why the ruling beats the surgical answer (raise
  `MIN_SAME_ROW_GAP_PX`): a separation constant is a number someone has to keep
  larger than a width, where two columns cannot coincide.
- **…and it reads as a breadcrumb**, which is the affordance half of the same
  fact: travelling out through the gutter, each handle sits under the bullet of
  the level that owns it.
- **The ITEM anchor had to move WITH it, and that is the non-obvious half.**
  A list `<li>` anchored at the MIDDLE of its measured `padding-left` band — a
  stand-in for a rect the `::marker` pseudo does not give — and the stand-in's
  whole justification ("the glyph stays in the band's right half") is a fact
  about a 2em band, not about the marker. Deepen the band and the middle drifts
  steadily further LEFT of the bullet: the item's handle detaches from the very
  thing it labels and drifts toward the column the container now occupies. So
  where the marker string CAN be measured (`text-metrics.ts`, never a hardcoded
  glyph width) the measurement is the answer for the ANCHOR as well as the INK,
  and the band middle survives only as the fallback for builds that cannot
  measure. Anchor and ink being one number also retires the `min` that used to
  reconcile them.
- **The band is part of the geometry, so widening it is the ruling's price and
  is stated as an inequality rather than a taste.** `.tiptap ul/ol` goes 2em →
  2.5em, and the band must hold one row's worth of geometry whole —
  `band > markerInk + 0.25em trail + --margin-handle-gap + 12px`, the surplus
  being the seam. For a `•` at the shipped 15.2px prose font the right-hand side
  is ≈30.6px against a 2em band of 30.4px: **2em does not fit at all**, and the
  deficit IS the 4.25px overlap 483 measured. 2.5em leaves ~7px. Pinned as its
  own leg, so a future "tidy the indents" is a failing test rather than a
  regression.
- **The separation gets a SECOND pass, and its predecessor's stated reason for
  having only one was a fact about the retired anchor.** 353 pushed INNER
  handles inboard and explained itself: *"the outermost handle is already
  sitting ON the floor … there is no room further out."* True while a container
  stepped a track-width off its item's band middle and normally clamped at the
  floor; false under the ruling, where it sits in a column nowhere near the
  floor. So where the inboard push has run out of lane (an inner handle pinned
  against its own ink) and the pair is still closer than `HANDLE_WIDTH + 6`, the
  OUTER handle gives way into the margin instead, bounded by the lane's new
  `minLeft` (the floor). Nothing on a row lies left of that row's own marker, so
  that margin is free BY CONSTRUCTION — which is what turns the guarantee from a
  hope into an argument. Right-to-left, so a moved handle is re-checked against
  its own outer neighbour; the floor still outranks it, and the resulting
  overlap is the documented degraded state (unreachable under the shipped band
  and 425's two-handle cap).
- **Membership in "lends a column" is the STRONGER question, and `exampleItem`
  is the instructive non-member.** The test is not *does this kind have a
  marker* but *does the structure nested under it hang from that marker's
  column* — same column, empty on this row. A nested `<ul>` is a block child of
  its `<li>`, so it fills the item's content box and its own border-box left IS
  the x the parent's bullet band ends at. An expex item's marker is a GRID cell
  with a 0.8em gap and then a BODY column, so a structure inside it begins right
  of the marker, not under it; right-justifying there would land the handle in
  the gap between marker and text. It is unreachable besides — `exampleItem`'s
  content model admits no list (task 427) — and it is named in the code as a
  non-member precisely so the next reader does not "complete" the set.
- **A container with no column above it is not a special case, it is the OTHER
  reading.** A top-level list, or one inside a blockquote, has nothing to
  occupy, so it takes the ordinary markerless slot — its own content edge, the
  same slot every paragraph handle takes — and lines up with them in the gutter.

CI: the new legs in
[handle-marker-ink-clearance.test.tsx](../../../src/text-objects/__tests__/handle-marker-ink-clearance.test.tsx)
state the contract in TWO tiers, because they have different guarantors. DISJOINT
(≥ `HANDLE_WIDTH` between left edges) is the GUARANTEE — and it is asserted as
PRESS TARGETING, not as a distance: each handle's centre and 2px inside each edge
of its box must resolve to exactly one owner, which is what 483 measured with
`elementsFromPoint` and what a bare distance assertion cannot see. FLUSH UNDER
THE BULLET ABOVE is the RULING, asserted as the one number that states it (the
container handle's RIGHT edge lands on the level-above's content edge), and it
holds wherever the row has room; a nested two-digit `12.` counter eats the room
and the outboard pass trades the alignment for the guarantee — asserted
separately, so a failure says which of the two gave way. Both are swept at two
font sizes and over `ul` and `ol`, since the band is em and the floor, gap-min
and handle width are px, which is exactly why the report reads as intermittent.
The retired rules are RENEGOTIATED in place with the reason at the site rather
than deleted — the band-middle anchor legs, the `min`-tightening leg, the
`markerLeft − trackWidth` container leg, the 2em band pin, and (in
`grab-handle-hover-spec`) "the container handle stays OUT of the margin lane",
whose bound was ALSO 40px too strict for a coincidental reason worth recording:
it read `style.left` (PORTAL space) against a VIEWPORT-space floor and passed by
exact equality on the pre-487 numbers.

Measured by neutering each half in turn: the column rule takes **5** legs (the
four FLUSH sweeps and the geometry leg), the measured item anchor **8**, the
outboard separation pass **1** (the nested `12.` case at 19px — its 28px twin is
a passing control, since the band scales with the font and the wide counter
still fits there), and reverting the band to 2em **1**. The pre-487
`grab-handle-hover-spec` margin-lane leg fails on the fixed tree for the
coordinate-space reason above, which is what forced its renegotiation.

**Owed, not claimed:** the preview eyeball, REQUIRED — three handle passes in a
row have now shipped green and looked wrong, and this one moves every list in
every document. Not FSA-masked. Nested list in the dev doc: hover each row and
compare against Gabriel's mock-up
(`virgil-tasks/attachments/2026-08-25-487-shot-1.png`) — each handle under its
own level's bullet, two visually distinct pills on a top row, none on a glyph.

###### The zone half: the strip that REVEALS a handle is the lane it may OCCUPY

Same gutter, the axis none of the four passes above swept (task 526) — and the
case where the two halves were not two affordances against each other but an
affordance against **the zone that decides whether it exists at all**.

Two things answered *how far left does a grab handle reach?* from different
tables. The handle's extent is **EM-SCALED per block**: its box is
`markerLeft − gapPx − HANDLE_WIDTH` with `gapPx` = `--margin-handle-gap:
0.625em` resolved against that block's own font, and on top of the 12px box
sits the chip-3 hit/hover halo, `--margin-handle-hit-pad: calc(var(
--editor-font-size) * 1.8)`, CENTRED on the box — so the true leftmost reach is
`markerLeft − 0.625·F_block − 0.9·F_editor − 6`. The zone that KEEPS THAT
HANDLE ALIVE was a fixed px constant, `contentLeft − marginInset − 8`, and
`marginInset` is a different concept entirely (`--margin-col-handle-inset`, the
narrow-viewport FLOOR). Leaving the strip nulls `mousePosRef` and the resolver
returns `EMPTY_RESOLVED` — with **no retention while the pointer is over the
handle itself** — so the handle VANISHES as the user reaches for it. Measured
at the shipped defaults: an `\section` heading's target sticks **7.2px** past
the zone, a `\part`'s **10.7px** with three of the visible dots' own pixels
outside it, and the prose paragraph is inside by **0.8px** — a knife-edge that
holds at exactly one point in a 12-step preference range, since the halo
escapes for EVERY block once `editorFontSize > 0.984rem`, i.e. at the very next
slider step. `HOVER_MARGIN_PAD`'s own docstring named the premise that had
expired: *"so the handle (~10px wide) sits comfortably inside"* — sized before
chip 2 made the inset em-scaled and chip 3 added the halo, and revisited by
neither.

> **The strip that REVEALS a handle IS the lane a handle may OCCUPY.**
> `hoverZoneLeft` is [`handleLaneFloor`](../../../src/text-objects/handle-layout.ts) —
> the same expression `resolveHandleLane` floors on — read by
> `computeViewportFrame`. And because the margin has a SECOND occupant, the
> lane is resolved outboard → inboard: the fold-chevron COLUMN places first
> (`BlockFrame.chevronRight`) and the handle takes what remains, box AND halo.

Seven rules it earned:

- **Widening the zone CREATES the chevron collision, so the two halves are one
  task.** The pre-526 refutation of that collision was *"no handle exists while
  the pointer is on the chevron"* — which depended on the very constant this
  retires. The handle is `z-index: 20` in its portal, the chevron `z-index: 1`,
  the halo has no `pointer-events: none`, and their vertical centres coincide
  by design — so clicking the right half of a `\part` chevron would have
  opened the block menu instead of folding.
- **ONE cap, two bounds.** `applyHitCaps` folds the lane's outboard bound into
  the SAME `--margin-handle-hit-cap` the chip-3 sibling clamp writes, rather
  than adding a second inline property — so there is one number and one CSS
  expression, and "the zone contains every rendered handle" is a PROPERTY
  rather than two numbers agreeing.
- **The chevron column is reserved per ROW and gated on the block's KIND**
  (`FOLD_CHEVRON_NODE_TYPES`, derived from `COLLAPSIBLE_NODE_TYPES` plus
  `heading`, in the import-free leaf both layers can reach), never by a DOM
  probe — `glyph-anchor.ts`'s rule: an unconditional
  `querySelector(".source-pod-fold-chevron")` walks a source pod's whole
  CodeMirror subtree once per hover placement. A prose row therefore keeps its
  FULL halo, which at the slider max is 10px per side an unconditional
  reservation would have taken for a chevron that is not there.
- **It is a FLOOR, not a shift.** Only a gap wide enough to reach the column
  moves anything — at the shipped heading sizes that is `\part` alone — so
  every other row's resting position is byte-identical, and so is every row
  task 487's outboard pass was about (a list reserves no chevron).
- **The placement stops taking its own `getBoundingClientRect`.** The floor
  reference is published on the frame (`editorColumnLeft`) beside the inset, so
  the placement and the zone read ONE measurement — which also drops a forced
  layout read per placed handle per hover frame.
- **A test FIXTURE that stubs a wider world than production can produce is why
  no suite could see this.** Every grab-handle fixture in the repo hand-wrote
  its own untyped frame with its own `containsHoverZone`, and each chose a 60px
  leftward zone against production's 30 — so a handle escaping its zone was
  unrepresentable in all of them, and `viewport-frame.test.ts` never mentioned
  `hoverZone` at all. They build through
  [`_handle-frame.ts`](../../../src/text-objects/__tests__/_handle-frame.ts) now, which
  returns the REAL `EditorViewportFrame` type (so a new field is a compile
  error rather than a `NaN` placement) and DERIVES the zone from
  `handleLaneFloor`.
- **`--margin-col-chevron-width` exists because the reservation needs it.** Both
  chevron rules hard-coded `width: 14px` beside a tokenised `left`; the column
  is a token pair now, read by the CSS and by the reserving JS.

CI: [hover-zone-contains-handle-lane.test.tsx](../../../src/text-objects/__tests__/hover-zone-contains-handle-lane.test.tsx)
drives the REAL `computeViewportFrame`, the REAL `resolveHandleLane` and the
REAL `resolveChevronColumnRight`, swept over the font-size slider's ACTUAL
twelve stops × every heading level the app can render (h1's own stepper reaches
3.0rem) × the source-pod kinds. **The leg with teeth is the last describe**: the
two resolvers were never the part that could misbehave — `applyHitCaps`, the
ONE writer of the number the halo is drawn from, is, and it had ZERO coverage
anywhere in the repo. Measured on the fixed tree, deleting its outboard fold
left **all 666 tests** in `src/text-objects` + `src/lib/editor-geometry` green
while the chevron went back under a `\part` heading's halo. So that describe
renders the SHIPPED `TextObjectGrabHandle` over a REAL measured frame and reads
`--margin-handle-hit-cap` back off the DOM. Measured by neutering each half in
turn: the retired fixed-px zone takes 11 legs, the chevron rung 104, and the
halo's outboard fold 10 — with the prose-row control (uncapped, full halo)
passing either way, which is the point.

**Owed, not claimed:** the preview eyeball. NOT FSA-masked (pure geometry over
a live editor), so the unit contract is durable proof and the check is cheap:
put the caret in a `\section`, move the mouse from the prose leftward onto the
six dots — it must not blink out — then click the fold chevron and watch it
fold.

**Residual, stated.** `--margin-col-chevron` is still a fixed px offset while
everything beside it is em-scaled, so a large-font document's chevron does not
move while its handle does. Real, the same species one step out, and a visual
placement change to a shipped affordance rather than a broken interaction —
worth its own pass rather than folded in here.

### The stability half: a card moves only when it must, and then it SLIDES

Same lane, and the case where every mechanism was correct and nobody owned the question of *whether to run it* (task 328). Gabriel: cards jump far too much; the gutter must FEEL STABLE. Two symptoms — a card stack that "resets several times to stay visible" while scrolling, and a perfectly visible card that jumps to the best position the moment you click its linked text.

> **A reposition is sanctioned only when the thing the user needs is not already where they need it.** ONE predicate answers that for both axes a click can move — the CARD (an omni pin, which re-cascades the deck around it) and the DOCUMENT (an `alignEntryToY` scroll of the shared row) — and every door consults it. No call site keeps a private copy.

[src/lib/reposition-policy.ts](../../../src/lib/reposition-policy.ts) is the rule, in four rungs: a sub-`REPOSITION_EPSILON_PX` move is JITTER, not intent ⇒ hold; a rect or band we cannot READ fails OPEN; not FULLY visible in its band ⇒ move; farther from the target than `farThresholdFor(band)` ⇒ move; otherwise hold. Two doors read it — `alignEntryToYIfNeeded` / `scrollEntryIntoViewIfNeeded` ([layout-scroll.ts](../../../src/components/editor-layout/layout-scroll.ts)) for the document, `requestOmniCardPlacement` / `holdOmniCard` ([omni-card-placement.ts](../../../src/components/editor-layout/omni-card-placement.ts)) for the card — and six publishers that each decided for themselves now enter one of them.

Six rules it earned:

- **Necessity (c) needed no rule of its own.** Gabriel named three sanctioned cases: off-screen, very far from its linked text, and a margin-marker click on a card buried in a dense 16-card stack. The third is not a third rule — a buried card's displacement from its own anchor IS what being buried means, so the FAR rung surfaces it. Three stated cases, two rungs; a third would have been a switch nobody could keep in sync with the other two.
- **The fail-open direction is the whole of rung 1, and a DEGENERATE band is "unreadable", not "visible".** A needless move is the pre-328 behaviour and one the user asked for by clicking; a wrongly-held move makes a deliberate click do nothing with nothing on screen to explain it. And a `display:none` keep-alive pane reports a zero-height band while an unrendered wrapper reports a zero-height rect — a naive containment test calls both fully visible (visible span and whole are both 0) and would hold every move for a pane nobody can see.
- **A refused card placement writes NOTHING; it does not write a no-op pin.** A pin at the card's own current top looks deck-neutral and in isolation is (the cascade's forward pass reproduces the value it is then overridden with, and its backward pass is the identity on a deck that already clears). But the store holds ONE pin per deck (per rail until task 583), so publishing it REPLACES whatever pin another card holds — releasing that card to its natural position and re-packing its neighbours. **A "hold" that moves a different card is this bug wearing the fix's clothes.** `holdOmniCard` is the deliberate exception, and the reason the two doors are spelled separately: the wrapper's mousedown freeze exists precisely to install a pin.
- **A jump is TWO movements, and the card's exists only to compensate for the document's — so the pin rides the scroll's verdict.** `jumpToLink`/`jumpToCard` dispatch `virgil-card-jumped` only when `alignEntryToYIfNeeded` reports a real scroll; the handler then asks the card question against the card's POST-scroll rect, which is exactly the right moment — a card the scroll pushed off screen comes back to its marker, one still comfortably in view rides the scroll with the rest of the deck. Renegotiated deliberately: pre-328 the pin froze the clicked card's screen position on every jump, which kept ONE card still by moving all its neighbours.
- **Hysteresis belongs at the ONE place tops commit.** `holdWithinEpsilon` in the measure pass ([useInTextPositions.ts](../../../src/hooks/useInTextPositions.ts)): a pass that would move a card less than the epsilon keeps the committed value, so `measureVersion` never bumps and the deck does not re-render. That is what kills the per-scroll-pause reset — the C5 scroll-idle refinement re-runs on every 150ms pause while approximated items exist, and post-327 its corrections are small, but small and visible are different things. Comparing against the COMMITTED value (never the last measured one) bounds the held error at one epsilon instead of letting a slow real drift integrate. Heights take the tighter `HEIGHT_EPSILON_PX` because they feed the cascade: every card packed below an unchanged card inherits its wobble.
- **A sanctioned move SLIDES, and the hysteresis is what makes that safe.** `.omni-entry-slide` transitions `transform` (the property the cascade already positions with — composite-only, so a moving deck costs no main-thread work) for 180ms, opted IN under `prefers-reduced-motion: no-preference`, and withheld during the pod's arming window and any live layout gesture. Without the hold, this transition would promote sub-threshold jitter from a teleport the eye can miss into a visible glide it cannot — the transition must not turn a stability defect into a nicer-looking stability defect. A freshly mounted wrapper never animates: a CSS transition does not run on an element's FIRST computed value, and a card renders only once `positions` has a top for it.

CI: [gutter-stability-census.test.ts](../../../src/components/editor-layout/__tests__/gutter-stability-census.test.ts) is the leg with teeth — the predicate was never the part that could misbehave, a call site that never asks it is. `omniPinStore.requestPin` may be called only from the placement door, and `alignEntryToY` only from `layout-scroll.ts`, where it is asked PER LINE (exactly two calls: the gated door, and `scrollHeadingToActiveLine`'s Outline click-to-jump — a deliberate "take me there" NAVIGATION and the one exemption in this doctrine). A hit is MIGRATE-it, never an allowlist entry. Beside it, [gutter-stability-doors.test.ts](../../../src/components/editor-layout/__tests__/gutter-stability-doors.test.ts) drives both doors against real DOM into the REAL `resolveCascade`, [omni-pin-anchor-lifecycle.test.ts](../../../src/components/editor-layout/__tests__/omni-pin-anchor-lifecycle.test.ts) drives BOTH renderers of one anchor across an edit (below), and [useInTextPositions-hysteresis.test.tsx](../../../src/hooks/__tests__/useInTextPositions-hysteresis.test.tsx) drives the REAL hook. Every defect leg fails on the pre-fix behaviour (measured).

**Residuals, stated.** The slide's arming window is a wall-clock 700ms rather than a settle signal (the corrections come from independent sources — the settle passes, `document.fonts.ready`, NodeView mounts — and only a timer covers all of them), so a correction later than that animates once. Since task 370 that is deliberate rather than residual: the settle is no longer ~500ms-bounded, and a LATE correction is exactly the case that should glide instead of teleport — see "The settle half" below, and the recalibrated `SLIDE_ARM_MS` docstring, which used to justify its value by a loop that no longer exists. And the rule governs GESTURE-driven repositions: a structural edit that moves a card's anchor still moves the card, which is the card tracking its text rather than jumping away from it.

#### The pin half: an override is stored relative to the anchor, never on the pod

Same lane, and the residual the section above named and left standing (task 362) — reported by Gabriel from a real paper, with screenshots: an archive card and its margin marker in completely different places, the anchor demonstrably healthy (the uuid live in `main.tex`, the `paragraphSnapshot` matching byte-for-byte).

An anchor has TWO renderers. The MARKER is derived live, every measure, from the block's own geometry (`computeMarkerPositions` over `AnchorNodeMetrics.top`) and carries no stored Y at all — `MarginaliaMarker` has no positional field. The CARD was FROZEN: `PinRequest.pinTop` was a pod-relative ABSOLUTE Y, written once by the gesture and cleared only by a replacing pin or the card-lift gesture — never by anything the document does — so `resolveCascade` re-applied the same unexamined number on every pass. Every edit above the anchor moved the anchor, moved the marker with it, and left the card behind — permanently, by a distance that compounds with each edit, while the deck re-packed around the stale Y as well. Nothing throws, the deck is well-formed, and the card is simply beside the wrong paragraph.

> **A persistent override of an anchor-derived position is stored as an OFFSET FROM THE ANCHOR, never as a coordinate on the surface.** The absolute Y is a live function of the anchor, so storing it freezes a derived answer and the two renderers of one anchor can disagree. Stored relative, the invariant holds by construction — which is why there is no expiry rule and no drift threshold.

`PinRequest.offset` is pod-relative pixels from the card's NATURAL top (`coordsAtPos(anchorPos).top − podRect.top`, the number the measure pass already commits for every card); `resolveCascade` re-derives `naturalTop + offset` each pass. Four rules it earned:

- **The conversion happens ONCE, at the publish site, and nowhere else.** A gesture genuinely speaks in screen coordinates ("put it where I clicked"), and the necessity rule (`mayReposition`) is rightly a SCREEN question — is the card visible, is it far from where the user pointed? What is DURABLE about the gesture is its relationship to the anchor, so that is what is stored. `omni-card-placement.ts` does all three conversions (screen → pod → anchor-relative) in one place, which is what lets the store hold a value no later edit can falsify.
- **The anchor reference travels on the DOM, and the door fails CLOSED without it.** The pod publishes each card's measured natural top as `data-omni-natural-top` on the positioned wrapper — the same element the door already resolves, so no registry and no ladder, and the number always belongs to the wrapper the door actually resolved. Stated precisely rather than generously: that INHERITS the door's existing multi-pane semantics (a caller holding its element is exact; the two event-driven publishers still take the `findOmniEntry` lookup, the task-329 shape), it does not improve them — but it cannot introduce a cross-pane mismatch of its own, which a side-keyed registry could. A wrapper with no readable natural top resolves to "nothing to pin", exactly like a missing wrapper: the alternative — fall back to an absolute Y — is the decoupling this retires, arriving back silently on whichever path lost the attribute. It costs nothing, because the pod renders a positioned wrapper only for a card it HAS a natural top for.
- **A pin naming an unmeasured card is INERT, not absolute.** A deleted anchor drops the card out of the natural map; the pin resolves to `null` and the deck re-packs as if it were not there. Same answer as a pin naming a card the category filter has hidden — which pre-362 re-activated at the stale Y the moment the card returned.
- **The reference may be an ESTIMATE, and that is a stated trade rather than an oversight.** A card whose anchor is outside the visible band carries an INTERPOLATED natural (wave-2b C5), refined to exact on scroll idle — and moving an off-screen card is precisely what the necessity rule sanctions, so this is the ordinary path. The pinned card therefore moves by the estimation error when the refinement lands, where a pod-absolute pin was immune to it by construction. Accepted: the correction moves the card TOWARD its anchor (the user's chosen offset, now measured from the truth), it lands on the very next pass because the pin has just brought the card into view, it is bounded by the same interpolation task 327 made non-absorbing, and the 328 slide renders it as a glide. Pinned as a contract, not left to be rediscovered.
- **The lift clears by the WRAPPER's id.** A pin stores the id the wrapper carries, and a multi-anchor card's row is `<key>@N`; `clearPin`'s identity guard declines a mismatch, so the lift gesture's bare-`cardKey` clear silently cleared nothing for exactly those rows and left the pin standing after the card had left the deck. Found while in the code, closed here because it is the same identity fork one field over.

The store header's claim that `OmniViewPanel` cleared stale pins from a `useSelection()` subscription was **stale prose** — there is no such subscription, and the panel's own comment 30 lines away said the opposite. Corrected at the site rather than left standing: a header describing a lifecycle the code does not have is how the next reader concludes the pin is already bounded.

CI: [omni-pin-anchor-lifecycle.test.ts](../../../src/components/editor-layout/__tests__/omni-pin-anchor-lifecycle.test.ts) drives BOTH renderers over one anchor — the REAL `computeMarkerPositions` and the REAL `resolveCascade`, fed by a pin published through the REAL door — and asserts the thing that must not move: their DIFFERENCE across an edit. They speak different origins (marker Ys are host-container relative, card Ys pod-relative), so "the same number" would be the wrong contract; what the defect broke is that neither may move relative to the other without the anchor itself moving. Its defect leg reimplements the RETIRED rule locally rather than re-parameterising the live one, so it fails for the reason it names instead of by arithmetic identity. Measured: neutering the DOOR half alone fails 7 legs, both halves 8.

Two legs carry the teeth, and neither is the invariant leg. The **producer** leg lives in [omni-view-panel-split-contract.test.tsx](../../../src/panels/Omni/__tests__/omni-view-panel-split-contract.test.tsx), because `positions.get(id)` and `naturals.get(id)?.naturalTop` are both `number | undefined` — so publishing the CASCADED top instead compiles, renders, and makes every pin's own reference move with the pin, with every other leg green. And the **census** in `gutter-stability-census` polices the cross-layer attribute name, the `link-dom-contract` (204/255) shape: the reader imports `DATA_OMNI_NATURAL_TOP` and the writer cannot (JSX has no computed attribute name), so a drift would silently disable EVERY omni pin — the door fails closed — with nothing failing and nothing logged.

**Residuals, stated.** The two renderers track together in practice but not *by construction*: they use different primitives (the marker's optical cap-band rect vs the card's `coordsAtPos` line-box), different origins, and different epsilons (the geometry service's 0.5 px bail vs the card's 6 px hysteresis hold), so a 2–5 px reflow can move one and hold the other. That is a sub-epsilon disagreement, not a decoupling, and it is what the contract's ε allows for. The SECOND, independent path to the same symptom this section used to name as an open residual — the omni builders' bare live-uuid gate — is CLOSED by task 369, below.

#### The resolution half: two DRAWINGS of one anchor read ONE resolution

Same lane, one question earlier (task 369) — and the sibling of the pin half above: there the card froze a derived *Y*, here the two renderers disagreed about whether the anchor RESOLVES AT ALL.

A paragraph-anchored card is drawn twice, by two surfaces with no shared owner. The **margin marker** (`EditorPane.marginaliaMarkers`) routed every card through the four-rung anchor-recovery SSOT `resolveCardAnchor` — live uuid → surviving `linkedAnchor` mark → RC1 self-heal → text-snapshot relocation. The **omni card** consulted no resolver at all: each of the six paragraph-anchored builders hand-ran `getLinkedTextObjectIds` + a bare `findParagraphPos(pid)` live-uuid walk, and archive additionally gated on `anchoredArchiveIds`, a `pids.some(live)` fold. **Seven copies of one rule, none of which could see rungs 2–4.**

So the two agreed ONLY on rung 1. For a card whose stored uuid has died but whose `paragraphSnapshot` still matches a live paragraph — the ordinary outcome of a `%!v:` anchor failing to round-trip through the `.tex`, and ARMED FOR EVERY ARCHIVE CLIP, since archive links are created with a snapshot — the margin painted an ordinary marker beside the RECOVERED paragraph while the omni row was binned `pos: null` into the orphan strip. Marker in the margin, card nowhere near it, no error, nothing logged.

> **Where one fact is drawn by two surfaces, it is RESOLVED once, by one authority, and both surfaces READ the resolution.** Neither may re-derive it — that is the fork. The published ROWS are the shared vocabulary: the margin emits one marker per row and the omni one card per row, so their `@N` keying agrees BY CONSTRUCTION rather than by two implementations of one rule staying in step.

[src/links/card-anchor-rows.ts](../../../src/links/card-anchor-rows.ts) is the authority (`buildCardAnchorPass` → `resolve` + the margin's own two-line reader, `buildMarginMarkerRows` / `marginAnchorIndex`); [src/panels/_shared/omni-anchor-rows.ts](../../../src/panels/_shared/omni-anchor-rows.ts) is the omni reader every builder now calls. Six rules it earned:

- **The ROWS are the vocabulary, not the pid.** A resolved card's rows are seeded with `res.paragraphId` — which may be a paragraph that is not among the card's stored pids at all — then every still-live stored pid, deduped and order-stable. Publishing only the resolver's single binding would drop P2..Pn of a healthy multi-anchor card; publishing only the stored pids is the pre-369 defect. This is also what closes `anchorIndexFor`'s recovered-pid gap for free: indexed over the ROWS, a marker click on a recovered paragraph pins the omni row it belongs to, where indexing the STORED pids returned `undefined` and pinned nothing.
- **The authority answers "does it resolve?", never "free or orphaned?"** That second split reads the card's declared intent, and what "a card with no links at all" MEANS differs per panel — an unlinked note is deliberately free by that panel's rule, an archive clip reads its own `unanchored` flag. So the free intent is a parameter of the omni reader and the authority is not entitled to decide it. A card whose stored anchor is DEAD never takes that path: it classifies from the card record, so a lost marker still reads `orphaned` (red) rather than being laundered into `free`.
- **The mount-gap fail-open is inherited, not re-derived.** Against a zero-uuid index every card resolves `orphan` and the re-pin dock flashes, so a not-ready index falls back to the raw stored pids with NO orphan verdict. That guard existed only on the margin side; hoisting it into the authority is what lets both surfaces inherit it. The two are still ALLOWED to differ exactly there — the omni row has no position to show and `OmniViewPanel` drops it while `editor` is null — and nowhere else.
- **It is a net keystroke REDUCTION, and the count is stated per HOST rather than per document, because that is what it is.** `findParagraphPos` was a full `descendants` walk PER PID, so the omni pass cost O(doc · anchors) per items rebuild; the authority builds ONE index and resolves each card in O(1) against it, memoized per card within the pass (a pass has several readers per card — the margin's rows and its click index, the omni row builder, the archive fold — and the ladder must not run once each). Each HOST memoizes its own pass on the DocStructureBus counters plus the reactive editor, and there are up to three per pane: `EditorPane`'s margin pass and one `OmniHost` pass per `PaneRail` (left and right). So a structural keystroke costs up to three index builds, where the pre-fix tree paid O(doc) per pid per items rebuild in two hosts. Plain typing rebuilds nothing. A shared per-editor pass (the `getBus` / `getGeometry` / `getDocProducts` precedent) would take it to one; it is not worth the lifecycle machinery at three call sites, and the honest number is recorded here rather than rounded down.
- **`uuidToPos` rides the walk `buildResolveIndex` already does — and paid for the walk it retired.** The index's own `descendants` pass visits every uuid-bearing node WITH its position, so the position map costs one `Map.set` per node. It also made `uuidToParagraph` derivable as that map's key set, retiring the separate `collectLiveUuids` pass the index used to run first: the index is ONE walk now where it was two. (`collectLiveUuids` was then dead in production and the task-202 link-surface census said so — "a suite is not a consumer" — so it is deleted; callers that want the set read `buildResolveIndex(editor).uuidToParagraph`.)
- **The margin's own pre-check went with them, and it was the LAST place the two could disagree.** Five of the six marker loops opened with `if (getLinkedTextObjectIds(card).length === 0) continue;` — a gate OUTSIDE the authority. A card whose stored pids are empty but whose snapshot (or surviving mark) still resolves is a shipped shape (task 107's Mode-B card with empty `textObjectIds`), and it got an anchored omni row and NO marker at all. The skip is the authority's now: a card with nothing to resolve returns zero rows and the loop emits nothing.
- **A third re-derivation went with them.** `anchoredArchiveIds` (the docked ArchivePanel + float badge) was the same bare gate a third time, so a recovered clip read "orphaned" in the docked panel too. It is now a fold over the authority.

CI: [card-anchor-two-renderers.test.tsx](../../../src/links/__tests__/card-anchor-two-renderers.test.tsx) drives the REAL editor, the REAL authority and BOTH REAL readers — plus one real builder end to end — over the snapshot-recovered card, the genuinely dead card, and the Mode-B mark rung (the only shape where the resolved paragraph is not a stored pid AND live stored pids remain). **No pre-369 suite could see any of this**: each of them drives ONE surface, with the other's answer unrepresentable. Its defect legs reimplement the RETIRED bare-uuid rule locally rather than re-parameterising the live one; measured by neutering the authority to that rule, three fail.

The leg with teeth is the CENSUS ([card-anchor-authority-census.test.ts](../../../src/links/__tests__/card-anchor-authority-census.test.ts)) — the authority was never the part that could misbehave, a call site that never asks it is, and `findParagraphPos(pid)` type-checks perfectly while answering the wrong question. Membership is DISCOVERED from the panels tree, so a new panel is covered by existing. Six legs, and three of them exist because the obvious three were a census of the LAST defect rather than of the question:

- no `omni.tsx` may declare a private position lookup, or read a card's raw stored pids — **and** (the leg that generalizes) may not spell the anchor VOCABULARY at all: no `textObjectIds`, no `.links`, no `state.doc`, no `descendants(`. Grepping only the two names the pre-369 builders happened to use leaves the realistic re-fork route — read `card.links[0].anchor.textObjectIds[0]`, walk the doc yourself — passing every leg.
- the one exemption (the Errors builder, whose paragraph id comes from the diagnostics pass, not from a card's links, so it has no ladder to run and no second renderer to agree with) must still cover a REAL offender. Asserting the exempted FILE exists is satisfied by every panel folder; an exemption that has stopped excusing anything is a standing licence for the next private lookup under the exempted name.
- the omni readers are an EXACT SET (every builder that TAKES the authority READS it, and vice versa), not a count floor — a floor lets a 7th adopter mask a builder that regressed, which is the per-file-vs-per-handle failure the pane-drag census records, one level up.
- both hosts must build the pass, the margin must read it through the shared reader, **and the `anchoredArchiveIds` fold must too**. That fold badges the docked panel and its float, it lives inline in `EditorPane`, and no suite mounts it — so without its own leg the commit's claim to have retired the third copy was pinned by nothing.
- nothing outside the authority and the load-time `useReconcileModeAAnchors` MUTATOR may call the recovery ladder at all. Stated limit: that leg greps the two symbol names and walks `src/` only, so an aliased import would evade it.

Measured on the pre-369 tree, the legs name six builders twice, `EditorPane`, both hosts, and the archive fold.

Same pass deleted `getParagraphAnchorPositions` — an EXPORTED helper resolving `pids[0]` with zero production callers, stating a different rule from the live one (`jumpToCard` uses "first RESOLVABLE link"): the task-202 dead-SSOT shape, WIRE-it-or-DELETE-it.

**The residual this left, and its retirement (task 655).** 369 recorded — here and at the field — that `OmniAnchorRow` published TWO facts and the six builders picked between them: `anchored` (the authority's verdict + a resolved position) and `anchorUuid` (merely "the card stores an anchor"). Only Archive gated its Jump on the first; the other five kept their own pre-369 rule byte-for-byte, so a card whose anchor was UNRECOVERABLE rendered, in five panels, a Jump that `jumpToCard` resolves to nothing — the false-affordance class ("what the hover OFFERS is what the commit ACCEPTS"). Declining to renegotiate an affordance inside a refactor was right; leaving it unfiled for a month was not.

> **Where a surface publishes a predicate for each renderer to choose from, the renderers WILL choose differently — so publish the DECISION, not the predicate.** The row now carries `withJump(handler)`, which returns the handler or `undefined`; a builder hands its callback over and never sees a boolean. Five wrong call sites were the symptom; a builder being handed a choice at all was the defect.

Archive's rule is what ships for all six (WITHDRAW the control), because it was already the behaviour in one of the six and so is not a new idea in the product. The alternative — keeping the control and routing it to the margin's re-pin gesture (`UnanchoredCardsChip`'s "click to re-pin") — is a real feature and belongs to its own task, not to a correctness fix. `omni-jump-gate.test.tsx` holds it: the behavioural sweep drives ELEVEN card kinds through the six REAL builders (dead anchor ⇒ no handler; live anchor ⇒ a handler, so nothing real is withdrawn), and the census DISCOVERS the builder population from the tree (every `src/panels/*/omni.tsx` that imports `buildOmniAnchorRows`) and pins that each routes its `onJump` through `row.withJump` and re-derives no predicate — `anchorUuid !=`, `rows.some(`, and Archive's own restated `row.anchored ?` all banned. Pre-fix the dead-anchor sweep fails on five panels and passes on Archive; that asymmetry is the finding.

**Verification, honestly:** this class is FSA-masked (anchor recovery only reproduces under real prod File System Access — the dev preview's uuids round-trip), so the durable proof is the unit contract above and a real-FSA eyeball is *owed*, not claimed.

**The unswept members, and the reason they existed (task 665).** 655 took the boolean out of the OMNI builder's hand; the FLOAT surface still held one, and nine of its builders derived it from `getLinkedTextObjectIds(card).length > 0` — link PRESENCE, "the card stores an anchor", the very predicate 655 had just banned one surface over. They existed for a structural reason, not a careless one: `PoppedCardDeps` carried only `anchoredIds`, the ARCHIVE-specific fold, so archive gated correctly (435) and the other nine had no general resolver to ask. Two more members rode the same shape — `EditorPane.sortedArchiveSnippets` ran its own live-uuid `doc.descendants` walk directly below `anchoredArchiveIds`, which reads the authority (so one clip was badged anchored and sorted into the orphan tail in the SAME row), and `resolveLink` tried the mark and the uuid and stopped, so `jumpToCard` returned `false` for a card every gate above it called anchored.

> **A kind-specific door is how a general question comes to be answered by a weaker predicate — and a gate with more rungs than its act is a claim the app cannot honour.** The bag now carries the AUTHORITY (`resolveCardRows`, spelled as `omni-host` spells it); `WithJump` / `PASS_JUMP` / `NO_JUMP` / `cardJumpGate` / `staticJumpGate` live beside it in `card-anchor-rows.ts` and BOTH readers import them, so there is one pair of implementations rather than two; the shared `cardFloatable` shell derives both halves of 136's rule from the gate, so exactly one `canJump:` exists in `src/cards/floats/index.tsx` and it is the shell's; `sortCardsByResolvedAnchor` becomes the THIRD reader of the shared rows; and `resolveLink` gains the snapshot rung, matched through the authority's own `normalizeParagraphText` (NOT the legacy raw-`textContent` helper, which would have re-opened the disagreement by one space).

The census had to widen from the LITERAL to the PREDICATE: 435's leg flagged a hardcoded `canJump: true` beside a resolved answer, and link-presence is neither, so nine offenders were structurally invisible to it. It now bans any `getLinkedTextObjectIds(...).length` verdict in a builder region, requires every card-anchored kind to spell `cardJumpGate(card, ctx.resolveCardRows)`, and caps the file at one `canJump:`. Allowlist EMPTY. Kinds whose reachability is resolved ELSEWHERE (footnote atom, atomless ref, citation pos, example block, bib) say so by name through `staticJumpGate`, so "resolved elsewhere" stays distinguishable from "never asked". Legs measured against the pre-fix tree: 20 fail in `float-jump-agreement.test.tsx`, 3 in the new `anchored-predicate-agreement.test.tsx`, whose M2 leg REIMPLEMENTS the retired walk rather than re-parameterising the new helper — a new helper proves only its own self-consistency. Same FSA-masking caveat as above: the real-FSA eyeball is *owed*.

##### The chrome half: a float is the THIRD renderer, and it never states an answer its own body is about to contradict

Same law, the POPPED-OUT surface (task 435) — and the case where the resolution
was correct, three of a kind's four renderers read it, and the fourth stated
`true`.

`FloatChrome` paints the jump chevron on exactly ONE input (`Floatable.canJump`),
so a float's `canJump` **is** the affordance. Task 136 derived it for `citation`
(`pos !== null`) and task 277 for `footnote` (the anchored/unanchored fork); the
same family's other two members were never swept, and they are the two where the
contradiction is visible on screen:

- **`archive`** — the builder computed `orphaned` from `ctx.anchoredIds` (a fold
  over the task-369 authority, `anchorPass.resolve(s).anchored`) two lines above,
  used it for the BODY, and handed `canJump` a literal. `orphaned === true` means
  the four-rung ladder found nothing, which strictly implies `resolveLink` finds
  nothing, so `jumpToCard` iterates the links, resolves none, and returns `false`
  having done nothing. Archive's other three renderers all gate correctly — the
  docked card on `!orphaned`, the omni card on `row.anchorState`, the margin
  marker on the authority itself — so the float was the ONE surface out of step.
  (This is not the residual "The resolution half" records: that named the five
  OMNI builders gating on `anchorUuid` and explicitly EXEMPTED Archive — task
  655 has since retired it. The float surface below is a SEPARATE copy of the
  same fork and is not covered by that fix: `ctx.anchoredIds` is an
  archive-only fold, so the other five float builders still gate `canJump` on
  `getLinkedTextObjectIds(card).length > 0` — "the card stores an anchor," the
  predicate 655 banned one surface over. Giving the float ctx a
  kind-independent fold is the next member of this cluster.)
- **`textobject`** — a text-object float OUTLIVES its source, the body already
  detects that (`useFloatMainSync` → `sourceMissing`) and already announces it
  ("Source paragraph deleted — float is disconnected"), and the chrome above the
  banner kept a live chevron whose handler called `scrollToParagraphId` on a uuid
  the document no longer has. One 24px strip contradicting itself.

> **A float is the THIRD renderer of a card's anchor question: it READS the same
> resolution the docked card and the margin marker read, and it never asserts one
> statically when the body it wraps is about to contradict it.** Where the fact is
> resolved per FloatHost render it is read in the builder; where it can change on
> a transaction that never re-renders FloatHost, it travels UP from the body that
> observes it.

Six rules it earned:

- **Gate the AFFORDANCE and the HANDLER** (136's own rule), so a keyboard or
  programmatic path cannot reach the dead call.
- **`anchoredIds` is REQUIRED on the deps bag**, not `anchoredIds?:` — the
  reason `unanchoredFootnotes` states one field up ("a bag that can omit it would
  silently reinstate the blank-float case for every host that forgets"). The
  optional form is precisely what made `orphaned` silently `undefined`.
- **The channel carries the FACT, never the AFFORDANCE.**
  [float-source-report.tsx](../../../src/floats/float-source-report.tsx) reports *the
  source is missing*; `FloatWindow` derives `canJump && !sourceMissing` from it.
  A `setCanJump` channel would be the body RESTATING the chrome's decision, and
  the next chrome element depending on the same fact would need a second channel.
- **The BANNER is the reporter.** `SourceMissingBanner` — mounted iff the user is
  being told the source is gone — declares the fact for its lifetime, rather than
  a setter threaded through `FloatBodyContext` → `TextObjectFloatBodyProps` →
  each of the TEN float bodies. Threading is a per-body obligation, i.e. ten
  chances to forget and a new body that inherits nothing; binding the report to
  the banner's mount makes the agreement STRUCTURAL — you cannot paint the banner
  without withdrawing the chevron, and a body that detects a missing source and
  tells the user nothing reports nothing, which is correct, because the user is
  not being told either.
- **Keystroke sanctity is untouched**: the effect runs on the banner's MOUNT and
  UNMOUNT — the present↔missing EDGE — never per transaction.
- **The static half survives.** `Floatable.canJump` still means *what this KIND
  can ever offer*; the live half is the body's report, and the WINDOW combines
  them. A kind that offers no jump stays jump-less however its body reports.

CI: [float-jump-agreement.test.tsx](../../../src/floats/__tests__/float-jump-agreement.test.tsx)
builds the REAL archive `Floatable` through `CARD_REGISTRY` and drives the REAL
`FloatWindow` over a body running the REAL `useFloatMainSync` against a REAL main
editor whose paragraph is then deleted — the contract being that the header and
the banner AGREE, not that either is right alone. **No pre-435 suite could see
any of this**: every float suite drives the CHROME with a hand-supplied
`canJump`, so a builder's literal disagreeing with its own body is
unrepresentable in all of them. The leg with teeth is the CENSUS — the builders
were never the part that could misbehave, one that resolves an anchor answer and
then hands `canJump` a literal is, and that type-checks perfectly. Regions are
discovered per `registerCardFloatable("<kind>"` (allowlist EMPTY), and the split
being per-BUILDER is itself pinned: a `cardFloatable(`-keyed split puts the
archive registration inside the FOOTNOTE builder's region, which — measured —
made the archive leg pass under its own neuter. Measured by neutering each half
in turn: the archive gate takes 3 legs, the window's derivation 2, the banner's
report 2.

**Owed, not claimed:** a preview eyeball. The archive half is FSA-masked (real
anchor death reproduces under prod File System Access), so the durable proof
there is the unit contract; the text-object half is NOT masked — pop a paragraph
out, delete it in the main editor, and look at the float's header.

###### The preview half: a preview shows what the RELEASE produces

Same header, one moment earlier (task 437) — and the case where the two
renderers were declared to be one component, in four files, by prose alone.

Dragging a text object out of the document shows a **lift ghost**; past the
popout threshold it grows a header bar, and on release that ghost becomes a
real float. Those two headers are the same thing or the handoff moves. They
had not been for months: `FloatChrome` gained a 14px `FloatGrip` as its FIRST
child and a (re)anchor **drop** button (which `textObjectFloatable` sets
`canDrop: true` for unconditionally, so it is on EVERY text-object float), and
the ghost's own `FloatHeaderContent` gained neither. The arithmetic, from the
shipped utilities (`px-2`=8, `gap-1`=4, grip `p-0.5` around a `width=10` svg,
`-ml-1`=−4): ghost label at `+9`, float label at `+23` — **a ~14px jump on
release**, plus one `w-4` button and one gap of extra width on the right.

> **A preview shows what the release produces, so the two render the SAME
> children — ONE component.** Where the CONTAINERS genuinely differ (they are
> positioned by different owners), a census states what may not: the leading
> inset, the gap and the height, because that inset is where the label lands.

Six rules it earned:

- **The fork was in the CHILD ROW, not the container**, so that is what became
  one thing: `FloatChromeContent` (the grip · title · spacer · trailing · jump
  · drop · close row) is exported from `FloatChrome` and mounted by exactly two
  places — `FloatChrome` itself (the release) and `LiftedTextOverlay` (the
  preview). `FloatHeaderContent` is DELETED, which is the honest end state for
  a component whose stated purpose was to be shared with a file that no longer
  exists. Adding the grip and the drop glyph to it instead was the alternative
  and was declined: it re-creates the shared fork one level up.
- **`inert` is a SUBTREE claim, and that is why the per-button one was not
  enough.** The preview's close button is a `PopoutButton`, whose API has no
  `tabIndex` seam — so under `pointer-events: none` + `aria-hidden` it was a
  focusable control inside a hidden subtree, the shape "Pane-drag stability"
  already outlaws for divider chrome. The ghost's container carries the HTML
  `inert` attribute; the content attaches no handler at all.
- **The prop type is a DISCRIMINATED UNION** (`{ inert: true }` forbids the
  handlers; the live arm requires them), so a preview cannot be handed a
  handler and a live mount cannot forget one. A defaulted no-op would be a
  decision nobody made.
- **The container inset is spelled twice and PINNED as a mirror.**
  `FLOAT_CHROME_CONTAINER_CLASS` (`px-2 gap-1 h-6`) and globals.css
  `.lifted-text-overlay__header` (`padding: 0 8px; gap: 4px`, height
  `CARD_FLOAT_HEADER_H`) — CSS can't import TS, so the census reads BOTH
  spellings. A drift between them IS a label jump.
- **The four false SSOT claims are renegotiated in place with the reason at the
  site**, never quietly deleted: they pinned a defect as the contract, and the
  1px correction the overlay's Issue-6 comment records was REAL — what it could
  not survive was a 14px element being inserted in front of the label it
  described. Both halves are load-bearing now and both are pinned.
- **The same sweep closed eight more stale claims** naming the deleted
  `TextObjectFloat` as a live chrome (four in `globals.css`, four per-kind body
  docstrings plus `types.ts`, `floats/index.ts`, `text-object-registry.ts`) —
  the "Bar occupancy" shape, and the reason a census is a phrase-vocabulary
  rather than a name grep: a note saying a claim USED to hold is wanted; a live
  claim is not.

CI: [lift-ghost-header-parity.test.tsx](../../../src/text-objects/__tests__/lift-ghost-header-parity.test.tsx)
renders the REAL ghost header and the REAL `FloatChrome` for the same
text-object float and compares a signature derived from what the user can
PERCEIVE (the `aria-label`s `iconHint` stamps, plus the one decorative child
that publishes none) — never a test-only `data-*` marker, which would be a
signature only the test can see. **No pre-437 suite could see any of this**:
both suites that render the overlay `vi.mock`ed the header content to
`() => null` for module weight, so the one thing that would have failed was the
one thing both stubbed out — they render it for real now. Measured by neutering
each half in turn: the pre-437 child row takes 4 legs, the `inert` attribute 1,
a re-forked private row 1 (the census), and a live `TextObjectFloat` claim 1.

**Owed, not claimed:** the preview eyeball. NOT FSA-masked (a live pointer
gesture, no disk), so the check is cheap and real — lift a paragraph out slowly
and watch the header label at the moment of release.


###### The archived half: the fact was `archived`, and the omni was the renderer that never read it

Same law, a different FACT (task 476) — and the case where the SSOT's own doc
comment named the surface that never received it.

An archived card lives only under its home panel's View Archives/All, and that
fact has three renderers in one window. Two read `EditorPane.archivedIds` (the
docked list through `getArchived`, the margin markers and the task-410
unanchored chip through the set itself). The OMNI never received it: the rule
was re-derived twice and incompletely — a local `active()` helper in
`omni-host` applied to six of the ten families, a private
`if (ref.archived) continue;` inside the footnote builder, and **citations
covered by NEITHER**. So archiving a citation spliced its `\cite` out of the
`.tex`, hid it from the panel and the margin, and left it rendering in the omni
"N unplaced" bin FOREVER, with the chip beside it counting zero for the same
card and the count growing with every citation the user ever archived. The set's
own comment had always said it drives "the in-document exclusion (margin
markers, highlights) **+ OmniView**".

> **A per-item rule with N producers is applied to the ASSEMBLED array, once, at
> the ONE place the items become a list — never as a per-producer obligation.**
> A producer can skip an obligation by OMISSION and nothing anywhere notices; a
> filter over the assembled array covers the eleventh producer by existing.

[src/panels/Omni/omni-archived.ts](../../../src/panels/Omni/omni-archived.ts) is the rule
(`filterArchivedOmniItems` / `omniItemIsArchived` / `omniItemCardRef`), read
once in `omni-host`'s `items` memo. Five rules it earned:

- **The vocabulary is the ID the builders already publish.** Every
  `OmniItem.id` is `cardPopKey(kind, id)` (`float:card:<kind>:<id>`), optionally
  `@N`-suffixed for a multi-anchor row, so the filter parses `(kind, id)` back
  out through `parseFloatKey` — colon-safe, since a card id can carry interior
  colons — and needs no new field and no per-builder change. The alternative (a
  REQUIRED `cardId` on `OmniItem`, a compile error for a builder that forgets)
  is this repo's usual shape and was declined here for a stated reason: it makes
  the rule a per-builder obligation again, which is the class being closed.
- **Reading the SAME set is what makes the surfaces agree BY CONSTRUCTION.**
  `archivedIds` is kind-blind (raw card ids across every panel — exactly what the
  margin tests `m.entityId` against), so the omni asks the identical question
  rather than a parallel one that has to stay in step. The `isArchivable(kind)`
  gate adds no discrimination against that set; it is a cheap statement of SCOPE,
  so a non-archivable kind (`example`, `error`) whose entity id somehow collided
  could never be dropped by this rule.
- **The prop is REQUIRED on `OmniHostProps`**, not optional — the reason
  `unanchoredFootnotes` states one field up: a bag that can omit it silently
  reinstates the defect for every host that forgets.
- **Retiring `active()` costs O(archived) cheap object allocations per items
  rebuild, and that is stated rather than rounded away.** Archived cards now
  reach the builders and are dropped after; `resolveCardRows` is an O(1) map
  lookup and `content` is a `createElement` (never a mount), and the memo
  rebuilds only when a sidecar collection or a selection id changes — off the
  keystroke path. The structural guarantee is worth the allocations; keeping the
  pre-filter as an "optimisation" would be the two-implementations shape again.
- **Identity-stable when nothing is archived** (the common case), so downstream
  memos stay cached.

CI: [omni-archived-rule.test.ts](../../../src/panels/Omni/__tests__/omni-archived-rule.test.ts)
sweeps every kind `isArchivable` declares (single-anchor AND `@N` rows, each with
its accepting control), drives the REAL citation / footnote / note builders, and
pins the two non-regressions (an ACTIVE unanchored citation still surfaces —
task 056/079; archived-then-UNarchived returns). The leg with teeth is the
CENSUS: the rule was never the part that could misbehave, an eleventh builder
re-deriving its own `archived` gate is, and a host that assembles items and never
asks is — so no `omni.tsx` may spell `archived` at all, the builder population is
DISCOVERED from the host's own import list, and the host must call the door
exactly ONCE against `p.archivedIds`. The task-077 leg in
`anchor-state-classify-contract.test.ts` is RENEGOTIATED in place with the reason
at the site: it asserted the BUILDER dropped the archived ref, which pinned the
per-builder derivation as the contract. Measured by neutering each half in turn:
a pass-through filter takes 28 legs, a re-forked footnote gate 3, a host that
stops asking 1, and a restored `active()` helper 1.

**Owed, not claimed:** the preview eyeball. The derivation is pure and NOT
FSA-masked, but the visible symptom needs a real doc — archive a citation and
watch the gutter's "N unanchored" bin drop it (task 544 merged the
"N unplaced" pill into that bin and retired the chip to a fallback).

**Related, checked and deliberately NOT folded in.** `citedKeys`
([BibliographyPanel.tsx](../../../src/panels/Bibliography/BibliographyPanel.tsx)) iterates
ALL citations including archived, so an archived citation still marks its bib
entry "cited", survives the *Cited entries only* filter and lands in the exported
`cited.bib`. Real, same root — but whether "cited" means *has a live `\cite` in
the `.tex`* or *is referenced by a citation card* is a product call, and an
over-inclusive `cited.bib` is harmless to LaTeX.

###### The chrome half: the SSOT's own comment named the surface that never read it

Same fact, the renderer 476 could not reach (task 497) — and the case where the
authority's doc comment listed a consumer that had never been written.

Gabriel, from a real paper: *"When a note is associated highlighting, and the
note is archived, the highlighting should disappear. (the highlighting should be
structurally linked to the presence of the note)"*. `EditorPane.archivedIds` had
five consumers — margin markers, the re-pin chip, the omni filter (476), the
archive glyph and the jump re-check — and **none of them was the in-document
Mode-B span layer**, though the set's own comment claimed it drove "the
in-document exclusion (margin markers, **highlights**)". 476's class, one word
over.

A note's `linkedAnchor` mark renders through three UNCONDITIONAL CSS paths keyed
on statically-rendered attributes, so archiving — correctly a pure sidecar flag
toggle, with the mark deliberately kept alive as the anchor a restore needs —
removed nothing from the prose: the per-kind 18% wash (gated only on the GLOBAL
highlight prefs), the `!important` tint band (gated on **nothing at all**, and an
archived *highlight* card's entire in-text identity, since `highlight` has
`markerType: null`), and the hover / selection washes an archived card still
painted when touched from the Archives view.

> **The mark's persistence is right; the CHROME's persistence is the bug.** An
> archived card draws no anchor chrome — marker, band, rail, omni row, hover or
> selection wash — and the rule is stated ONCE in
> [archived-anchor-chrome.ts](../../../src/links/_shared/archived-anchor-chrome.ts) as
> TWO PROJECTIONS of one predicate over ONE collection list, because the surfaces
> are keyed differently: `archivedCardIds` for everything keyed by card id, and
> `archivedAnchorIds` for the DOM-keyed span sweep.

Six rules it earned:

- **The two keys are not interchangeable, and that is the whole reason the
  authority publishes both.** On reload `applyLinkedAnchors` deliberately
  re-stamps with an EMPTY `linkCard`, so a restored span reads
  `data-link-card="note:"` — kind token present, **card id absent**. A sweep
  keyed on the card id parsed back out of the DOM works in-session and silently
  dies after every reload; `data-link-id` (the anchorId) is the stable key, so
  the archived CARD set is PROJECTED into an archived ANCHOR set rather than
  recovered from the span.
- **Hiding is an ATTRIBUTE, never an `unsetMark`** ("Transient state is never
  document content"). One `data-anchor-archived` stamp and one CSS rule; the
  document is byte-identical in both directions, pinned as its own leg.
- **`background: none !important` is REQUIRED, and so is the rule's POSITION.**
  The tint band carries an `!important` of its own and paints from `--tint-color`
  rather than `--link-anchor-color`, so nothing but a later `!important` at equal
  specificity turns it off — which makes "after every other `.linked-anchor`
  background rule" a load-bearing fact about the file, censused rather than
  assumed.
- **The in-editor gate sits in `collectTargets` and deliberately NOT in
  `collectCardKey`** — the reconciler collects the two separately precisely so an
  archived card can stop painting into the DOCUMENT while its own row in the
  Archives list still highlights. That is what closes M5 rather than leaving it a
  stated follow-up.
- **Both props are REQUIRED**, for `panelSides`' reason: an optional prop with an
  empty-set default lets a future refactor drop the one line that passes it and
  silently restore the pre-497 behaviour, with no type error and no test failure.
- **The sweep re-runs on the DocStructureBus, and the two redraw shapes were
  MEASURED rather than reasoned about.** A structure-PRESERVING `setContent`
  leaves the span element in place (PM matches and reuses the `MarkViewDesc`), so
  the stamp rides through unaided and the bus correctly stays silent; a
  structure-CHANGING one builds fresh DOM, and that is exactly what
  `onAnyChange` reports. The channel is `emitCount`-gated, so typing fires it
  zero times. Residual, stated: a MARK-ATTRS re-stamp recreates the span without
  waking the bus — but every such re-stamp is driven by a card record change,
  which mints a fresh set upstream and re-fires the effect through its own deps.

CI: [archived-anchor-chrome.test.tsx](../../../src/links/_shared/__tests__/archived-anchor-chrome.test.tsx)
drives the REAL `useLinkHighlight` and the REAL `useAnchorHighlightReconciler`
against a REAL main-stack editor whose paragraph carries TWO `linkedAnchor` marks
— one archived, one active — because a leg with a single span passes on an
implementation that turns EVERY span off. Its fixture stamps `linkCard: "note:"`,
which IS the post-reload shape, so a card-id-keyed fix cannot pass. **No pre-497
suite could see any of this**: `useLinkHighlight` had NO suite at all and
`data-show-hl-` was asserted nowhere, so the whole sweep it owns was unpinned;
and every reconciler fixture in the repo is UNARCHIVED, so a card whose chrome
must not paint is unrepresentable in all of them. The leg with teeth is the
CENSUS — the authority was never the part that could misbehave, a surface that
draws anchor chrome without asking it is, and `archivedIds.has(...)` re-derived
in EditorLayout would type-check perfectly. Measured by neutering each half in
turn: the pre-497 absent sweep takes 4 legs, the reconciler gate 2, the bus
re-stamp 1, the CSS rule's position 1, and a layout that re-derives instead of
reading `PaneState` 1.

**Owed, not claimed:** a real-FSA eyeball. Mode-B anchors and sidecars are the
FSA-masked class, so the durable proof here is the unit contract — archive a note
with a highlight, watch the wash vanish; unarchive, watch it return; reload and
re-check both.


#### The height half: a retained measurement is invalidated by the EVENT that changes it

Same lane, the OTHER number the cascade consumes (task 490) — and the case
where a cache's justification was written down, was true of ONE of its inputs,
and was read as a licence to have no invalidation at all.

Gabriel, from a real paper, in two reports nine minutes apart: *"This archive
card should be lined up with its margin item"* and *"archive cards are
displacing to the same extent as they would be when open."* The second is the
mechanism, and it is arithmetically exact.

**The height half.** `realHeightRef` retains a card's last real height across the
±`NEAR_ZONE_PX` viewport gate (task 043), justified by *"a card's rendered height
is scroll-invariant, so a height read once stays truthful after the card scrolls
out."* That is true of SCROLL and false of everything else a card does: it
COLLAPSES, EXPANDS, swaps presence tier, or finishes laying out a late font /
KaTeX span / image. Its only writer was the measure pass's own
`getBoundingClientRect`, and that read is gated TWICE — the pos-band route
(`deferredItems`) and the `inViewport` px gate — **both asked of the ANCHOR**,
never of the card, while the cascade is precisely the mechanism that makes those
two differ. So a card that shrank while its anchor was out of band kept its
OLD, TALLER height and `resolveCascade` went on reserving it. The hole is
SYMMETRIC: a card that GREW out of band keeps a too-SMALL height and the next
card packs on top of it — the task-043 overlap this cache exists to prevent,
arriving from the other side.

**The pin half.** `holdOmniCard` fires on EVERY non-control mousedown on an omni
card, SKIPS the necessity rule its sibling door asks (`if (desired !== "hold")`),
and stores `cascadedTop − naturalTop` — the displacement the CROWD gave the card
at press time. Nothing ever clears a pin (`omni-pin-store`: "Nothing else clears
one"). So the moment the crowd changes — the card above collapses, its stale
height heals, a passage is archived away — the deck's own answer moves and the
pinned card does not: it stays displaced by an amount the deck no longer
requires. Pressed while the deck was full of EXPANDED cards, it is thereafter
"displacing to the same extent as it would be when open", permanently.

> **A retained measurement is invalidated by the EVENT that changes it, never by
> a proxy for the card's visibility — so the per-card ResizeObserver is the
> height AUTHORITY, not merely a trigger. And a HOLD is a freeze through a
> transient: where there is no transient there is nothing to freeze, and it
> writes NOTHING.**

Six rules they earned:

- **The observer already knows.** It fires on every height change, for every
  rendered card, wherever it sits, and its entry carries the new size
  POST-layout — so recording it forces no layout and needs no gate. The
  near-zone gate exists to skip a FORCED read; there is no forced read here.
  `noteObservedHeights` is therefore a REDUCTION in work, not an addition: the
  pass's rect read stays only as the SEED for a card the observer has not
  delivered yet.
- **BOOKKEEPING FIRST, ALWAYS.** The RO records before it calls `requestSettle`,
  because every gate below that door (hidden pane, the re-show suppression
  window, typing in a card body, the degeneracy guard, the convergence budget)
  can make the pass commit nothing — and none of them is a reason to forget what
  the observer just SAW. The geometry service's own rule, one lane over
  ("The scroll half": *defer the MEASUREMENT, never the BOOKKEEPING*).
- **A ZERO is not a measurement.** A `display:none` keep-alive pane reports 0×0
  for everything and an unpainted wrapper reports 0; writing either packs the
  whole deck contiguously from the top, which is the shape `measure()`'s own
  hidden bail exists to prevent. Skipping keeps the last good value — which IS
  the retain-across-a-hide contract.
- **BORDER box, to match the seed.** The pass writes
  `getBoundingClientRect().height`; `contentRect` is the CONTENT box. They
  coincide for the wrapper the omni renders — but two writers of one cache must
  not speak two boxes, so `borderBoxSize` is preferred with `contentRect` as the
  fallback.
- **A hold on a pin-free side writes NOTHING**, and that is provable rather than
  cautious: `resolveCascade`'s forward pass sets row *i*'s top from its
  PREDECESSORS alone, so a card's top is independent of its own height, and the
  backward (up-pulling) pass — the only thing that can make it depend on it —
  runs ONLY when a pin exists and is the IDENTITY unless the pin moved its card
  above the forward answer.
- **A hold never stores an offset ABOVE the anchor.** A hold's whole content is
  "the deck put me here", and the deck's own rule never puts a card above its
  anchor; a negative offset is another card's pin showing through, and freezing
  it makes this card permanently contradict its own margin marker — task 362's
  decoupling arriving through the offset instead of through the coordinate.

CI: [useInTextPositions-height-authority.test.tsx](../../../src/hooks/__tests__/useInTextPositions-height-authority.test.tsx)
drives the REAL hook with a DELIVERING ResizeObserver over a card whose anchor
is scrolled INTO the band (the only way the pre-490 code could seed the cache)
and then away. **No pre-490 suite could see any of this**:
`useInTextPositions-retained-height` is pure and pins only the SHRINK-PROTECTION
direction ("never re-collapse to the 60px placeholder"), where a card that got
SHORTER out of band is unrepresentable; and **no suite in the repo ever
DELIVERED a per-card ResizeObserver entry** — `settle-convergence` installs a
deliberate NO-OP stub — so the one trigger a collapse actually has was untested
end to end. The door legs live in
[gutter-stability-doors.test.ts](../../../src/components/editor-layout/__tests__/gutter-stability-doors.test.ts),
whose pre-490 freeze leg (an EMPTY store, asserting a hold always writes) is
RENEGOTIATED in place with the reason at the site, as is its twin in
`omni-pin-anchor-lifecycle`. Measured by neutering each half in turn: the pre-490
one-writer cache takes 2 legs, the zero guard 1, the pin-free hold rule 1, and
the above-the-anchor refusal 1.

**Owed, not claimed:** the real-paper eyeball. Both halves are FSA-masked for
Gabriel's own document (archive anchors and a card-dense deck), so the durable
proof here is the unit contract — collapse an archive card whose anchor has
scrolled well off screen, then scroll back and watch the deck below it close up.

**Residual, stated.** A card whose `entry` selector is a FUNCTION rather than an
attribute name cannot be inverted from an observed element, so it keeps the
pre-490 behaviour; the only production caller passes the string form. (The
hold's second residual — "the pin-free rule is deliberately CONSERVATIVE" — was
not safe, and is CLOSED by task 583; see immediately below.)

##### The reach half: a guard keyed on "any X exists" is not a guard, when X is never cleared

Same door, one question narrower (task 583, an audit finding). 490's hold rule
asked only *is ANY pin standing on this side?* and called the approximation the
safe direction. It was not, because a live pin is never cleared except by a
replacement: after ONE marker click every later press on a card BELOW the pinned
one passed the rule, REPLACED the pin (the pinned card snapped back — a visible
jump of a card the user did not touch) and froze the pressed card at the crowd's
displacement — 490's bug verbatim, re-armed for the session. A pin naming a card
no longer in the deck (archived, deleted) is inert in the cascade and still
satisfied it. And the store was ONE slot per side for the whole app, so a marker
click in doc B released doc A's pinned card, and A's pin armed B's holds.

> **A hold writes only where a transient can move THIS card: a pinned card is
> live IN THIS DECK and sits BELOW the pressed one in cascade order** (natural
> top, then DOM order on a tie — `resolveCascade`'s own sort, read off the pod's
> children, no rect). **And a pin is a per-DECK fact:** `omniPinStore` is keyed
> by an OWNER each `OmniViewPanel` mints and stamps on its pod
> (`data-omni-pin-owner`), resolved from the wrapper by ONE helper,
> `pinOwnerOf`, read by the placement door and the lift; the slot is released on
> unmount, and a pod with no owner fails CLOSED.

Why exact is provable: the forward pass sets a row from its predecessors only,
and the backward pass can only move rows BEFORE the pinned row — every row after
it was already packed below its predecessor, so the pull is the identity there;
pressing the pinned card itself moves nothing either.

CI: the task-583 describes in
[gutter-stability-doors.test.ts](../../../src/components/editor-layout/__tests__/gutter-stability-doors.test.ts)
(press below a live pin, an inert pin, the pinned card itself, the tie, the REAL
`resolveCascade` lifecycle, and two panes) and the owner census in
`gutter-stability-census` (one writer, one resolver, no side-keyed store call).
**No pre-583 suite could see it**: every hold fixture pinned a card that was not
in the pod at all, and none mounted two decks. The two pre-existing freeze legs
are RENEGOTIATED in place (their pin now names a real wrapper below the pressed
card). Measured by neutering each half in turn: the any-pin rule takes 5 legs,
a global slot 7.

**Owed, not claimed:** the real-paper eyeball — click a margin marker, then
collapse a card below the pinned one: neither card moves.

#### The settle half: a termination criterion is the consumer's FIXED POINT, never a proxy for it

Same lane, and the case where the mechanism was right, the classification was
right (327), the movement policy was right (328) — and the loop that had to run
them all **stopped too early**, on a measurement of something else (task 370).

> **A geometry pass is an OBSERVATION, not a fix.** A trigger says "the world
> may have moved"; the honest answer is *keep measuring until two consecutive
> passes AGREE*, never *measure once and hope*. The agreement is the consumer's
> OWN fixed point — for this lane, a pass that commits nothing past the task-328
> hysteresis — so there is no second rule to keep in sync. And the budget is
> WALL-CLOCK, because a frame cap is a lie on a busy main thread: the frames a
> slow settle needs are exactly the frames it does not get.

Gabriel (2026-08-18, two screenshots, a card-dense page): the lane renders every
card packed contiguously from the top at minimum spacing — including cards whose
anchors are off-screen — and only "suddenly separates and goes to approximately
the right places" after scrolling a couple of lines. The cold-start healer was a
rAF loop that terminated the first frame the editor's `scrollHeight` was
unchanged (`SETTLE_STABLE_FRAMES = 1`), or after a 30-frame cap. Both halves
measure the wrong quantity, and the first is the interesting one: `scrollHeight`
is a **TOTAL**, and inner layout moves inside an unchanged total constantly — a
KaTeX span sizing, an expex example reflowing, a figure NodeView that reserves
its final box on mount and lays its contents out over the next several frames —
while an absolutely-positioned lane never touches it at all. After the loop
stopped, NOTHING re-measured until the user scrolled.

The rule now lives once, in
[src/lib/editor-geometry/settle-convergence.ts](../../../src/lib/editor-geometry/settle-convergence.ts)
(`createConvergenceController`), which owns SCHEDULING and TERMINATION and is
blind to geometry: `measure()` reports a `MeasureOutcome` and the controller
folds verdicts. Five rules it earned:

- **Every trigger enters ONE door.** Cold mount, `document.fonts.ready`, the
  editor RO, the per-card RO, the structural bus, `focusout`, the scroll-idle
  refinement and a dirty keep-alive re-show all mean the same thing and all used
  to get DIFFERENT answers — the mount got the 30-frame proxy loop, everything
  else got a single rAF-coalesced pass. A single pass is right only when one pass
  is enough, which is precisely what a cold load, a font swap and a late NodeView
  mount each falsify.
- **The per-FIRE cost is unchanged; the per-EVENT cost is up to three bounded
  passes, and the difference is worth stating precisely** — the first draft of
  this section said "idle-paced" and was wrong on exactly the path it was
  defending. A re-arm while a pass is pending ADDS NO PASS (one pending pass is
  the whole rate limit), so a trigger STORM still costs one pass, and a sustained
  typing burst is still capped at one pass per frame — the pre-370 ceiling. What
  is genuinely added is the trailing CONFIRMATION: after the last trigger, a
  wrap-changing keystroke costs its pass plus up to two more where pre-370 it
  cost one. Those two are paced by the ramp below (rAF only while the previous
  pass CHANGED something, so the confirmations fall to idle), each is
  O(in-band items) and read-only — one forced-layout batch, not one per card —
  and the alternative is the defect. Stated as a cost, not waved away: three
  bounded passes per wrap change, at most one per frame.
- **The budget is per CHAIN and is never refreshed**, which the same review
  found the first cut getting wrong in a way that mattered. A committing pass
  bumps `measureVersion`, which re-runs the per-card RO effect, which
  re-`observe()`s every card, whose initial delivery arrives back as a
  `request()` — so a refresh-on-request deadline was being extended by a trigger
  the chain itself had caused (measured against a browser-faithful observer over
  never-settling geometry: 3 378 reads at 18 s, climbing linearly). A budget a
  live chain can extend is not a budget.
- **The trigger door DROPS while the pass DEFERS, and the asymmetry is the
  keep-alive contract.** A trigger arriving inside the re-show suppression
  window is storm noise by construction — the window is only ever open when the
  cached geometry is already correct — so arming on it would make a CLEAN warm
  switch pay a settle it does not need (measured on the first cut: 6 `coordsAtPos`
  reads and 15 spin passes where the instant-switch invariant says ZERO). A pass
  of an ALREADY-ARMED chain reports `deferred` and retries, because that chain's
  reason to exist predates the window.
- **TWO agreeing passes, not one — because one agreement is a PLATEAU**, and a
  plateau is exactly what the retired proxy mistook for a settle. An async layout
  settle routinely holds still for a frame between a font swap and the mounts it
  triggers.
- **`deferred` is not agreement, and it is not a reason to stop.** The pre-370
  step did `if (!canMeasureNow()) return;` with **no reschedule**, so ONE frame
  that landed while hidden or inside the 250 ms re-show suppression window killed
  the settle permanently. Confirmed reachable at source by a read-only sweep
  during this task, and the everyday path needs no race: a paper opens with the
  editor ready but its sidecar cards not yet loaded, the user tabs to the Library,
  the cards arrive WHILE HIDDEN (the companion one-shot is `canMeasureNow`-gated,
  so it is skipped), and on return the re-show effect early-returned on an empty
  cache — *"cold mount, the wiring effect handles it"* — handing off to an effect
  that does not re-run on a visibility flip. So the COLD branch of the re-show
  now arms convergence, and a HIDDEN pass reports `inert` (park) rather than
  spinning the budget against a `display:none` pane. The same rule reaches the
  companion one-shot: an items rebuild that cannot measure because the pane is
  hidden marks the hook DIRTY, so the re-show cannot take its CLEAN branch over
  cards it has never measured.
- **A dirty re-show CLOSES the suppression window rather than waiting it out.**
  The window exists to protect a CLEAN re-show's cached geometry from the
  display-flip reflow storm; a DIRTY verdict is the evidence that its premise is
  false. It is closed inside the deferred callback, so the storm is still
  swallowed for the deferral and only the deliberate convergence runs — and the
  storm's own triggers coalesce to one pending pass anyway.

The task-328 policy is untouched and does the visual work: corrections land
through the hysteresis (sub-ε commits nothing, so `measureVersion` never bumps)
and the `.omni-entry-slide` transition, so convergence is a calm glide rather
than the first-scroll SNAP. The typing gate is hoisted to hook scope, so a
font-ready ping during card typing can no longer walk around it, and `focusout`
re-arms, which is what keeps a long typing session from outliving the budget and
stranding a half-settled deck.

### The two-entry-point half (task 656)

> **A gate is read by every pass only if every pass reads it from the same
> place.** Where two entry points each carry their own hand-written list of
> gates, the prose that calls them one list is a wish, and the drift is
> invisible in review because each list reads correct on its own.

This paragraph used to say the typing gate was "read by EVERY pass". It was not.
Two entry points can run a measure pass, and each stated its own gates: the
convergence controller's closure asked hidden / suppressed / typing, and the
companion one-shot (an items/`resolvePos` rebuild) asked `canMeasureNow()`
alone. A card-body edit mints a fresh `items` identity every 250 ms through the
`RichTextField` debounce, so each flush took one ungated synchronous pass — and
a repo-wide grep over the suites returned **zero** references to
`isTypingInPanel`. The gate this doc calls the fix for the "typed card jumps /
reads as carriage-return" report was held by nothing.

Neither half of task 656 was a user-visible defect on the day it was filed, and
that is the point worth recording: the pass a flush took committed nothing,
because `HEIGHT_EPSILON_PX` swallows glyph jitter and a card-body edit dispatches
no document transaction, so every `naturalTop` was byte-identical. What was
defective was three emphatic comments and this doc describing behaviour the code
did not have, on the keystroke-adjacent path, with no cover — which is how a real
regression lands here unnoticed.

The fix is not the wording. `passGate(via)` in `useInTextPositions.ts` is ONE
statement of the policy, asked by both entry points, and the asymmetry is
expressed as a parameter rather than as an omission:

- **`"chain"`** — every "the world may have moved" trigger. SPECULATIVE: nothing
  has told the hook the deck it already published is wrong, so typing holds it.
- **`"rebuild"`** — the companion one-shot. NOT speculative: a card was added,
  removed or re-anchored, and until a pass commits, a new card has no position
  and the pod renders **no wrapper** for it (`OmniViewPanel`: `if (top ===
  undefined) return null`). Gating this on typing would leave a card the user
  just created invisible until blur, so the typing exemption is **declared here
  and argued**, not diffed out of two lists.

Same shape, one lane over: the per-card ResizeObserver effect stated its purpose
narrowly — *"Dep on `measureVersion` so we re-observe whenever cards
mount/unmount"* — and then keyed on a value that bumps on ANY committed geometry
change, so a wrap-changing document keystroke paid `disconnect()` + a pod-wide
`querySelectorAll` + an O(deck) `observe()` over an item set that had not moved.
It is keyed on `observedIdsKey` now — the identity of the set the pod actually
renders a wrapper for, which is `positions`' key set by construction at the one
place a wrapper is rendered. The stated purpose, expressed as a value.

Teeth: [useInTextPositions-pass-gates.test.tsx](../../../src/hooks/__tests__/useInTextPositions-pass-gates.test.tsx)
drives a real chain trigger during card-body focus (nothing commits; blur snaps
the deck to truth), pins the rebuild exemption so a future "completion" of the
fix fails rather than hiding a new card, counts observer rebinds across a
committed geometry change with an unchanged item set (pre-fix all three counters
move) with a mount control that still rebinds — and CENSUSES the gate: outside
its own declaration `isTypingInPanel` may be read in exactly one place, because
what caused the finding was a second hand-written gate list and no behavioural
leg can see one of those being added.

**The law has a census, and it earned one the hard way.** Every door law in this
file ships one on the stated ground that *the door was never the part that could
misbehave — a call site that never asks it is* — and that prediction came true
inside this fix's own first cut, caught by the adversarial pass rather than by
any leg: the companion one-shot (an items/resolvePos rebuild) called `measure()`
DIRECTLY and entered no door, while two comments asserted that "a later item
arrival re-arms through the companion one-shot like any other trigger". That is
the COMMONEST cold open there is — the editor mounts before the sidecar cards
load, so the mount chain reports `inert` and terminates, and the cards then get
exactly one pass against still-settling layout. The pre-370 defect, on the path
the prose claimed was covered.
[settle-convergence-census.test.ts](../../../src/lib/editor-geometry/__tests__/settle-convergence-census.test.ts)
enumerates the measure call sites per LINE (two, each with its reason), requires
the synchronous companion pass to be PAIRED with a `request()` on the next line
(the allowlist key matches a bare `measure();` either way, so permitting the call
without pinning the pairing would re-open it), pins the controller's single
owner, and pins that `request()` writes neither the deadline nor the fast window
outside its new-chain guard.

Probe: `window.__settleConvergenceStats()` (sibling of `__layoutGestureStats` /
`__scrollRepositionStats`) reports `{ arms, passes, outcomes, lastChainMs,
lastStop }`. A healthy cold open reads `lastStop: "converged"` with a small
`lastChainMs`; `"capped"` is the honest failure mode and the one worth reporting.
CI: [useInTextPositions-settle-convergence.test.tsx](../../../src/hooks/__tests__/useInTextPositions-settle-convergence.test.tsx)
drives the REAL hook over a fixture whose `scrollHeight` is CONSTANT while its
line positions ramp — the "inner layout inside an unchanged total" shape — and
**dispatches no scroll and no resize**, which is why no pre-370 suite could see
this: every one of them hands the hook by hand exactly the external trigger whose
absence IS the defect. Measured by neutering each half in turn: restoring the
scrollHeight proxy fails the convergence leg, restoring the re-show hand-off
fails the empty-deck leg, removing the controller's pending-pass guard fails the
storm-cost leg (24 reads where 3 are allowed), stubbing the controller inert
fails ALL SIX, and `STABLE_PASSES = 1` — the plateau the retired proxy mistook
for a settle — fails two. The two termination legs (sub-ε jitter, and geometry
that never settles) are bounds pins rather than defect legs and say so at the
site; both were VACUOUS in the first cut and both are worth knowing about. The
jitter leg asserted only `calls === calls`, satisfied by zero, so it now carries
a lower bound; and the cap leg's fixture alternated on a 16 ms wall-clock period
that the 32 ms idle tail sampled at unchanging parity, so the geometry looked
static, the chain reported `converged`, and raising `MAX_MS` to ten million left
the leg green. Its fixture is driven per PASS now, and it reads `lastStop` off
the shipped probe — because a leg that names the wall-clock budget must not pass
on an implementation that has none.

**Owed, not claimed:** a preview eyeball on a crowded fixture and a real-FSA
pass on Gabriel's own paper. Cold opens and restored mid-doc scroll positions
are where this bites, and that is the FSA-masked class — the durable proof here
is the unit contract.

### The semantic-element half: the `[data-uuid]` element is not always the styled one (task 659)

> **When you read a block's CSS to learn something about the block, read it off
> the element that CARRIES that fact — not off whatever happens to wear the
> `data-uuid`.** The two coincide for most kinds and diverge for every block
> whose NodeView needs a WRAPPER, and a wrapper answers every computed-style
> question with a plausible-looking default rather than with an error.

`block-frame.ts` is the per-block geometry SSOT, and it assumed the identity
element and the semantic element are one. For a NESTED list they are: the
NodeView is a bare `<ul>`/`<ol>` with `data-uuid` / `data-text-object-kind`
stamped on it. For a TOP-LEVEL list they are not: `createListTitleNodeView`
([src/lib/editor-extensions.ts](../../../src/lib/editor-extensions.ts)) wraps
the list in a `.list-title-wrapper` div — it has to, to host the par-title
annotation above it — and stamps the identity on the WRAPPER.

The wrapper carries neither fact a marker band is made of. Its `padding-left` is
`0`, not the shipped `2.5em`; its `list-style-type` is the inherited initial
`disc`, because `.tiptap ol { list-style-type: decimal }` matches the `<ol>`
alone. So the container branch of `resolveMarkerGeometry` measured every
top-level ORDERED list as a zero-width band around a bullet: `inkLeft` — the
boundary [documented](../../../src/text-objects/block-frame.ts) as "the left
edge of the row's leftmost DOCUMENT INK, the boundary no margin affordance may
cross" — landed ~16px RIGHT of the real counter glyph, i.e. wrong in the UNSAFE
direction, with the task-382 guard switched off for the most common list in an
academic paper. `padLeft === 0` also collapsed both conservative fallbacks in
the same call: the un-modeled-counter answer (`liLeft − padLeftPx`) to the
item's own content edge, and the no-canvas band middle to the text edge itself.

**This is a silent class, and that is the point.** A computed-style read off the
wrong element does not throw; it returns a well-formed answer to a question
about a different box. Nothing downstream can tell the difference — which is why
the wrong number survived tasks 382, 483 and 487, each of which wrote legs over
this exact geometry using a fixture that stamped the kind on the `<ul>` directly.
`text-metrics.ts` has known about the wrapper since its `.list-title-wrapper`
branch in `resolveInlineContextElement`; this module did not. **Two modules
holding different beliefs about the same DOM is the shape to look for.** (Task
660 is the vertical-axis half of the same gap: "which element's first line does
this block show?" is answered in two layers, and three surfaces read the shallow
one.)

**The fix is a question asked ONCE, not a resolve repeated at each caller.**
`listBoxOf` is private to `block-frame.ts` and is called by `listBandGeometry`
ITSELF, not by its callers: hand it the block element and it finds the
`<ul>`/`<ol>` (`matches("ul, ol")`, else `:scope > ul, :scope > ol`). Both
production callers were already reaching it by different routes — the `listItem`
branch through `closest("ul, ol")`, the container branch by passing `el` — and
resolving at the door means a third caller cannot answer it a third way. A block
with no list box under it claims NO band (`inkLeft = liLeft`, the same answer
`list-style-type: none` gets) rather than inventing one: that branch is
unreachable through either caller and exists so the invariant is structural
rather than remembered. The two roles are named apart at the call site — the
BLOCK box (`el.getBoundingClientRect()`, what the handle is placed beside) and
the LIST box (what the band is measured on) — because they coincide numerically
here (`.list-title-wrapper` has no horizontal padding, border or margin) and
merging them back is how the band came to be measured on a div. Cost is
unchanged: two DOM reads, no layout and no extra `getComputedStyle`.

**What the defect actually was, stated honestly.** On a top-level list the 425
hover set is `[item, list]` and the list is the OUTER of the two, so
`applySameRowSeparation`'s inboard push only ever moves the ITEM — whose own
lane was always right, since `closest("ul, ol")` never saw the wrapper. The
defect on this shape is therefore a BOUND STATED WRONGLY, not a handle presently
painted on a counter: the container's `maxLeft` permitted exactly what task 382
forbids. The leg that carries the finding asserts that bound directly
(`resolveHandleLane`'s `maxLeft + HANDLE_WIDTH < glyphLeft`); the composed-hover
leg beside it passes pre-fix and is labelled a NET, because a leg that cannot
fail is worse than no leg when it is dressed as the proof.

Teeth: `handle-marker-ink-clearance.test.tsx` grows a `buildTopLevelList`
fixture that builds the REAL NodeView shape — wrapper + `.par-title-annotation`
+ styled list — and eight legs over it, each stating its expectation as the
equivalent NESTED list's answer rather than as a literal, so the two sides
cannot drift together. Pre-fix all eight fail while the 42 legacy legs pass;
that asymmetry is the finding.

**Owed, not claimed:** a preview eyeball (geometry is FSA-masked) — in the dev
doc, hover a top-level numbered list with ≥10 items and confirm no handle
touches the counter.

### The one-door half: a private answer forces every other caller to re-derive a shallower one (task 660)

> **"Which element shows this block's first line?" is ONE question, so it has
> ONE exported door and ONE declared answer per kind.** Production code asks
> `resolveFirstLineTarget` (`src/lib/text-metrics.ts`); the wrapper descent
> (`resolveInlineContextElement`) is the STEP that door composes and nothing
> else may call it. Whether a kind HAS a first text line is read from
> `TEXTLESS_BLOCK_NODE_TYPES` — the registry's `chromeAnchor: "block-top"` set
> — never re-derived from the schema's `isAtom`.

It had two layers and neither was wrong on its own. The wrapper half was public
in `text-metrics.ts`; the full answer — wrapper half PLUS the CONTAINER descent,
since a `<ul>`/`<ol>`/`.expex-block` has no text line of its own — was **private
inside `block-frame.ts`**, where it had been written because that is the module
that first needed it. So every consumer that was not the block frame reached
past it to the half that was reachable, and got a well-formed answer to a
different question:

- `measureBlock` seated a list-anchored card's marker using the `<ul>`'s
  inherited root 16px metrics while the grab handle for the same block descended
  to its first item's `<p>` — the drift `block-frame.ts` exists to prevent, in
  the one service whose docstring claimed it used "the grab-handle geometry
  SSOT". Its `lineCount` divided the list's full height by the container's
  leading, inflating the count ~1.7×, and `metricsWithinEpsilon` compares
  `lineCount` EXACTLY, so the wrong value was never absorbed as wobble.
- `PendingChangePill` resolved the change's block by walking to the direct child
  of `view.dom`, so a change anywhere in a list answered `<ul>` — one seat for
  every row, at the OUTER list's left edge, with a hardcoded `28` px clearance
  for a lane that is em-scaled per block. One notch up the font-size slider and
  the lane exceeds 28px: the pill (higher z-order) covers the grab handle and
  takes its clicks — the same failure task 526 fixed for the hover zone.

**The second cause, and the one the task framed wrongly.** `latexComment` and
`figureBlock` were said to be "missing from the wrapper table". They are not
table rows at all: both declare `chromeAnchor: "block-top"` — *no first text
line* — and the grab handle has always read that. `measureBlock` forked on the
SCHEMA's `isAtom` instead, and those two are the exactly the kinds where the two
questions disagree (`content: "text*"` and `content: "figureCaption?"` are not
atoms). Adding a `.latex-comment` → `.latex-comment-content` branch would have
made the marker seat on a text line the handle deliberately ignores — *widening*
the drift while appearing to close it. The registry already held the
declaration; nothing read it.

**The shape to look for:** a resolve that is private to the module that needed
it first, with a *partial* version of the same resolve exported one layer down.
The partial one is what the next consumer finds.

**Where the vocabulary lives.** `TEXTLESS_BLOCK_NODE_TYPES` and
`TEXT_LINE_CONTAINER_NODE_TYPES` sit in the import-free leaf
`src/lib/node-attr-sets.ts`, because `text-metrics.ts` (which performs the
resolve) and `text-object-registry.ts` (which declares `chromeAnchor`) cannot
import each other — the registry already reaches text-metrics. They are PINNED
to the registry by `first-line-target-census.test.ts`, so the leaf copy cannot
drift from the declaration it mirrors.

**Teeth** (`src/lib/__tests__/first-line-target-census.test.ts`, 16 legs):
the vocabulary census (each set equals its registry-derived set; every
`UUID_BEARING_NODE_TYPES` member declares exactly one answer), the ONE-DOOR
census (no production module outside `text-metrics.ts` names
`resolveInlineContextElement` — the leg with the teeth, since no behavioural leg
can see a second consumer being wired to the shallow half, which is precisely
how this shipped), and the behavioural legs. The agreement leg is written over
the **nested** list, not the top-level one: `.list-title-wrapper` is a named row
in the wrapper table, so a top-level list agreed pre-fix — that leg is kept
beside it and labelled a NET, because a leg that cannot fail is worse than no
leg when it is dressed as the proof. `pending-change-pill-target.test.ts` adds
the pill's horizontal legs (tracks `markerLeft`; never covers the handle box at
any slider notch, with the 28px constant shown to be inside the box at the top
of that range) and the innermost-block resolution. Cost is unchanged: the
descent is O(depth) with one short-circuiting `querySelector` per container
level and no layout read.

**Owed, not claimed:** a preview eyeball (geometry is FSA-masked) — in the dev
doc, put a card on a bulleted list and on a `%` comment and confirm both markers
sit where their grab handles do; make a pending change inside a nested list and
confirm the pill clears the handle at two font-size notches.

### The one-interpreter half: a token's SPELLING is the stylesheet's business, not the reader's (tasks 661, 662)

> **Every `--margin-*` length is resolved by ONE function —
> `resolveMarginEm` (`src/text-objects/block-frame.ts`) — which knows the px /
> em / rem ladder and takes the token's SIGN POLICY as an argument.** No caller
> may hand-`parseFloat` a margin custom property. And wherever a resolve reads
> a token whose geometry is relative to an element, the STYLE, the ORIGIN and
> the em BASE all come from that same element.

`getComputedStyle` does not resolve a custom property's `em`: it returns the
literal `"1.375em"`. That is the whole hazard, and it is a SILENT one —
`parseFloat("1.375em")` is `1.375`, a finite positive number that passes every
naive guard, so a token re-authored in `em` does not throw, does not fall back,
and does not read as wrong anywhere. It just collapses to a rounding error.

Two readers had drifted out from under the shared door, each for a reason that
looked local and sufficient:

- **`viewport-frame.ts` never came through it at all.** It hand-parsed
  `--margin-col-handle-inset`, correct only because the token happens to be
  authored `22px` — three lines below two siblings (`--margin-handle-gap`,
  `--margin-track-width`) authored in `em` precisely because margin distances
  should scale with the labeled text, and inside a comment block presenting all
  of them as one coordinate system. That number is read by exactly two
  consumers and they are the two that matter most: `handleLaneFloor` (task 526)
  makes it BOTH the grab handle's placement floor AND the left edge of the
  hover zone that reveals the handle. An `em` spelling would clamp handles onto
  the prose *and* make the strip that keeps them alive vanish as the user
  reached for one — from a stylesheet edit, with no code change to blame.
- **`resolveChevronColumnRight` kept a second copy on purpose**, and its
  docstring argued the exemption honestly: the shared resolver rejects
  non-positive px, and `--margin-col-chevron` is authored NEGATIVE. But that
  was never a fact about the token — it was a missing parameter. The `> 0` test
  lived on the px rung ALONE, so a negative `em` factor sailed through on a
  distance token while a negative px fell back: **one token, two policies,
  decided by its spelling.** Lifting the sign to a stated `MarginTokenSign`
  applied on every rung retires the fork and the exemption together, and the
  two chevron tokens gain the em/rem ladder they never had. The exemption's own
  docstring had named this as the right eventual move.

The shape to look for: *an exemption argued at its door in terms of a
limitation of the shared door*. That is a feature request on the shared door,
not a reason for a second one — and while it stands, the next reader written
somewhere else (here, `viewport-frame.ts`) copies the hand-parse without ever
reading the argument.

**Provenance (task 662).** `resolveBlockFrame` handed the chevron resolver the
TARGET's computed style while taking the offset's ORIGIN from `el`'s rect. Same
element for a source pod (`texBlock` / `forestBlock` — the `[data-uuid]` node
DOM is the `.react-renderer` wrapper, which matches no descent branch, so
`target === el`), different elements for a heading (`.heading-wrapper` vs the
inner `<hN>`). It worked only because the shipped tokens are `:root` px
literals and custom properties inherit — a fact about the stylesheet, not a
contract the function stated. Now the style, the origin and the em base are
taken from one element, and the extra read is paid ONLY where the boxes
genuinely differ: a pod reuses the `cs` and `firstLineRect` the frame already
holds. That also retires a real duplicate — `el` was measured twice per
resolve, on the hover/scroll/RAF placement path, on every pod hover, in the
module whose header sells it as the resolve that stopped affordances measuring
independently. The em base is deliberately `el`'s font and never the heading's
inner display font: a gutter column shared by every row cannot scale with one
row's type size.

Membership in `FOLD_CHEVRON_NODE_TYPES` was also stated twice — the caller's
gate and the resolver's own guard. It is now one predicate,
`reservesChevronColumn`, called by both, so the caller can still skip its rect
read without re-asking. (A duplicated *test* is the kind that drifts; the SET
was never duplicated — it lives in `node-attr-sets.ts`.)

**Teeth.** `resolve-margin-em.test.ts` gains the sign-policy legs (non-positive
is unreadable on EVERY rung by default; `"signed"` admits a negative offset on
every rung; `NaN` is still unreadable either way) and the chevron-through-the-
door legs including an `em` spelling of both chevron tokens.
`viewport-frame.test.ts` gains the `1.375em` leg the finding names, asserting
`marginInset` is `1.375 × fontSize` and explicitly **not** `1.375`, plus the
lane edge that follows from it. `block-frame-chevron-read-budget.test.ts`
counts rect reads PER ELEMENT (the convention `grab-handle-typing-cost.test.tsx`
set) for both pod kinds, for a heading, and for a chevron-less row, and pins the
provenance with an override on the `<h2>` that must NOT move the column. Five
of those legs fail against the reverted source; the two that pass pre-fix are
labelled NETS in the file rather than presented as the proof. Cost: strictly
fewer DOM reads than before — one fewer rect on every source-pod hover, none
added anywhere.

**Not owed:** no preview eyeball. The shipped token values are unchanged, so
every number this produces today is identical; the legs are the proof.

### The composed-frame half: a resolve whose parts are covered and whose ASSEMBLY is not (task 663)

> **A module that promises alignment "BY CONSTRUCTION" owes a leg on the
> construction.** Covering each part is not covering the composition: the kind
> gate, the branch order, and what gets threaded where are decisions the parts
> cannot make wrong on their own.

`block-frame.ts`'s parts were well covered — `resolveMarkerGeometry`,
`resolveMarginEm`, `resolveChevronColumnRight` and `resolveHandleLane` each had
real legs — and `resolveBlockFrame` had **no direct test anywhere**. Every leg
reached it through a consumer, and the consumers only ever read `contentLeft` /
`contentWidth`; `selection-handle-marker-left.test.ts` builds a `BlockFrame`
literal by hand rather than resolving one. So nothing asserted an
`opticalCenterY`, a `gapPx`, a `markerLeft`, a `columnRight` or a `chevronRight`
**as composed**, and `contentRight` — the figure chrome's "beside" anchor —
appeared in no test file at all. The two fields added most recently were the two
with the least cover.

**The fixture is part of the resolve.** The frame is computed from rendered DOM
and nothing else, so a suite that hand-rolls an *approximation* of that DOM
tests an approximation of the resolve. That is the mechanism behind the
semantic-element half above: the top-level-list shape — uuid/kind on a
`.list-title-wrapper` **div**, band and counter on the `<ul>`/`<ol>` inside it —
was never built by any fixture, because every fixture stamped the kind straight
onto the list the way the NESTED shape does. The band was therefore measured on
a div (`padding-left: 0`, inherited `disc`) for every top-level numbered list in
the app, and nothing failed. **The shape a fixture does not build is the shape
that ships wrong.**

So "what the DOM actually looks like" gets ONE home:
`src/text-objects/__tests__/_block-frame-fixtures.ts`, one builder per kind
family named beside the renderer it mirrors, with the canvas stub and the
fixture's own arithmetic (`modelTextWidth`, `capBandCenterOffsetModel`) beside
them — so a leg checks the production estimate against the world rather than
against itself. The two list shapes stay SEPARATE functions there; one function
with a flag is how they were conflated. And the module is held by a CENSUS, not
by a comment: nothing else may construct a `.list-title-wrapper`, and the
per-character width model exists once. The allowlist carries a stated reason per
entry, and a second leg fails when an entry goes stale — an allowlist that
outlives its entries stops being a boundary and becomes a list of names.

Two more shapes worth naming, both instances of the same thing:

- **A field's point can be a NEGATIVE, and then a census is the load-bearing
  leg.** `contentRight` exists so the figure chrome does not measure its own box.
  No behavioural leg can see a consumer being wired to the wrong door — that is
  precisely how such a thing ships — so `figure-chrome-beside-anchor.test.ts`
  asserts the fit test names `resolveBlockFrame(block).contentRight` and the
  module takes no `block.getBoundingClientRect()`. It also pins the gap the CSS
  anchor and the JS fit test must share: two halves of one decision, with a
  comment on each side saying so and nothing checking it.
- **A DEFENSIVE path is only testable through a shape production cannot
  produce.** `isTopRowOf`'s `MAX_CONTAINER_DESCENT` bound needs containers nested
  directly in one another, which the list schema forbids. Refusing to build one
  means not testing the bound at all, so the suite builds it and says why.

**A leg on a composition must be able to FAIL.** Twenty-eight deliberate breaks
were run against these suites and every one was caught — `listBoxOf` reverted to
`el`, the chevron origin taken from the target, the cap offset dropped from
`opticalCenterY`, a container's `markerLeft` taken from `contentLeft`,
`contentRight` collapsed to `contentLeft`, `<ol start>` / `reversed` ignored,
`columnRight` unconditional, `gapPx` frozen to its fallback, the container
recursion removed from the first-line descent, the marker-ink trail allowance
dropped, `measureTextWidth`'s guards removed, its cache mis-keyed, the width
cache left un-cleared on a font wave, `capBandCenterOffset`'s `cs` ignored, the
`<pre>`→`<code>` descent removed, the expex second pass removed, the beside gap
drifted from the CSS, and the chrome measuring its own box again. The `reversed`
leg was **vacuous on its first numbers** — the fixture's width model gives every
digit one width, so `12.` and `14.` measure the same — and the break test is
what caught it. A composition suite that passes on a broken assembly is the
thing the task existed to avoid.

**Not owed:** no preview eyeball. The only production change is one test-only
export, `__textWidthCacheSize` (the twin of `__fontMetricsCacheSize`: the width
cache is dropped on every font wave alongside the metrics cache, and only half
of that invalidation was observable).

### The precondition half: a pure function's arithmetic is a CONTRACT, or it is an assumption (task 673)

**A pure geometry function's arithmetic states preconditions on its input. Where
neither the type, the producer, nor a test says them, they are not a contract —
they are an assumption, and the function is partial over the type it declares.**
`computeMarkerPositions` ([src/lib/marginalia-grid.ts](../../../src/lib/marginalia-grid.ts))
encoded four assumptions about `AnchorNodeMetrics`: a line pitch of at least
24px, anchors running strictly downward, an integral `lineCount`, and finite
numbers. `measureBlock` guarantees none of them.

Three lessons, each general past this function:

**A "byte-identical" claim is a CONDITIONAL, so it names its condition.** The
module said the walk changes nothing where nothing collides, because
`MARGINALIA_ROW_MIN_GAP` is "the gap the canonical 24px line already produces".
Read as arithmetic that is `rowY(r) − (frontier + MIN_GAP) = lineHeight − 24`: a
tie at 24, and below it every row after row 0 displaced by `24 − lineHeight`,
CUMULATIVELY. The threshold was reachable — `preferences-tree.ts` puts the body
minimum at `0.85rem × 1.4` = 19.04px — so the claim was not merely unstated but
false at shipped preferences. A test that pins the canonical value (here
`LINE_HEIGHT = 24` across two whole suites) confirms the tie and can never see
the band where the claim stops holding. Sweep the band the SLIDERS allow, and
derive its ends from the preference SSOT rather than hand-copying them.

**A bound asked at one row is not a bound.** `MARGINALIA_MAX_MARKER_DRIFT` was
checked at row 0 and every lower row exempted, on the reasoning that a lower row
is "still beside its own block" — true only while the pitch keeps the
accumulated pushes inside the block. The fix is not to fold the node (that hides
markers the reader can see) but to END its grid at the last row it can place on
its own line and let the surplus ride the node's OWN "+K" pill. The two pill
producers then become one rule asked at two rows: a cell is placed only where it
lands within the bound, and what fails rides a pill — row 0 failing means no home
on this side (the shared crowd pill), a lower row failing means a home with not
enough room (the node's R16 pill).

**Sort on the quantity you compare, not a proxy for it.** The walk ordered by
`node.top` and compared `rowY(node, 0)`; they diverge wherever `lineHeight`
varies, and `measureBlock` gives a textless block a `lineHeight` of its full
height, so a figure anchors at its CENTRE — below the caption printed under it.
A one-sided guard (`anchoredTop > crowdAnchorY + DRIFT`) cannot see a
non-monotone sequence, and one pill stood in for anchors 68px apart against a
44px bound. Sorting on `rowY(node, 0)` makes it unrepresentable rather than
guarded — the task-205 move for the margin side — and leaves the guard complete.
Its existing test leg was VACUOUS for exactly this case: a fixture with one
uniform pitch has monotone anchors by construction. **Widen the fixture that
cannot represent the failure; do not add a parallel test beside it.**

**Totality is per-NODE.** A non-finite metric made `frontier` NaN for every
remaining marker on the side (React drops a NaN `top`, so they pile at the
container origin) and `NaN > DRIFT` is false, so the fold never rescued them
either. `sanitizeMetrics` refuses the node the way the function already handles
an unmeasured one — `null`. One bad measurement costs one node, never the side.

**Owed:** a preview eyeball — Preferences → Body Text → Line height at its
minimum on the dev doc, watching a long marked paragraph's icons (FSA-masking
class; the durable proof is the unit tests).

### The binding half: a geometry consumer is handed a TRACKED editor, never a ref read during render (task 736)

`useViewportFrame(editor)` is keyed on the editor it is HANDED. `Editor.tsx`
fills `editorInstanceRef` in an effect, i.e. AFTER its children render, so a
child that called `useViewportFrame(editorRef.current)` bound its frame to
`null` — the EMPTY frame, whose `containsHoverZone` is `() => false` — and an
effect keyed `[editorRef]` never re-ran when the editor arrived or was swapped.
The grab handle papered over this with a 50 ms `poll()` that re-subscribed but
forced no re-render (handles appeared only because an UNRELATED parent render
happened to re-run the child), never re-bound on a swap (the old instance kept
its listeners), and read the Reader's `selectionchange` gate once, at null, so
it never installed. `SelectionActionsMenu` carried the same shape with a RAF
wait-loop, and resolved its scroll parent once from the null ref.

Rule: a placement overlay takes `editor: Editor | null` as a PROP (the parent
re-renders when `useEditor` returns the instance), passes it to
`useViewportFrame`, and keys every subscription effect on `[editor]`. That is
one render per editor LIFETIME, never per transaction — keystroke sanctity is
untouched because the per-keystroke work still rides the RAF-scheduled
placement path. The React Compiler lint names the defect directly
(`react-hooks/refs`: "Cannot access refs during render"). Converted: the grab
handle and `SelectionActionsMenu`. **Residual (same class, not yet
converted):** `PendingChangePill` and `LiftHost` (`EditorPane.tsx`) still call
`useViewportFrame(editorRef.current)`; `PendingChangePill` mounts only once a
pending change exists (the editor is normally live by then) and `LiftHost`
reads its frame only during a gesture, so neither is known to misbehave today.
Pins: `grab-handle-editor-binding.test.tsx`,
`SelectionActionsMenu-placement-decouple.test.tsx` ("tracked editor binding").
