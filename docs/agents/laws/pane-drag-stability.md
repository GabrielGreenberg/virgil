<!-- last-verified: aea05929 2026-09-20 -->
<!-- derives-from: AGENTS.md#laws -->

# Pane-drag stability

> **Every pane/divider resize gesture runs on the ONE engine at [src/lib/pane-resize/](../../../src/lib/pane-resize/)** (`usePaneResizeHandle`): pointer capture on the handle, element-scoped move/up/cancel/lostpointercapture, `button===0` start gate, `(buttons & 1)===0` missed-release failsafe (the primary-button BIT test, not `buttons===0` — releasing the drag button while a second is chorded fires only a pointermove with an updated mask, never a pointerup), Escape restore, a drag shield over iframes, RAF-coalesced equality-bailed imperative `apply()` (CSS-var writes; grid templates own hard clamps via `minmax()`/`clamp()`), and `commit()` exactly once on release. **Never** a bespoke `window`/`document` `pointermove` handler, and **never** per-frame React state, store notifies, or localStorage from a continuous gesture. Per-frame React state inside an engine consumer is sanctioned ONLY when a render-derived layout decision needs the live value (current sole case: `SplitWithCode`'s `liveRatio` — the compressed-gutter flip + clip fade derive from it in render), and only as LOCAL state driven from the engine's RAF-coalesced `apply()` (≤1 set per frame) with child subtrees bailing on element identity and persistence still commit-once; anything else is the per-frame-commit bug class this section exists to kill.

A gesture the engine's `getValue/apply/commit(px)` shape genuinely doesn't fit (a snap-to-row *selection* like the Outline focus band; a float move) may stay bespoke — the guardrail's either/or names those — but it does **not** get to re-derive the two pointer invariants: it imports them from [src/lib/pane-resize/pointer-invariants.ts](../../../src/lib/pane-resize/pointer-invariants.ts) (`isPrimaryDragStart`, `isMissedRelease`), the same predicates the engine itself calls. A bespoke gesture missing them stays live after a release it never observed — ghost-tracking the pointer and committing on the user's next click (task 185).

**And "bespoke" buys a different SHAPE, never an exemption from the rest of the discipline** (task 330). The float move read it as the latter for a year: per raw `mousemove` (120-240 Hz, no RAF coalescing anywhere) it committed React state *and* swept the DOM for the dock proximity test, the sweep growing a rect-read-PER-BAND inside the 80px dock gate. Write → read → write per event, worst exactly where Gabriel reported it worst ("especially laggy near the docking sites"). The four obligations a bespoke gesture inherits whole: **coalesce** (≤1 imperative write per frame, equality-bailed — the float shell moves by `translate3d` on its own element, composite-only, since a `left`/`top` write re-lays-out every frame; React renders on edges only and JSX never sets `transform`, the drop-mode lift-overlay law); **snapshot** (every geometry the per-event math needs is captured ONCE on a gesture edge and hit-tested as pure arithmetic — `readDockGeometry` + the viewport clamp bounds, re-armed only on a real invalidation, which for a drag is a window-resize burst read off the LayoutGestureBus SET channel); **commit once** (state + persistence on the end edge, through ONE end path every variant enters, so no ending can skip the chrome teardown); and the two **pointer invariants** above.

What makes the snapshot half more than a perf trick is the affordance law — and stating it *precisely* is the whole of it, because the loose version was wrong twice in this task's own first cut. The hover and the release read the same **door**, so they cannot answer from two different tables ("what the hover OFFERS is what the commit ACCEPTS", tasks 258/321/332, arriving through the geometry rather than through a placement list). They can still legitimately differ where the *world* differed — a snapshot genuinely re-captured because it was invalidated — which is the right answer, not a disagreement. What is NOT allowed is either half answering from something the other cannot see, and the adversarial pass on this fix found both shapes: the release read the raw snapshot **ref** while only the hover went through the lazy door, so (a) an ordinary 1px undock flick reached the release with no snapshot at all and silently declined a redock the pre-fix live sweep performed, and (b) a bus edge landing in the pause people take to confirm a drop target — `endWindowGesture` is a trailing-idle timer, independent of pointer state — nulled the snapshot between the last move and the mouseup, so a lit dock outline redocked NOWHERE and then cleared itself. The invalidation meant to prevent staleness had reintroduced the false affordance. Both halves now enter `geometry()`, and a release that carries **no trustworthy coordinate** (the missed-release bail) re-probes at the last cursor the gesture OBSERVED rather than falling back to the float's vertical centre — that fallback resolves a different band for a tall float, so the one path that exists to end a gesture safely was the one path that could accept an index nobody was offered.

Two structural notes. `dock-drag.ts` deliberately exposes **no live one-call hit-test** — `findDockTargetAtPoint` (dead since the band-stack model) and `findDockTargetByPanelProximity` (whose only callers were the two converted sites) are DELETED, because a function that sweeps and answers in one call is exactly what a per-move caller reaches for; a consumer must now spell `readDockGeometry` to sweep, which a move-path source contract can forbid. And a **snapshot reader belongs at the gesture edge, not just a rect reader**: `getWindowInsetTopPx()` (the WCO top clamp) reads `localStorage` twice per call, which is invisible to any "no `getBoundingClientRect`" grep and was running at pointer rate.

CI: [float-move-gesture-cost.test.tsx](../../../src/components/__tests__/float-move-gesture-cost.test.tsx) drives the REAL gesture and asserts the cost contract directly — the shell's React-owned `left`/`top` frozen while only the transform moves, one queued frame for eight events, zero `querySelectorAll`/`getComputedStyle`/rect reads across twenty moves *through* the dock corner (instrumented on `Element.prototype` as well as `document`, since the old code's own shape was an element-scoped query off a cached column), hover-target ≡ release-target, both invariants, and the docked→undock→redock round trip whose post-reflow capture ordering the whole lazy-capture design rests on. The leg with teeth is a SOURCE census, and it is **effect-wide, not region-wide**: a region scan over the `onMove` MOVE branch follows no calls, and lifting the per-move geometry work into a same-effect arrow function — the idiom the file already establishes — takes every needle out of the branch while the work still runs per event (demonstrated on a scratch copy during the review, every region leg green). So the census asks the whole gesture effect, `applyTranslate`'s RAF body included, to name no DOM-measuring API and to spell `readMoveGeometry` exactly ONCE, in the memoized door; the narrower branch leg survives only to localize a failure. Since task 335 that census also asks the effect to spell `setPos(` exactly ONCE — the per-frame-commit class is not a move-branch fact, and the region leg is blind to the `else` arm by construction — while [floating-panel-edge-resize.test.tsx](../../../src/components/__tests__/floating-panel-edge-resize.test.tsx) takes the frame clock and pins the resize half behaviourally (one frame for eight events, an equality bail counted through a `<Profiler>` because with equal values React's own style diff writes nothing either way, and a release whose frame never ran still committing what the user dragged to) with every existing clamp assertion's VALUE unchanged. Every leg fails on its own pre-fix behaviour, measured by neutering each half in turn.

