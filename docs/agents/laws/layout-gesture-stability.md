<!-- last-verified: aea05929 2026-09-20 -->
<!-- derives-from: AGENTS.md#laws -->

# Layout-gesture stability

> **A continuous layout gesture — a pane-divider drag, an OS window resize, OR a content drag (drop-mode session) — costs O(1) settles, not O(frames) recomputes.** Every geometry follower either **PARKS** (`parkDuringLayoutGesture`: stash the call, replay exactly once on the gesture's end edge) or **SUPPRESSES** (`useLayoutGestureActive` / `isLayoutGestureActive` / `onLayoutGestureChange`: hide for the gesture, restore on the end edge). Nothing re-solves per frame.

This is the "resizing the PWA window makes the whole right side flicker" class (task 317), and its lesson is not that followers were sloppy — the doctrine above already existed and was **structurally unreachable for the gesture that needs it most**. `activeDrag` had exactly one writer repo-wide, `beginPaneDrag` inside the engine's `onPointerDown`, and **an OS window drag delivers no pointer events to the page at all**. So `isPaneDragging()` was false for the entire gesture: every park took its immediate-`run()` branch, `PaneFreeze` never locked, `parkDuringPaneDrag` had zero callers in `src/`, and the three `library/` consumers were inert while their comments asserted a freeze that wasn't there. Eighteen `addEventListener("resize")` sites and ~17 ResizeObservers ran live, every frame.

**One bus, three publishers.** [src/lib/pane-resize/layout-gesture-bus.ts](../../../src/lib/pane-resize/layout-gesture-bus.ts) carries `kind: "pane" | "window" | "content"` on the info, so every pre-existing consumer gained window — and then content-drag — coverage with zero code change. One bus rather than several because the consumer set is identical and *the second subscription is exactly the one that gets forgotten* — this bug's own signature was `RightDetail` parking its ResizeObserver on the pane bus while registering a raw window `resize` listener to the same scheduler 38 lines away. The publishers stay **separate** (pointer edges, resize-burst edges, and the drop-mode session lifecycle are genuinely different detectors) and **colocated** (the edge functions are withheld from the barrel, so no consumer can fake an edge). The bus tracks a **set** and publishes only 0→1 / 1→0 on the main channel, because a pane drag and a window reflow (external display, Stage Manager) can overlap and an end edge published mid-gesture would un-park every follower.

**The content publisher** (perf Wave 2): a drop-mode session — block / text-object / inline-atom / card-anchor / stack-pull drag — publishes through `beginContentGesture`/`endContentGesture`, whose kind is pinned inside the bus and whose ONE legitimate caller is the drop-mode controller (the single chokepoint every pointer-driven content drag routes through; CI: [src/lib/\_\_tests\_\_/content-drag-guardrail.test.ts](../../../src/lib/__tests__/content-drag-guardrail.test.ts) pins the import set). Edges: begin on session start; end at **commit entry** (the pointer gesture is over — a confirm dialog must not hold every park hostage) and idempotently in `endDropSession`, so no cancel path can leak a wedged gesture. Every producer is a hold-drag, so the controller's shared mousemove AND the lift overlay bail on `isMissedRelease` — with the bus in the loop, a swallowed mouseup would otherwise wedge every parked follower app-wide, not just leak an overlay. The same guardrail pins the rest of the content-drag law: the lift overlay moves by RAF-coalesced `translate3d` (React renders on edges only; JSX never sets `transform`), the Wave-0 universal drop-mode selector stays dead, and the hit-test move path never mints. The controller also owns edge-zone **auto-scroll** ([src/components/drop-mode/auto-scroll.ts](../../../src/components/drop-mode/auto-scroll.ts)) — one self-terminating RAF loop that re-runs the throttled hit-test as content slides under the parked pointer; zero cost off the drag path.

**Kind-sensitive consumers use the SET channel, never the edge info.** The main channel publishes only OUTERMOST edges, so under overlap its begin and end can carry DIFFERENT gestures — an `info.kind` (or `info.id`) filter there skips the restore half and wedges the consumer. `onLayoutGestureSetChange` fires on every MEMBERSHIP change with that gesture's own info (still ≤2 fires per gesture, never per frame), and `hasActiveLayoutGesture(kinds)` reads the live set — recompute the desired state from it per fire, idempotently. On it today: `PaneFreeze` freezes for RESIZE-family only (a content drag must never freeze the pane hosting the drag — the Library Reader's `.tex` branch mounts an EditorPane inside one) and unfreezes the moment the last resize gesture leaves, even mid-content-drag; the editor-scrollbar thumb suppress is kind-filtered (a content drag moves no pane edge, and drag auto-scroll wants the thumb visible); `zen-margin` + `panel-column` id-filter on it (their old edge-channel id filters could strand `isResizing` under overlap). `useLayoutGestureActive(kinds?)` is the hook form of the same rule.