**Residuals, stated rather than implied.** (1) The **resize** branch's per-event commit is CLOSED (task 335). It never had the interleaved-thrash half (it does no DOM read), but "must re-layout" is not "must re-layout uncoalesced" — the engine's own `apply()` writes real layout and still coalesces — so it now schedules one frame per event and commits at most ONE equality-bailed `setPos` per frame, through the same `commitPos` door the move's edges use. The shape is the one thing worth carrying forward: React stays the **owner** of `width`/`height` and the coalescing sits in FRONT of it, because JSX *does* set those properties — the move path's imperative channel is safe only because JSX never writes `transform`, so a mid-gesture re-render leaves a translate standing and would clobber an imperative width. A resize therefore has no zero-commit form; one commit per frame is its floor. (2) The bus's window publisher needs two resize events in 100 ms, so a **one-shot** viewport change mid-drag (keyboard maximize, DPR change) publishes nothing and leaves the snapshot stale for the rest of the gesture; survivable because both readers share it and stay stale *together*, which is the exposure the StackIcon's cached rect already carries. (3) The `[cost: …]` tag convention is enforced since **task 334** — see "The tag half" below. (4) The four sibling gestures named here (`useDragPosition`, the editor-scrollbar thumb, the card-lift threshold detector, `useMarginEdit`'s hand-written twins) were **closed by task 333**, along with the census blindness — see "The census half" below.

**The engine owns the gesture, the `.dragging` chrome HOOK and — since task 189 — the handle's a11y SEMANTICS; the consumer owns the look.** `PaneResizeHandleProps` returns nothing visual, so every consumer renders `drag-gap drag-gap-{h,v} band-grip` **on the handle's own element** or sits on `PERMITTED_UNCHROMED_RESIZERS` with a stated reason (one entry: the Library list's column boundary, a content-height header track the 28→44px pill would overflow — and it still takes the family's tokens AND its state→color mapping, transparent → `--drag-highlight` on hover → an escalated drag state, because an exception buys a different shape, never a different palette). The semantic half is a recorded POSTURE, not an oversight: **Virgil does not yet commit to keyboard/screen-reader operation of its layout chrome** (STYLE_GUIDE "Resize gutters" → "Accessibility posture"), so the engine emits `aria-hidden` and **no divider announces itself** — the pre-189 middle state, where 4 of 10 handles carried a *named, valueless, non-operable* `role="separator"` while `FloatingPanel`'s 5 edges and `EditorPane`'s 4 margin guides carried `aria-label` on bare divs ARIA forbids naming (inert, announcing nothing), is the thing outlawed: a control that claims to work and then refuses is worse than one that stays quiet. Both halves are censused in the same guardrail, and each is blind to the OTHER legs' needles — a hand-rolled *look* or *role* on a perfectly correct gesture matches none of them, which is exactly how both drifted with CI green.

Three properties of that census are load-bearing rather than incidental, each earned by its own first draft being wrong. It asks **per handle, not per file** — `LibraryView` holds three and `panel-column` two, so a file-level question lets one drifting handle be exempted by a chromed sibling, and the original `--accent` drift was catchable only because `LeftList` happens to hold exactly one. It reads JSX by scanning to the tag's **real** end rather than to the first `>`, because `onMouseDown={(e) => …}` is the repo's dominant idiom and a `[^>]*` class truncates the tag at the arrow — which is how the four margin guides sat unflagged under a guard written to indict them. And it asks whether a handle's subtree holds a **focusable node**, since that is the premise `aria-hidden` rests on and nothing else states it.

### The content half: the drag that inherited none of the four obligations

Same law, and the case where the reference implementation was written down, cited by name in
the very allowlist the offender sits on, and simply never applied to the gesture people use
most (task 351). Gabriel: dragging bullet-list items is "extremely choppy and rough — should
be smooth-like-butter Notion-style." A content drag — the block / text-object lift that routes
through the drop-mode controller — had a lift overlay that was exemplary (RAF-coalesced
`translate3d`, equality bail, React on edges only) bolted onto a **controller that took none of
task 330's four obligations**, and three costs outside it that only a real drag reaches.

Four findings, each silent, and the order below is the order they bite:

- **A `pointer-events: auto` overlay above the editor turns `posAtCoords` into an O(doc)
  forced-layout sweep.** `view.posAtCoords` asks `document.elementFromPoint` first; when the
  answer is a node OUTSIDE `view.dom`, ProseMirror falls back to `elementFromPoint(view.dom, …)`
  — a wrap-around `getClientRects()` scan over EVERY top-level block with no early break — and
  `posFromCaret` then returns null, so `posFromElement`'s `findOffsetInNode` sweeps them all
  again. **Two doc-proportional passes per throttled move.** `globals.css` had made floating
  panels click-through for exactly this reason in Wave 0 ("floats become click-through so the
  cursor falls through to the editor for hit-testing") and the member list was never completed:
  the MARGIN chrome — grab handles, marginalia markers, the overflow pill, the orphan dock —
  sits inside `.ProseMirror`'s own 88/72px padding band, which is precisely where a Notion-style
  user drags. One rule, an incomplete member list, and the cost of the gap is not a missed hover.
- **The gesture measured at POINTER rate.** `feedAutoScroll` ran on every raw `mousemove` and
  opened with `scrollEl.getBoundingClientRect()` — the zone gate lives *inside* the probe, so a
  forced layout answered "am I near an edge?" about a container that cannot move under a held
  pointer, 120–240 times a second, for a drag nowhere near an edge. Verbatim the shape task 334
  found in `focus-band-drag` and task 333 in `useDragPosition`'s RAF body.
- **It coalesced on a wall clock, not a frame** — and its fast branch ran the whole hit-test
  SYNCHRONOUSLY inside the mousemove handler, so the indicator's own React style write landed
  between two of the gesture's own reads. A 16 ms timer against a 16.67 ms frame also beats
  against vsync at ~2.5 Hz, so the pass lands at a drifting phase relative to paint.
- **The one thing that actually MOVES was moved by `top`.** The drop indicator is
  `position: fixed` and `globals.css` eased its `top` — an 80 ms main-thread LAYOUT animation
  restarted on every placement change, which during a drag through a dense list is most frames.
  The tree was therefore never clean, so every rect read in the app paid a forced style+layout
  flush. The float shell and the lift overlay both move by `translate3d` under a law this file
  already states ("a `left`/`top` write re-lays-out every frame"); the bar was the one element in
  the gesture that moves and the one that hadn't taken it.

> **A content drag is a bespoke gesture, so it owes the four obligations whole: COALESCE (one
> pass per FRAME, at the LIVE pointer, never inline in the event), SNAPSHOT (every geometry the
> per-move math needs captured once at the edge and read through ONE lazy door), COMMIT ONCE,
> and the two POINTER INVARIANTS. And the gesture's CHROME owes a fifth: everything painted
> above the editor is click-through for the session, because the hit-test has to reach the
> editor through it.**

The snapshot door is [src/components/drop-mode/move-geometry.ts](../../../src/components/drop-mode/move-geometry.ts),
the same shape `FloatingPanel`'s `readMoveGeometry` has: lazy capture, re-armed off the bus's SET
channel, dropped on the ONE teardown every ending funnels through. Two rules it earned:

- **The span memo is HORIZONTAL-only, and that is load-bearing rather than tidy.** Auto-scroll
  moves content vertically under a parked pointer, so a cached `.top` is stale within a frame,
  while `.left`/`.width` cannot change without a reflow a drag does not cause. The door therefore
  stores the PAIR, not the `ContentEdges` record — there is no `.top` to reach for — and a
  consumer that needs a vertical number reads the one live block rect the hit-test already threads.
- **The re-hit-test is REQUESTED, not run.** Auto-scroll's frame writes `scrollTop` and then asks
  for a pass, so the WRITE and the next READ land in different frames. Running it inline bought a
  one-frame-fresher indicator nobody can see, at the price of a forced flush immediately behind
  the gesture's own write.

The same pass closed the par-title hover band ([Editor.tsx](../../../src/components/Editor.tsx)) — the grab
handle's **twin**: same question (which block is the pointer over?), same source (`blocksAtY`),
and during a drag the answer is invisible under the ghost. `TextObjectGrabHandle`'s tracker took
`parkDuringLayoutGesture` + a RAF in Wave 2; this one took neither, so per RAW pointer event it
ran a `localStorage` read (the `virgil:geom-hover` kill-switch — the `getWindowInsetTopPx` shape
task 330 names, at pointer rate), a host rect, an O(near-zone) scan, and then an UNINDEXED
`querySelector` over each hit's whole subtree. **A `bulletList` hit's subtree is the whole list**,
which is why the felt cost was list-shaped and why a bullet-item drag was worse than any other.

CI: [content-drag-move-cost.test.ts](../../../src/components/drop-mode/__tests__/content-drag-move-cost.test.ts)
drives the REAL controller and asserts what runs per EVENT versus per coalesced FRAME (twelve raw
moves cost ZERO DOM reads after the gesture's one capture; eight cost ONE hit-test, at the LAST
coordinate); [content-drag-guardrail](../../../src/lib/__tests__/content-drag-guardrail.test.ts) gains the
click-through census (per HOOK, and the hooks are re-checked against what the components emit — a
rename would leave the CSS matching nothing) and the coalescing/snapshot pins. Every defect leg
fails on its own pre-fix half, measured by neutering each in turn. One harness detail worth
carrying forward: the fixture stubs the scroll container's OWN `getBoundingClientRect`, which
**shadows `Element.prototype`** — so the first draft's prototype-only counter reported zero and the
per-move-read leg passed vacuously under its own neuter. Count at the source (the trap
`float-move-gesture-cost` records).

**Owed, not claimed.** This run had no browser: the wall-clock half of the acceptance bar — a
DevTools trace of a 5 s drag over `doc_perftest` with no >8 ms task attributable to the drag path,
and Gabriel's own "smooth like butter" feel check — is outstanding. What is proven here is the
STRUCTURE (call counts and coalescing), which is what the sibling harnesses prove too. Residuals
the audit named and this pass did not close, in priority order: the geometry service's
IntersectionObserver path is ungated during a gesture, so each auto-scroll frame can fire a
`measureBlock` + a full Marginalia grid repack; `EditorLayout`'s section-path breadcrumb parks for
RESIZE only and runs live on the scroll a drag generates; and three ungoverned scroll listeners
(the editor scrollbar, the scroll-activity tracker, and `EditorPane`'s scroll-persist, which reads
`offsetHeight` per event) run per scroll frame.

### The census half: an invariant with no census is how the others drifted

Same law, and the case where the law was already written, already mandatory, and enforced by a guard that could not see most of the gestures it governed (task 333). `detectWindowDragGesture` is a **conjunction** — a window-level move listener AND drag chrome (a body-cursor write, a CSS resize cursor, or the shared handle classes) — because it was built to catch a bespoke *divider*, and a divider always wears one of those. A whole category of window drag wears none: a scrollbar thumb sets no cursor, and a **hold-threshold detector** (the card lift, the marginalia marker re-anchor, the inline-atom grab, the block grab handle) is chrome-free until it hands off. Eleven files in `src/` install a window-level move listener; the chrome census saw six.

The four it could not see had each drifted differently, and none of them throws:

- the **editor-scrollbar thumb** had NO invariant at all — not even a button gate, so a right-press started a drag whose end event the context menu then ate, and the document ghost-scrolled under a released pointer;
- **`useDragPosition`** (the Preferences window, the app's other bespoke 2D move) had no missed-release bail, so the dialog stayed glued to the cursor and committed on the user's next click with the grabbing cursor and the global `user-select: none` wedged on `<body>` — task 185 verbatim, in a gesture the chrome allowlist already sanctioned. It also read `offsetWidth`/`offsetHeight` inside its RAF body, a forced layout per frame for a value that cannot change mid-drag;
- the **card-lift** and **grab-handle** threshold detectors stayed ARMED after a swallowed mouseup, so the user's next ordinary mouse movement crossed the threshold and popped a card out of the panel — or lifted a block out of the document — from a press they had already let go of;
- the **marginalia marker** watcher leaked its listeners forever, and since each later movement re-armed `suppressClickRef`, the marker's click stopped opening its panel *permanently*.

> **Every file that installs a window/document-level move listener is censused, chrome or no chrome. One that also tears down from a pointer RELEASE owns a held gesture and must REFERENCE the invariants module; and nothing anywhere may re-derive what that module publishes.**

Three legs, and the membership one is deliberately not the interesting one — it is the *reach* that lets the other two ask their question of the whole category. `PERMITTED_WINDOW_POINTER_LISTENERS` carries a per-file justification; the invariants and no-twins allowlists are **EMPTY**, and stay that way: a hit is MIGRATE-it. Four rules it earned:

- **The gesture/watcher line is drawn at the RELEASE TEARDOWN, not by hand.** A permanent hover tracker (`TextObjectGrabHandle`'s `document` mousemove, which resolves which block the handle points at) has no release to miss and owes no invariants — and it is exempt *by construction* rather than by allowlist, because it registers no `mouseup`. That same file's OTHER listener is a gesture and is held to both. A per-file allowlist entry would have exempted both halves at once.
- **A bail is PRE-threshold only where the post-threshold gesture has another owner.** `inline-atom-grab` and `TextObjectGrabHandle` hand off at the threshold — to the drop-mode controller and to `LiftHost`, each of which carries its own bail. Ending the gesture from the *detector* after handoff would commit the drop at a stale coordinate. So the detector bails only in its exclusive ownership window, and says so at the site.
- **The bail alone is not the fix; the END PATH must cancel the queued frame.** A coalesced gesture schedules a frame on a held move; if the missed release lands before that frame runs, a bail that merely stops listening still lets the stale coordinate commit one frame later. `useDragPosition` therefore ends through ONE path that cancels the RAF, clears the chrome and detaches — the "commit once, through one end path" obligation, read as *no ending may skip the teardown*.
- **The no-twins leg sweeps BOTH silos, not just the censused files.** A gesture can take the SSOT for its start gate and hand-write its release bail — which is exactly how `useMarginEdit` sat correct-but-forked, restating the engine's own reasoning verbatim in its own comments. And a `button !== 0` on an ordinary click handler is where the *next* gesture's start gate gets copied from, so nine production sites were converted, not four.

**Whether a shared 2D-move primitive earns its keep** (the question task 334 asks): **not yet.** After this task `FloatingPanel` and `useDragPosition` are the two 2D moves, and what they share is now four *predicates and rules* — all of which live in modules both import or in this prose. What is left un-shared is genuinely per-site: the float snapshots dock bands and a WCO inset and moves by `translate3d` on its own element; the dialog snapshots two clamp bounds and commits React state, because its position IS its session state and there is no persistence to defer. A primitive over two call sites with that little in common buys a parameter bag, not an invariant. **Task 334 confirmed the decline** after closing the two real items behind it (below), and the reason is worth keeping: the copies are held together by shared *predicates*, a shared *census*, and now a per-site *cost statement* — three instruments that each catch a different drift, where a shared hook would have caught only the one nobody was getting wrong.

CI: [bespoke-gesture-missed-release.test.tsx](../../../src/lib/__tests__/bespoke-gesture-missed-release.test.tsx) drives all three REAL gestures (`useDragPosition` through the real hook, the thumb through a real `EditorScrollbar` render, the card lift through a real `PanelCard` press) and every defect leg fails on the pre-fix code, measured. jsdom defaults `buttons` to 0, so every LIVE move in these suites passes `buttons: 1` explicitly — which is how the legs prove the invariant is wired rather than passing vacuously, and why two pre-existing lift suites needed the same field added. The census legs live in the same [pane-drag-guardrail.test.ts](../../../src/lib/__tests__/pane-drag-guardrail.test.ts) as the chrome half; measured on the pre-fix tree they name seven bare gestures and nine re-derived twins.

### The tag half: a convention with no leg is a habit, and the copies had already diverged

Same law, and the case where the instrument that would have caught the drift was written down in one guardrail and merely *imitated* in its sibling (task 334). `keystroke-subscriber-guardrail` has enforced a `[cost: …]` prefix on every justification in every one of its allowlists since Wave-4 P6; `pane-drag-guardrail` carried the convention — task 330's `FloatingPanel` entry opens with one — and enforced it nowhere. So two of its five drag entries and **all five** ResizeObserver entries described the MECHANISM and never the per-event cost: the gate-not-callback shape that let `float-sync` sit on the keystroke list for a year, one file over.

> **Every allowlist in a cost census states, per entry, what one EVENT costs and what one coalesced FRAME writes. A list whose justifications answer a different question (a LOOK, an a11y ROLE, a safety argument) declares `cost: false` and says which — and membership is DISCOVERED from the file's own source, never hand-listed.**

What the tag buys is not tidiness, and the proof is that writing one is what found the bug. Composing the sentence for `focus-band-drag.ts` surfaced a `getBoundingClientRect()` it ran **per move** — a forced layout in the write path for an origin that cannot move under a held pointer, the same shape task 333 took out of `useDragPosition`'s RAF body, and invisible to every other leg in the file: the chrome census asks who installs a listener, the pointer census asks whether it takes the invariants, and neither asks what a move COSTS. A sentence that must name the per-event and per-frame costs *separately* is the cheapest instrument that asks.

Three rules it earned:

- **The membership leg reads this file's own source.** Any `const PERMITTED_*: Record<string, string>` must appear in the `ALLOWLISTS` registry, so a sixth list cannot land untagged. A hand list inside the guard that outlaws hand lists is the task-260 defect one level up — it would sit green while the new list drifted.
- **`cost: false` is an ANSWER, not an escape hatch.** The three non-cost lists (`PERMITTED_UNCHROMED_RESIZERS` — a look; `PERMITTED_ANNOUNCED_SEPARATORS` — a11y semantics; the two EMPTY invariant lists — safety) each state their reason, and the leg requires one. Without that, a real per-event census walks out of the tag rule by relabelling itself.
- **Write the tag as a claim you would have to defend, not as a summary of the code.** The `FloatingPanel` entry recorded its resize branch's uncoalesced per-event commit **as a residual with a task number**, where the pre-334 text argued that a layout write excuses it — and naming it that way is what got it fixed one task later (335). The editor-scrollbar thumb's un-coalesced write is the entry that shows the difference: a scroll position is state the browser itself coalesces to one paint, which is exactly the argument the resize branch could not make.

**And the copies had already diverged, which is the other half of what this task filed.** The lift overlay (`LiftHost`) moves by RAF-coalesced `translate3d` on two portal nodes — the same channel `FloatingPanel`'s `applyTranslate` runs — and it had **no equality bail**, so every frame at an unchanged delta rewrote both nodes' `transform`. That is not a theoretical frame: a hold over a drop target is how people confirm a target before releasing, and the drop controller's edge-zone auto-scroll re-runs its hit-test at a **parked** cursor by design. Two details make the bail correct rather than merely present: it records the TARGET NODES alongside the delta (a node swapped by a ghost↔popout flip must be written even at an unchanged delta), and it records **nothing** when neither node is mounted yet — a frame that ran before the portal committed would otherwise claim the delta as applied and the node would never receive it. The rest value at zero delta (an empty string, not an identity transform) is pinned too, so the two copies of one channel agree on their rest as well as on their bail.

**Residual, stated rather than implied:** `focus-band-drag` is not on the `LayoutGestureBus`, so a one-shot reflow with the button held (a keyboard window resize, Stage Manager, a DPR change) leaves its snapshotted origin stale for the rest of that drag — a constant offset in the transient band, healed by the next mousedown. Same exposure residual (2) above names for the float's snapshot, and stated at the site rather than papered over with a parking claim the file cannot back.

CI: the tag, non-cost-reason and discovered-membership legs live in [pane-drag-guardrail.test.ts](../../../src/lib/__tests__/pane-drag-guardrail.test.ts); the overlay's write channel is driven through the REAL `beginLift` gesture in [lift-overlay-motion-cost.test.tsx](../../../src/text-objects/__tests__/lift-overlay-motion-cost.test.tsx) (one queued frame for eight events, the bail, the rest value, and no stale write behind the missed-release end path); and the focus band's cost claim is pinned where the gesture can be driven, in [focus-band-edge-drag.test.tsx](../../../src/panels/Outline/__tests__/focus-band-edge-drag.test.tsx) — one rect read for fifteen moves, and a fresh read on the NEXT gesture, since a snapshot inherited across drags is the same staleness the reset exists to prevent. Every defect leg was measured by neutering the half it guards.

Drag-time coordination is **edge-only** on the app-wide `LayoutGestureBus` (`isLayoutGestureActive`/`onLayoutGestureChange` — fires once on begin, once on end, never per frame; it replaced the retired `virgil:drag-gap-start/end` window events and `library/lib/gutter-drag.ts`). Followers built on those edges: `PaneFreeze` (width-locks a heavyweight pane's content so pdf.js/ProseMirror see exactly ONE resize per gesture) and `parkDuringLayoutGesture` (geometry observers stash-dirty mid-gesture, settle once on the end edge). This is the "gutter drag chops/hangs/ghost-resumes; chrome outline snaps late" class (library-UI refactor 2026-07). CI: [src/lib/\_\_tests\_\_/pane-drag-guardrail.test.ts](../../../src/lib/__tests__/pane-drag-guardrail.test.ts) greps BOTH silos for window-level move listeners paired with drag chrome (a body-cursor write, a resize cursor token, or the shared `.drag-gap`/`.band-grip` handle classes); every hit must be on `PERMITTED_WINDOW_DRAG_GESTURES` with a why-safe justification (a pane divider never qualifies — migrate it to the engine), the retired primitives are pinned dead, and every library-silo `ResizeObserver` must be on `PERMITTED_LIBRARY_RESIZE_OBSERVERS` (the census with CI teeth — kills the unparked-RO and measured-chrome reintroduction paths). Library-silo doctrine: library/AGENTS.md "Perf doctrine".

### The capture half: the census RECOMMENDED the shape it could not examine

Same law, the third widening of one census (task 439) — and the case where the
guard's own docblock held the offending shape up as a virtue.

`StripButton` ([drag-drop.tsx](../../../src/components/editor-layout/drag-drop.tsx)), the
panel-rail icon drag, is a bespoke held gesture: `onPointerDown` arms an origin,
`onPointerMove` crosses a 5px threshold and calls `setPointerCapture`,
`onPointerUp` commits `movePanel`. It took **none of the four obligations**, for
as long as it has existed, with every leg of `pane-drag-guardrail` green — and
the reason is structural rather than an oversight. Task 333 widened that census
after finding `detectWindowDragGesture` blind to a whole category, and its
widened rule is still *"every file that installs a **window/document-level move
listener** is censused"*. That is a MECHANISM. This gesture installs no window
listener at all; the census's own header even says the element-scoped
pointer-capture shape is *"exactly what this grep is steering new code toward"*.
**Task-404's lesson verbatim — discover a census's population by the QUESTION,
not by the MECHANISM — one census over.**

Three costs, and the first two are correctness:

- **A right-press toggled the panel.** `onPointerUp` fired for ANY button with
  no start gate, so a right-press reached the click branch and opened/closed
  the panel beside the context menu the same press opened. Deterministic, zero
  race. Middle-click likewise.
- **A swallowed release left the gesture ARMED, and the next HOVER became a
  phantom drag.** The origin was cleared only by events the BUTTON received, so
  a press whose release the button never saw (the context menu ate it; the
  pointer left the button under threshold and released elsewhere; a release over
  an iframe) left it set. `pointermove` fires on HOVER with no button held, so
  the user's next pass over the icon crossed the threshold, appended the fixed
  z-9999 ghost, and called `setPointerCapture` on a pointer with **nothing
  pressed** — from then on every pointer event in the document retargeted to
  that strip button, and the next click committed a `movePanel` nobody made.
  Task 185/333's ghost-tracking class with an extra turn of the screw, because
  capture makes it document-wide rather than confined to the gesture.
- **The move path took neither COALESCE nor SNAPSHOT.** Per RAW pointermove it
  wrote the ghost's `left`/`top` (a layout write per event, where this file's own
  law says a moving element moves by `translate3d`) and then re-swept the strip:
  a `paneStrip` resolve, a `querySelectorAll` for its icons, a strip rect and a
  `getBoundingClientRect()` **per button** — forced-layout reads for geometry
  that cannot move under a held pointer. The indicator itself was `position:
  fixed` with `transition: top 0.1s ease`, a main-thread LAYOUT animation
  restarted on most frames, so the tree was never clean and every rect read in
  the app paid a forced flush. Task 351's diagnosis item by item, in a gesture
  351 did not touch.

> **A census over held gestures asks "who owns a pointer the user is HOLDING",
> and that has TWO element-scoped spellings as well as the window one: a file
> that takes POINTER CAPTURE, or a single JSX element pairing a press handler
> with a move/release handler.** Both are censused, both must REFERENCE the
> invariants module, and the invariants allowlist is the SAME empty list the
> window census uses — it is the same claim.

Five rules it earned:

- **Do the correctness half and the cost half TOGETHER.** Splitting them leaves
  this file as the standing counter-example ("the invariants were added and the
  four obligations were not") that the next bespoke gesture copies.
- **The bail runs BEFORE the event's coordinate is read**, and through the ONE
  teardown `cleanupDragArtifacts` already was — which task 141 built and never
  made reachable from a missed release. That teardown cancels the queued frame
  too, or a bailed gesture still commits one frame behind itself (task 333).
- **`armed` is what the start gate EARNS.** Gating `onPointerDown` alone is not
  enough: `onPointerUp` must perform the click/commit only for a gesture this
  component actually armed, or a right-press still falls through to `onClick()`.
- **The snapshot is read through a lazy `geometry()` door by BOTH the hover and
  the release** — the `readMoveGeometry` shape, and the half `FloatingPanel`'s
  own adversarial pass earned: a release reading the raw ref while only the
  hover went through the door is how the two come to answer from different
  tables. Re-armed off the `LayoutGestureBus` SET channel, subscribed on the
  threshold edge and dropped in the teardown, so an idle strip pays nothing.
- **The slot snapshot carries each icon's `panelId`, not just its midpoint.** A
  drop can then NAME what it lands beside rather than only counting — the seam
  an index-space fix needs, deliberately left as a seam rather than folded in.

CI: [strip-button-drag-teardown.test.tsx](../../../src/components/editor-layout/__tests__/strip-button-drag-teardown.test.tsx)
drives the REAL component. **jsdom defaults `PointerEvent.buttons` to 0**, which
the missed-release bail reads as "the release already happened", so every LIVE
event in that file now passes `{ button: 0, buttons: 1 }` explicitly — measured,
all five pre-existing legs fail against the fixed component until the field is
added, which is itself the proof the invariant is wired (the trap AGENTS.md
already records for `bespoke-gesture-missed-release.test.tsx`). The leg with
teeth is the CENSUS — the gesture was never the part that could misbehave, a
population that cannot see it is. Measured by neutering the fix: the seven new
behavioural legs all fail on the pre-439 component (the six teardown legs pass
either way, and are the accepting controls), and the census names
`drag-drop.tsx`.

**Owed, not claimed:** a real-pointer preview eyeball — jsdom's pointer capture
is a stub and the context-menu race cannot be reproduced headlessly. Right-click
a strip icon (menu opens, panel does not toggle); press an icon, drag 3px off it,
release over the editor, then hover back over the strip (no ghost).

### The commit half: a rule stated at 7 of 10 call sites is not an SSOT

Same engine, the VALUE half of task 189's own headline (task 470) — 189 pulled
the a11y semantics into the engine and left the COMMIT POLICY scattered.

The engine called `commit()` on **every** completed gesture, a plain click on a
6-10px divider included, and its own suite pinned that as the contract ("a click
with zero movement still commits the start value exactly once"). Every editor
consumer then hand-wrote the identical four-line guard against it — the SAME
predicate (the engine px against that handle's own `getValue()` snapshot) and
the SAME remedy (the function it already passes as `restore`) — and the editor
adoption suite states the guard as a LAW in its own header. **Six handles
implemented it; four did not**, and three of those four are exactly the ones
whose `getValue()` returns a value the code's own comments say can be SMALLER
than what is stored: `LibraryView`'s nav / list / papers dividers read the
RESOLVED track (`offsetWidth` / `offsetHeight`) against a `clamp()`ed grid
template. So one accidental click on a Library divider on a narrow window wrote
the CLAMPED size into `view-session-store` permanently — widening the window no
longer restored the width, nothing threw, and the user could not tell the click
had done anything. That is the invariant `library-grid-template.ts` opens by
declaring ("the stored value is never rewritten by a mere viewport change"), and
it is Gabriel's own seed symptom from task 457 ("grabbing and then dropping in
the same place — should not change anything") reproduced on the divider family.
Measured against the shipped constants, the list track clamps at any grid
narrower than 792px on the defaults — a laptop, not an edge case.

> **A gesture that produced no NET change has nothing to persist: the engine
> calls `restore()` and commits ZERO times. The engine holds both halves the
> rule needs — `startValue` and `spec.restore` — so the rule is its own, not
> ten consumers'.**

Five rules it earned:

- **`restore()`, never `apply(startValue)`.** A wander-and-return has already
  OVERWRITTEN the style with the snapshot px, which for a `clamp()`ed track is a
  RENDERING of a larger stored value, and mid-drag React may have rendered a
  different flex string than the resting one (`zen-margin` spells this out).
  Only the consumer can re-sync from the source of truth — which is exactly what
  all six retired copies did, so the change is byte-identical for them.
- **The comparison is EXACT px against the `getValue()` snapshot**, and that is
  what keeps the ratio-valued dividers safe: a ratio round-trip
  ((r·track)/track) is not IEEE-exact for ~10% of stored (ratio, track) pairs,
  so a ratio-equality guard would fire a spurious pref write per plain click.
  The engine deliberately does NOT also skip a commit that merely ROUNDS to the
  same persisted integer — it speaks px and knows nothing about a consumer's
  rounding; integer-idempotence belongs inside that consumer's own `commit`.
- **A consumer with no `restore` gets nothing called**, which is strictly better
  than the redundant identical-widths store write `LeftList` used to make.
- **The engine's own suite pinned the DEFECT as the contract**, and is
  renegotiated in place with the reason at the site — as are the four other legs
  that used a zero-move release merely as a witness that a gesture had ENDED.
  Each drives a real move now: with the rule in place, `committed()` after a
  bare click is `[]` whether or not the gesture ever started, so those legs were
  about to become unfalsifiable.
- **The census is the leg with teeth** — the engine was never the part that
  could misbehave, a consumer that re-forks the guard is, and a re-forked guard
  type-checks perfectly and is invisible to every behavioural test of the
  engine (it would simply run BEFORE the engine's branch, as dead code, until
  someone "simplified" the engine).

CI: the zero-move census in
[pane-drag-guardrail.test.ts](../../../src/lib/__tests__/pane-drag-guardrail.test.ts)
resolves every handle's `commit:` body by BALANCING delimiters rather than by
regex — an expression body (`setLayout({ navWidth: Math.round(px) })`) carries
both braces and commas, so a `[^,}]*` cut truncates it and the guard goes blind
on exactly the three sites the defect lived at — and asks per HANDLE, the
granularity the chrome census already earned (`LibraryView` holds three,
`panel-column` two). Allowlist EMPTY; a hit is DELETE-it.
[library-divider-zero-move.test.tsx](../../../library/components/__tests__/library-divider-zero-move.test.tsx)
is the defect leg, and **no pre-470 suite could represent it**: the engine's own
harness commits an unrelated number, so "the committed value is a clamped
rendering of a larger stored one" is unrepresentable there, and
`pane-resize-adoption.test.tsx` — which states the law in its own header — never
touches the Library silo, which is why three unguarded handles shipped green.
Measured by neutering the engine's branch with the six consumer guards already
gone: **11 legs fail**, five of them the editor adoption suite's own zero-move
legs, unchanged — they pass because of the engine now, which is the point.

**Owed, not claimed:** the preview eyeball. Not FSA-masked (pure pointer +
localStorage). Narrow the window until the Library list track visibly clamps,
click the list divider once without moving, widen the window, and confirm the
list returns to its stored width.

### The key half: a live gesture CLAIMS the keys it answers

Same engine, the KEYBOARD (task 471) — and the case where the rule was already
written down one level *below* and the gesture was the one owner that never
took it.

The engine cancels a live divider drag on Escape from a `window` **capture**
listener, and it neither `preventDefault`ed nor `stopPropagation`ed. Capture
phase makes it run FIRST; it does not make it run ALONE. So one press ran every
other Escape owner in the app, and the two that cost real work are:

- **`useMarginEdit`** — a `window` **bubble** listener whose `cancel()` drops
  `liveMargins`, which is where all four guides' drag results live until the
  user presses Save. Cancelling a panel-gutter drag while margin-edit mode was
  on therefore discarded **the whole margin-edit session** and closed the mode
  under the user. Not a race: a window-capture listener always precedes a
  window-bubble one for the same event, so this happened on every such press —
  and margin-edit is precisely the mode in which a user is also nudging panel
  widths.
- **The dialog stack** — `document` **capture**, which is upstream of window
  bubble, and whose Escape branch *deliberately* ignores `defaultPrevented`
  ("a modal always has a way out", "The cue half"). So a scrimless draggable
  window closed from the same press: Preferences, and the bug reporter with a
  half-typed report in it. That one is why the claim must be the PAIR —
  `preventDefault()` alone does not reach it.

> **A live pointer gesture is the INNERMOST transient thing on screen — more
> transient than any dialog, menu or mode left open behind it — so one press
> ends exactly one thing.** `claimGestureKey` (the third rule in
> [pointer-invariants.ts](../../../src/lib/pane-resize/pointer-invariants.ts), beside
> `isPrimaryDragStart` and `isMissedRelease`) is that claim, and a bespoke
> gesture imports it rather than re-deriving it.

Four rules it earned:

- **Virgil already stated this one level down and for a less transient thing.**
  Task 389 built `dialog-stack.ts` so that only the TOP dialog answers a key.
  A gesture outranks every dialog on screen and was the only Escape owner that
  did not say so.
- **It claims PROPAGATION, not the target — stated at the site so nobody
  rediscovers it as a bug.** `stopPropagation()` does not stop a listener
  already registered on the SAME target in the SAME phase, so an open menu's
  `window`+capture handlers (`useMenuDismiss`, `useMenuKeyboard`) still run.
  Accepted: a menu is dismissed by the divider's own `pointerdown` long before
  Escape, and `stopImmediatePropagation()` — the only thing that would reach
  them — would also silence unrelated same-target listeners the app depends on
  (`input-modality`'s typing tracker is exactly the shape this file says must
  never be silenced).
- **The gate stays in the SSOT rather than in the consumers.** The surgical
  alternative was to gate `useMarginEdit`'s Escape on `isLayoutGestureActive()`
  — which closes the one reported pair, leaves the dialog-stack pair open, and
  puts knowledge of the gesture bus inside a hook that has no other business
  with it. That is re-forking the rule into the consumers, which is the inverse
  of what the engine exists for.
- **A mode is not a claimant.** `useMarginEdit`'s own Escape keeps its lone
  `preventDefault()` and is deliberately NOT converted: margin-edit is a MODE,
  not the innermost transient thing on screen, and the census's fixtures pin
  that distinction so a later sweep does not "unify" them.

CI: three legs in
[use-pane-resize-handle.test.tsx](../../../src/lib/pane-resize/__tests__/use-pane-resize-handle.test.tsx)
drive a live gesture with the two real owners registered at their real
receiver+phase (`window`/bubble and `document`/capture) and dispatch ONE press
**from inside the document**, because a press dispatched at `window` has a
propagation path of just `[window]` and can never reach a `document` listener —
i.e. the obvious harness makes the leg unfalsifiable. The two accepting controls
are load-bearing: with no gesture live BOTH owners must still fire (an engine
that silenced Escape app-wide would be a worse bug than the one being fixed),
and a non-Escape key during a live gesture must reach both. The census in
[pane-drag-guardrail.test.ts](../../../src/lib/__tests__/pane-drag-guardrail.test.ts)
(`PERMITTED_REDERIVED_KEY_CLAIMS`, EMPTY) resolves each
`window`/`document.addEventListener("keydown", <name>)` handler by NAME and
brace-matches its body — two looser needles were tried and both were wrong on
this tree, measured, and the second one is the interesting one: it indicted
`Marginalia` and `panel-primitives`, whose hits are real key claims on a leaf
`<button>`. A component key handler is answering for ITSELF, not standing in
front of every other owner in the app, and its question lives in
`card-delete-key-door.test.ts`. Measured by neutering: the engine claim takes 1
behavioural leg, and a hand-written claim planted on a real gesture file takes
the census.

**Owed, not claimed:** the preview eyeball. Not FSA-masked. Enter margin-edit,
drag two guides, grab a panel gutter, press Escape — the guides must still be
where you dragged them and the mode must still be open.

#### The second member: the same disease in the gesture people actually use

Same rule, the CONTENT drag (task 504) — and the case where 471 stated the
class, fixed one member, and recorded the other as out of scope. The drop-mode
controller is the single chokepoint every pointer-driven content drag routes
through (block lift, text-object drag, inline-atom grab, card-anchor drag,
stack pull), and its Escape was UNCLAIMED — so cancelling a drag discarded
every margin guide dragged this session and closed a scrimless Preferences or
bug-report window, exactly as 471 describes, on a gesture far more common than
a divider drag.

Three rules it earned:

- **The PHASE is half the fix, and the claim alone buys nothing here.** The
  engine's listener is `window` + CAPTURE, so a claim added there reaches
  everything downstream. This one was `window` + BUBBLE — the LAST phase —
  where `document` capture (the dialog stack) has already run and
  `useMarginEdit` is a same-target same-phase listener registered FIRST, which
  `stopPropagation` cannot reach (and `stopImmediatePropagation` is ruled out
  by the SSOT's own stated limit). Measured: a bubble-phase claim fails the
  defect leg exactly as the unfixed controller does.
- **A capture listener is NOT removed by a bubble-phase removal**, so the
  teardown moves with the registration or the claim outlives the gesture —
  installed app-wide for the rest of the session, cancelling a session that no
  longer exists and stopping every other owner from seeing the press. Measured:
  a mismatched removal takes 2 legs, one of them the "no session live" control.
- **Claiming is safe because the listener is strictly gesture-scoped**, and
  both halves of that were checked at source rather than assumed:
  `removeListeners()` is the ONE end path every session ending funnels through,
  and `commitDropSession` calls it BEFORE awaiting any confirm dialog — so the
  handler is already gone by the time a dialog can want the key.

**The real deepening is the POSITIVE census leg**, and it is the leg that would
have caught BOTH members. `PERMITTED_REDERIVED_KEY_CLAIMS` is a NEGATIVE
question — does a gesture that DOES claim spell the claim by hand? — and is
structurally blind to a gesture that claims NOTHING, which spells no banned
form and reads as ordinary code. `PERMITTED_UNCLAIMED_GESTURE_KEYS` (EMPTY, a
hit is CLAIM-it) asks the other half, over a DISCOVERED population: a keydown
handler whose `removeEventListener` sits in the same region as the teardown of
a pointer MOVE/RELEASE listener — i.e. one whose lifetime IS the gesture's. The
region is resolved by walking OUTWARD from the removal and stopping at the
first FUNCTION body, which is what makes the exclusions structural rather than
allowlisted: the engine's `finally` block and the controller's
`removeListeners()` body are both caught at level 1, while `useMarginEdit`'s
MODE-level Escape — removed by a `useEffect` cleanup with no pointer teardown —
is excluded BY CONSTRUCTION, since a mode is deliberately not a claimant. Its
population **includes the ENGINE directory**, unlike every other census in this
file: there the engine is the answer and is rightly excluded, here it is a
MEMBER and the class's first offender, so a leg that could not see it would
only ever have caught the second one. An unresolvable handler fails CLOSED.

CI: [drag-escape-claim.test.ts](../../../src/components/drop-mode/__tests__/drag-escape-claim.test.ts)
drives the REAL controller through a live session with the two real owners
registered at their real receiver+phase and ONE press dispatched **from inside
the document** (471's recorded harness trap — a press dispatched at `window` has
a propagation path of just `[window]` and can never reach a `document`
listener, which is exactly the observation a phase fix needs). Its two accepting
controls are the same two 471 earned. Measured by neutering each half in turn:
the pre-504 handler takes 1 behavioural leg plus the census, a bubble-phase
claim 1, and a mismatched capture removal 2.

**Owed, not claimed:** the preview eyeball, and it is cheap and real (NOT
FSA-masked): margin-edit on with two guides dragged and Preferences open, start
dragging a block, press Escape — the drag cancels, the guides stay, the mode
stays open, Preferences stays open.

### The third ghost: one cursor-following channel, not three copies (task 773)

The inline-atom drag ghost (`InlineAtomGhost` ← `inline-atom-ghost.ts`) was the third copy of the cursor-following overlay and the one that never converged: its store emitted a new state per RAW mousemove, so every event re-rendered the portal and wrote `left`/`top` on a `position:fixed` node. It now moves on [`createTransformChannel`](../../../src/lib/transform-channel.ts) — the ONE shape (COALESCE to a frame, BAIL on value + target identity, record nothing while no target is mounted, `cancel()` on the end path), which `LiftHost` also now runs instead of its hand-rolled copy. The store emits on EDGES only (lift, end); the ghost's base box sits at the viewport origin and its whole placement, including the off-cursor flip, is one transform; its ref (`attachGhostNode`) flushes the live cursor synchronously at mount so it never paints at the origin. A new cursor-following overlay takes this channel rather than a fourth copy. CI: [inline-atom-ghost-motion-cost.test.tsx](../../../src/components/drop-mode/__tests__/inline-atom-ghost-motion-cost.test.tsx) (driven through the real grab; 4 of 5 legs fail on the pre-773 code, the end-path leg guards the channel's `cancel`), plus the unchanged `lift-overlay-motion-cost.test.tsx`.