**The window publisher's edges**, the one genuinely new piece, since there is no `resizestart` and no pointer stream to derive one from: **BEGIN** on the *second* resize event inside a 100 ms burst — so a one-shot resize (maximize, zoom, keyboard, DPR change) never parks anything and nothing is left stale for a debounce window; **END** on a 150 ms trailing idle. A false end (the user holds still mid-drag) is benign by construction: followers settle once at the held position and re-park on the next event.

**A FOLLOWER asks the kind-blind question; an OWNER names its kinds** (task 472). Nearly every reader of this bus is a follower — it parks or suppresses because a gesture of ANY kind can move content under it, so `isLayoutGestureActive()` is exactly right there and five production files spell the bare `if (isLayoutGestureActive()) return;` form legitimately. There is one reader on the other side: the engine's own start gate, which asks a mutual-EXCLUSION question, and whose scope is *the kinds that contend for the singletons a second gesture would clobber*. Those are the drag shield plus the saved body cursor / `user-select` ([drag-shield.ts](../../../src/lib/pane-resize/drag-shield.ts)) — engine-owned, so PANE-only, and the gate reads `hasActiveLayoutGesture(EXCLUSION_KINDS)` with `EXCLUSION_KINDS = ["pane"]`. Three rules it earned:

- **The comment said PANE and the predicate said ANY**, which is how the two costs went unnoticed for as long as the bus has carried three kinds: a divider press inside the window publisher's 150 ms trailing-idle tail (`RESIZE_IDLE_MS`, below) was **silently swallowed** — grab a divider straight after dragging the OS window edge and the first press does nothing, no cursor change, no grip escalation — and one wedged drop-mode session would have **disabled every divider in the app**, in both silos, until a reload. AGENTS.md already recorded that a swallowed mouseup there "would wedge every parked follower app-wide"; this second blast radius was never written down.
- **It is a POINT-IN-TIME read, so the SET-channel rule above does not apply.** That rule governs an `info.kind` filter inside an outermost-EDGE listener, where the begin and end edges can carry different kinds; a predicate asked once, synchronously, inside a `pointerdown` has no edge to miss. Said at the site too, or the next reader "fixes" the scope back.
- **`content` never belongs in the exclusion set** — that is the failure mode, not a guard. `["pane", "window"]` is the sanctioned fallback if a reviewer decides a divider drag *during* a live OS reflow is worth refusing; it still closes the unbounded half. The multi-touch case needs no scope of its own: the gate's `isPrimaryDragStart` already refuses a non-primary pointer.

CI: the scope census in [pane-drag-guardrail.test.ts](../../../src/lib/__tests__/pane-drag-guardrail.test.ts) ("start-gate SCOPE"), whose POPULATION is the ENGINE FILE and not a two-silo sweep — stated because it is the load-bearing choice: the bare-return form is also how a follower suppresses, so a wholesale sweep would be the WRONG population rather than a stricter one, and the leg would carry no signal at all. Beside it, three behavioural legs in [use-pane-resize-handle.test.tsx](../../../src/lib/pane-resize/__tests__/use-pane-resize-handle.test.tsx) drive the REAL bus (`__emitWindowResizeForTest` for the window publisher, `beginContentGesture` for the content one): a press during a WINDOW gesture starts, a press during a CONTENT gesture starts, and a second PANE gesture is still refused — the last a non-regression pin that passes either way and says so at the site. Measured by neutering the scope back to kind-blind: 2 behavioural legs and the census fail.

**Park or suppress — the choice is not stylistic.** Park a follower that MEASURES the resizing content from outside: nothing user-visible depends on its value mid-gesture, so it settles once and is correct. Suppress a **text-anchored overlay** (the slash popup, the selection bolt, the pending-change pill): parking one leaves it visibly *detached* from the text it points at, which is worse than the flicker it was meant to fix. Stay LIVE only where the frame itself is the obligation — today just `useWindowChrome` (the WCO strip tracks the native system buttons), and even that is RAF-coalesced, because it notifies through `useSyncExternalStore` at the app ROOT.

**Honest about the residual.** The left-edge asymmetry Gabriel reported is *compositor-side*, not ours: every placement path in both silos is client-origin-relative (`screenX`/`outerWidth`/`visualViewport` appear nowhere), so for the same resulting size a left- and a right-edge drag deliver byte-identical values to every handler — the DOM cannot observe which edge moved. What is ours is the *missed frame*; Chromium converts a missed frame on a moving frame-origin into a whole-window displacement rather than a stale edge strip. Removing our per-frame work removes the late frames. Expect a large improvement, not perfection. What IS ours on the right side: the editor column carries `flex: 1000 1 0` between two `flex-grow:1` rails, so a width delta moves its left edge ~0.001·d and its **right edge ~0.999·d** — identical JS lag is sub-pixel on left-anchored chrome and full-delta on right-anchored chrome, which is why the left-anchored grab handles never visibly flickered under the same handler count.

Two guards enforce it (the same probe + grep-allowlist pattern as the laws above):

- **Runtime probe** — `window.__layoutGestureStats()` ([src/lib/layout-gesture-probe.ts](../../../src/lib/layout-gesture-probe.ts)) reports `{ gestures, framesInGesture, active }` plus per-site `{ parkedFires, settles, liveRuns }`. During a continuous drag every parked site reports `settles === 0` and `parkedFires ≈ framesInGesture`; after release, **exactly 1** settle per site that fired; a one-shot resize reports `gestures === 0`. Honest floor: the publisher needs two events to know a gesture started, so a real drag's first event or two run live and are counted in `liveRuns`.
- **Grep-allowlist test** — [src/lib/\_\_tests\_\_/window-resize-guardrail.test.ts](../../../src/lib/__tests__/window-resize-guardrail.test.ts) censuses every resize registration in `src/` **and** `library/` (`addEventListener("resize"` on any receiver, plus the `onresize =` and `visualViewport` forms) against `PERMITTED_RESIZE_LISTENERS`, and — the leg with teeth — asserts each censused file actually *references* the park/suppress API unless it is on `PERMITTED_LIVE_RESIZE_HANDLERS` with a why-live justification. **None of the three older censuses greps a resize listener**, and that gap is precisely how eighteen ungoverned sites accumulated without a single CI failure. Keep this prose and both allowlists in sync — same discipline as the other laws.

### The scroll half: a CONTENT drag scrolls the document, so its followers are the SCROLL listeners

> **A pane drag and a window resize scroll nothing — but a CONTENT drag scrolls
> the document ITSELF, so during that gesture every scroll listener is a
> per-frame follower exactly as every resize listener is a window drag's.** A
> user scroll is not a layout gesture, so the same park is a no-op for ordinary
> scroll-tracking chrome; the rule costs nothing outside a drag.

This is the residual half of the "list drag and drop is an absolute mess" report
(task 416; the placement half is "The candidate half" below, the performance
half was task 351). The content publisher has been on the bus since perf Wave 2
and reached **none** of the scroll listeners, because every census in this file
asks a question that cannot see one: `keystroke-subscriber` greps
`editor.on(…)`, `scroll-reposition` greps `position: fixed` + `coordsAtPos`,
`pane-drag` greps pointer moves + drag chrome, and `window-resize` greps
`resize`. Meanwhile [auto-scroll.ts](../../../src/components/drop-mode/auto-scroll.ts)
writes `scrollTop` once per RAF for the whole of a long drag, so four followers
ran per auto-scroll frame with CI green:

- **The two section-path breadcrumb walks** (`EditorLayout` and the Reader's
  twin), whose comment stated the exemption outright — *"the scroll path stays
  live: a breadcrumb must follow the scroll it describes."* True of a scroll the
  USER performs, and blind to the one a drag performs. `compute` is ONE
  `posAtCoords` + a binary search on the fast path and an O(headings)
  `coordsAtPos` walk on the flag-off fallback, which is the single heaviest
  per-frame cost in the app at ×1 pane (×2 with the Reader).
- **`EditorPane`'s scroll-position persist**, whose `el.offsetHeight` is a
  FORCED-LAYOUT read once per scroll event, interleaved with the drop
  indicator's own React `top` write — the write → read → write thrash the
  float-move law names. Parking is also the semantically right answer: the value
  captured is *where the reader left the document*, and mid-gesture there is no
  such position.
- **The grab handle's placement re-solve.** Task 317 parked its resize path and
  argued the scroll path could stay live because *"an OS window drag delivers no
  pointer events to the page."* A content drag delivers them, so task 336's
  modality gate reads POINTER and the hover branch stayed answerable: it re-ran
  `blocksAtY` plus one `computePlacement` per containing level for the whole
  drag — under a lift ghost, on chrome `globals.css` has already made
  `pointer-events: none` for the session. Its MOUSEMOVE path has parked since
  perf Wave 2, so the scroll path was the last live refresher and closing it
  finishes a decision already taken rather than making a new one.
- **The geometry service's IntersectionObserver.** `onResize` has been
  gesture-gated since 317 and `onIntersection` never was, although the IO is the
  one the auto-scroll actually fires: blocks cross the ±800 px near-zone
  boundary continuously, each crossing paying a `measureBlock` plus a
  `notify()` — the marginalia deck's full repack, the one O(markers) cost in
  that file — and each BATCH paying one unconditional `host.getBoundingClientRect()`
  even when it measured nothing.

Five rules it earned:

- **A kind-blind park is EXACTLY right here, and that is worth stating rather
  than reaching for `hasActiveLayoutGesture`.** A pane drag and a window resize
  produce no scroll OF THEIR OWN, so the park is essentially unreachable for
  them — and where a rewrap that shortens the scroll range does make the UA
  clamp and fire one, parking is the answer 317 already chose for that gesture,
  so the kind-blind form is not merely harmless there but correct. One park per
  follower covers all three families with no filter to keep in step.
- **ONE park, one clock, one settle — a second park publishes a HOLED deck.**
  The adversarial pass on this fix found the first cut using a separate notify
  park, and the two settle through different clocks: `scheduleRecompute` only
  ARMS a RAF while `notify()` is synchronous, so the deck was announced one
  full frame BEFORE the measures it was announcing, against a cache holding
  every mid-gesture LEAVE eviction and none of the deferred ENTER measurements.
  Every block that left and re-entered the near zone during the drag lost its
  marker for a painted frame at drop time, and the gesture cost TWO O(markers)
  repacks instead of the one the code claimed. The deferred notification rides
  the recompute park as a flag (`pendingNotify`), so `flushRecompute` measures
  and then publishes.
- **Defer the MEASUREMENT, never the BOOKKEEPING.** The IO's observed set is the
  engine's memory of which blocks it is tracking, and a swallowed crossing
  leaves it permanently wrong after the drag — including the detach-heal path,
  whose whole job is to re-observe an element ProseMirror redrew. So mid-gesture
  the ENTER branch observes, joins the set and runs the heal, and only the
  measure defers, onto the same `pendingRecompute` work list `onResize` already
  collects into. Same shape as "park the MEASURE PASS, never the accumulation".
- **A forced-layout read belongs behind the branch that needs it.** The host
  rect resolves LAZILY now, for the same reason the position resolver already
  did — a batch that measures nothing (a pure scroll-away, or any batch during a
  gesture) must pay nothing.
- **"Live" buys a per-frame OBLIGATION, never a per-frame COST.** The four
  followers that stay live are the ones for which the scroll ITSELF is the
  feedback — the scrollbar thumb (whose suppress is already kind-filtered so a
  content drag keeps it VISIBLE), the Library page lozenge and its page readout,
  a hint that must vanish, and the reposition probe that cannot park on the
  gestures it instruments. Each is O(1) per event with no doc walk. The
  scroll-activity tracker earned its place by getting CHEAPER: `setAttribute`
  invalidates style even when the value is unchanged, so the write is now
  idempotence-gated and a continuous scroll costs one invalidation instead of
  one per frame.
- **The detector's own first cut was narrower than its doctrine, which is the
  hole every census in this file has had to be widened out of once.** React's
  `onScroll={…}` prop registers the same listener and fires once per scroll
  frame, and the Library silo uses it for two real followers (the list's
  virtual window, the Reader's position persist — the second reachable by a
  content drag, since the Reader mounts an `EditorPane` inside its scroller).
  An `addEventListener`-only grep saw neither. Both were found by asking the
  QUESTION rather than by trusting the regex, which is the only thing that
  ever widens a census. The residual it still carries is named rather than
  waved away — `useEditorScrollParentEvent` takes the event NAME as a
  parameter and is documented as the way to attach an editor scroll listener,
  so the census's file list is accurate only because that helper has no
  callers yet.
- **The census is the leg with teeth, and leg 2 is per FILE — so the
  justifications are written about the SCROLL path.** `editor-scrollbar.tsx` is
  the live example: its resize path parks and its thumb suppresses, so it passes
  participation on a scroll path that is deliberately live. The pre-416
  breadcrumbs were the same shape in the other direction — a park existed in the
  file while the heavier path ran raw — which is why four per-site pins sit
  beside the census.

CI: [scroll-listener-guardrail.test.ts](../../../src/lib/__tests__/scroll-listener-guardrail.test.ts)
(the fifth grep-allowlist sibling: `PERMITTED_SCROLL_LISTENERS` +
`PERMITTED_LIVE_SCROLL_HANDLERS`, plus the four converted-site pins, each of
which fails on the pre-416 source) and
[gesture-scroll-parking.test.tsx](../../../src/lib/editor-geometry/__tests__/gesture-scroll-parking.test.tsx),
which drives the REAL service through a REAL content gesture. **No pre-416 suite
could see any of this**: every geometry suite in the repo drives the observers
with no gesture live, where the parked and unparked paths are byte-identical by
construction. Measured by neutering each half in turn: the pre-416 handler
takes 6 legs, a whole-handler bail (the shape the bookkeeping rule outlaws) 5
— including the detach-heal leg no fixture that primed every block could have
reached — a second notify park 1, dropping the per-batch host-rect memo 1, and
each converted site its own census pin.

**Owed, not claimed:** a DevTools trace of a 5 s drag over `doc_perftest` with
no >8 ms task attributable to the drag path, plus Gabriel's own feel check.
A worktree cannot run the dev server, so both happen against clean `main`.

Deliberately NOT done, and a UX call rather than an oversight: **no root-level `PaneFreeze`**. Its anchor must be the *stationary* edge (anchoring to the moving one is visibly worse than no freeze at all), knowing which window edge moved requires a `screenX`/`screenY` probe this codebase otherwise doesn't use, and freezing the whole app during a live OS resize shows background slivers until release.
