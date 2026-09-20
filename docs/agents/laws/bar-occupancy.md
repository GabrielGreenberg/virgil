<!-- last-verified: aea05929 2026-09-20 -->
<!-- derives-from: AGENTS.md#laws -->

# Bar occupancy: several occupants, ONE priority rule

> **Where several elements share a fixed-width strip, they do not position
> themselves against each other — the strip RESOLVES a priority ladder, once,
> from measured natural widths, and the lowest tier yields.** The ladder for the
> Virgil bar is stated in
> [src/components/editor-layout/bar-occupancy.ts](../../../src/components/editor-layout/bar-occupancy.ts)
> (protected status > tabs > collapsible tools; `STYLE_GUIDE.md` → "Occupancy
> priority") and resolved by `useBarOccupancy` from ONE ResizeObserver over three
> boxes. When tier 2 still does not fit after tier 3 has yielded, it DEGRADES in
> a stated order rather than clipping — compress, then scroll (task 561, "The
> overflow half" below). Under it sits a structural FLOOR: the tab row lives in
> a scroll container, which clips, so an overlap is unrepresentable rather than
> merely avoided.

This is the "tool icons paint across the tab label at a narrow window" class
(task 395), and it is the marginalia lane's law one strip over — same shape as
"The lane regime" and "The ordering half" below, arriving in the bar because
`TabStrip` is `flex-1 min-w-0` while every tab inside it is `shrink-0` with no
clip, and `StatusCluster` is `shrink-0`. Three occupants, no negotiation: the tab
row simply spilled RIGHT and the two interleaved by paint order.

**The prose outlived the mechanism by two months, which is why it read as safe.**
`TopBar` promised "the toolbar never overlaps tabs even when they crowd the
middle", clamped against a "topbar-left sentinel" `TabStrip` described in a
comment — with NO element and no consumer anywhere. Git archaeology: the clamp
was real once (`1b2bed95`, a floating MenuBar pod with two ResizeObservers on the
bar's left and right groups), the pod moved into the pod chrome header
(`93b286c0`) and its `menuLocation` pref was deleted as dead (`bab3a399`). The
task-202 shape, in comments rather than exports: **a comment describing a
retired mechanism is how the next reader concludes the invariant is held.**

Four rules it earned:

- **The predicate is STATE-INDEPENDENT, so it needs neither hysteresis nor a
  cached "width in the other state".** Written naively — *do the tabs overflow
  their box?* — collapsing frees room, the tabs then fit, the rule expands, and
  it re-collapses on the next frame, forever, in the band where the freed width
  is just enough. The strip's own assigned box already nets out the protected
  width AND (while expanded) the tools, so `T + (collapsed ? K : 0) ≤ tabStripPx`
  reduces to `T + K + R ≤ W` in BOTH states. Cancellation, not damping.
- **Live during a layout gesture, deliberately** — the `useWindowChrome`
  exemption in "Layout-gesture stability" above. Parking the verdict means the
  bar visibly overlaps for the whole of an OS window drag, which is the defect.
  Affordable because the per-fire cost is three `contentRect.width` reads
  (post-layout, forces no layout) behind a per-role equality bail plus one
  boolean; a whole resize drag commits ONE React render, at the crossing.
- **The rule governs the DEFAULT; the user outranks it — and an override is
  minted only where there is something to out-rank.** The auto rule never writes
  the persisted `topbarRightCollapsed` pref, and expanding out of an AUTO
  collapse sets a session override dropped on the auto TRUE→FALSE edge, so the
  chip is never a control that does nothing (the false-affordance class). The
  half worth carrying forward is the *mint* condition, which the first cut got
  wrong: `setExpandOverride(autoRef.current)`, never a bare `true`. An override
  created while nothing was crowding has no expiry — its drop fires on an edge
  that never comes — so an ordinary wide-window collapse-then-expand left a
  sticky override that disabled the rule for the session and clipped the tab row
  instead of yielding the tools, the exact inverse of the priority. **An
  override's lifetime is the condition it overrides; if that condition is
  absent, so is the override.**
- **Nothing in a HIGHER tier may change width as a function of the verdict**, or
  the state-independence above is false and the flip-flop is back. `R` is only
  constant across the verdict because tier 1 does not react to it — which is why
  `SaveStateBadge` reads the user's `collapsePreference` and not the effective
  value. It is the same fact as the ladder's own rule (a data-integrity surface
  is not hideable by a layout preference), arriving as a soundness requirement:
  a tier-1 element that hid itself on an auto collapse would shrink `R`, grow
  the strip by more than `K`, and make the two states disagree.
- **The collapsible group collapses by WIDTH, not by unmounting**, which is what
  makes rule 1 cheap: its `max-content` wrapper keeps reporting the group's
  natural width in both states. That is a measurement decision, and it leaves
  three debts the unmount used to pay, all of them owed on the collapse EDGE:
  (a) the children are REMOUNTED (a `key` on the inner content, never on the
  measured wrapper — keying that would drop the measurement and fail the rule
  open into a flip-flop), because `visibility: hidden` cannot reach a child that
  body-PORTALS its dropdown and a remount closes every such menu for every
  portal owner present and future, where a per-child gate closes it for the one
  somebody remembered; (b) focus moves to the chip, since `aria-hidden` over a
  focused element is forbidden and the chip is the affordance that brings the
  group back — tracked as focus-WITHIN on the group, because `activeElement` has
  already fallen to `<body>` by the time any effect can ask, and asking
  "is it body?" would steal focus whenever the bar collapsed with nothing
  focused; (c) the clip is CONDITIONAL — an unconditional `overflow: hidden`
  trims every button's focus ring in the expanded state too. A surface whose
  open state lives OUTSIDE the group (the help menu, owned by `EditorLayout`) is
  unaffected by a remount and is gated explicitly, exactly as unmounting left it.

A composed ref on a measured element is a **stable** `useCallback`, never an
inline arrow: React detaches and re-attaches an unstable ref callback on every
render, and this one's detach drops the strip's measurement, so an inline arrow
makes an ordinary re-render look like "the tab strip left the bar" and can bounce
the verdict against its own re-renders (measured — the suite hung until it was
stabilized).

CI: [bar-occupancy.test.tsx](../../../src/components/editor-layout/__tests__/bar-occupancy.test.tsx)
drives the REAL `TopBar` (real `TabStrip`, real `StatusCluster`) through a fake
`ResizeObserver`, because jsdom has no layout and "the boxes do not intersect" is
not a question it can answer at all — what IS measurable is the DECISION, and the
flip-flop leg is the one a naive overflow rule fails. Its census covers the two
halves no render can see: the strip's `overflow-x: clip` / `overflow-y: visible`
pair (`hidden` would coerce the vertical axis to `auto` and eat the active tab's
seam overhang), and the shared label cap — declared in the inline renderer and
NOT in the active folder tab, whose `calc-size(max-content, …)` width therefore
grew without bound with the document's name. Measured by neutering each half in
turn: the naive rule takes 3 legs, no auto-collapse 4, the clip 1, the label cap
2, and restoring the retired sentinel prose 1.

**The residual this section used to record is CLOSED by task 561.** It read:
*the floor CLIPS; it does not offer an overflow affordance … both want a product
decision (a scroll, an overflow chevron) rather than a wider guard.* Gabriel's
decision (2026-08-31, from a crowded bar on GGlaptop): scroll — see "The
overflow half" immediately below.

**Owed, not claimed:** the preview eyeball at the screenshot's width plus one
narrower. NOT FSA-masked; this run was unattended and could not start a dev
server.

### The overflow half: a tier that cannot fit DEGRADES in a stated order

Same strip, the product decision 395 left open (task 561). Gabriel, verbatim:
*"when there are many tabs open and they fill up the virgil bar … they should
compress to a reasonable minimum size as the number of tabs increases … i'd
like to be able to scroll left/right through them (like you can in google
chrome/safari) … the current page should always have its tab scrolled to a
visible position … implement the scroll function carefully — do some research
about how web browsers and other tab environments handle the fine details."*

**The two tab strips shared the GEOMETRY SSOT and not the occupancy
behaviour.** `folder-tab-geometry.ts` calls itself "the ONE SSOT … shared by
BOTH tab strips", and the silhouette is. The Library's INNER strip
(`PanelTabStrip`) had shipped exactly Gabriel's ladder as "F#15" — inactive
tabs `flex: 1 1 auto` down to a floor with their labels ellipsizing first, the
active tab `flex: 0 0 auto` resisting, and a scroll-active-into-view effect
past the floors — while the OUTER Virgil-bar strip had none of it: every tab
`shrink-0`, the row `width: max-content`, and a hard `overflow-x: clip` that
simply LOST the rightmost tabs. Three facts made it the "shared SSOT with one
consumer" shape rather than a missing feature: `ACTIVE_MIN_CONTENT` was
declared in the shared geometry module and read by the Library side only while
the outer tab hand-wrote `minWidth: 80`; `INACTIVE_MIN_CONTENT` was private to
the inner strip; and the inner strip was `overflow-x: hidden` — scrollable by
its own nudge and by nothing the user could do — so "scroll left/right" was
unmet on BOTH strips.

> **A crowded tab strip degrades in ONE stated order, read from ONE module by
> both strips ([src/components/chrome/tab-strip-occupancy.ts](../../../src/components/chrome/tab-strip-occupancy.ts)):
> COMPRESS — inactive tabs share the width (`flex-shrink`, weighted by natural
> width so long names give first) and their LABELS ellipsize down to
> `INACTIVE_MIN_LABEL_PX`; the active tab is `shrink-0` and RESISTS — then
> SCROLL — a native `overflow-x: auto` scroller with its scrollbar hidden, a
> vertical wheel mapped onto it, and the ACTIVE tab always nudged fully into
> view by the minimum `scrollLeft` delta: on activation, on open, on a
> neighbour's close, and when the strip itself narrows.**

Nine rules it earned:

- **Measurement and layout had to be SEPARATED, and the separation is a
  READ, not a twin.** The occupancy predicate is state-independent only
  because it is fed the tab row's NATURAL width, and the pre-561 row was
  `width: max-content` + `shrink-0` precisely so its box WAS that width —
  which is exactly what made it incompressible. Fed the compressed box the
  rule can never say "collapse": collapsing would free room, the tabs would
  decompress and "fit", the rule would expand the tools, and the bar would
  loop — the naive rule 395 was built to reject. `tabRowNaturalWidth` recovers
  the natural width from the compressed row — box + Σ(what each label lost:
  a label's `scrollWidth` still reports its un-ellipsized text width while its
  `clientWidth` reports what it was allowed to show, capped at
  `TAB_LABEL_MAX_PX` since a capped name was ellipsized before any squeeze) +
  the overflow past the scroller. Post-layout DOM reads on the SAME
  ResizeObserver fire, O(tabs), forcing no layout; every label span carries
  `TAB_LABEL_ATTR` so the reader finds them without knowing either strip's
  markup. Honest limit, stated at the function: in the compressed regimes the
  verdict is "does not fit" whatever the deficit's magnitude, so a stale
  deficit can never land on the wrong side.
- **The predicate's `tabStripPx` is the SCROLLER's box, not the strip's.** The
  pinned `+` moved OUT of the row (an action a crowded strip could scroll out
  of reach is a dead affordance), so the row's assigned width is the scroller's
  content box, and the `+` nets out of it exactly as the protected status
  width `R` does. The ladder in bar-occupancy.ts is unchanged in form;
  `useBarOccupancy` observes the same three roles.
- **The seam is the detail the scroller OWES.** Per CSS Overflow 3,
  `overflow-x: auto` coerces an unstated vertical axis to `auto`, and the
  active folder tab hangs `FOLDER_TAB_SEAM_OVERLAP` (1px) BELOW the strip so
  its open-bottom silhouette merges into the canvas — inside a scroll
  container that overhang is scrollable overflow, and the clip eats it. So
  the axis is stated `overflow-y: hidden` and the overhang is kept INSIDE the
  clip by a 1px bottom padding + −1px margin pair (`tabStripSeamPadding`), the
  mechanism the inner strip has carried since task 324. Both strips read ONE
  `TAB_STRIP_SCROLLER_STYLE`; neither may spell an overflow axis of its own.
  The scroller also carries the row's trailing slack as PADDING (a last active
  tab's border box protrudes 8px past its margin box plus the cap's 1px
  overhang), because as content that protrusion would be a 9px phantom scroll
  range on a strip with every tab in view.
- **The inactive floor is on the LABEL, and that closed a latent overflow.**
  The inner strip's floor was a tab-level `minWidth: 60`, which is
  chrome-blind: a tab with a pin, a menu and a close has 62px of fixed chrome,
  so at the floor its content overflowed its own box. A `min-width` on the
  label composes with whatever chrome the tab carries — the tab's automatic
  flex minimum is `chrome + INACTIVE_MIN_LABEL_PX` by construction — and the
  value (20) reproduces the plain closable inner tab's old floor byte for byte
  (60 − 40 of chrome). It is `calc-size(max-content, min(size, 20px))`, never
  a bare `20px`: a two-letter name is not padded out to the floor, so the
  roomy layout is byte-identical to the pre-561 one and the inline↔folder
  pixel-stability contract holds for short names too.
- **The ACTIVE floor is a per-VARIANT field of the geometry spec, not one
  number.** The two content rows genuinely differ (the library row holds pin +
  icon + menu + close beside its label; the topbar row a label + close), the
  active tab never compresses (its floor is a minimum SIZE for a short name,
  not a compression stop), and unifying the number would have moved every
  short-named outer tab for no reason. `FOLDER_TAB_VARIANTS[v].activeMinContent`
  (116 / 80) is read by both tabs; the hand-written `80` is gone.
- **The Library root is the strip's PINNED tab and never compresses**
  (Chrome's pinned tabs): its `library-pinned` padding pre-reserves the folder
  silhouette's footprint, and a floor below that chrome would squeeze the
  padding under its own label.
- **The nudge is the minimum delta, instant, in a LAYOUT effect.** Never
  `el.scrollIntoView()`, which centres/over-scrolls, scrolls every ANCESTOR
  too, and races a smooth scroll in flight ("Refocus is not navigation"); a
  passive effect would paint the tab off-screen for a frame and then jump. The
  resize path is the ONE ResizeObserver here — over the scroller's own box,
  RAF-coalesced behind a width-equality bail, PARKED on the layout-gesture
  bus so an OS window drag costs one settle on the end edge — and it writes
  only `scrollLeft`, which does not resize the box it observes, so it cannot
  feed back into itself.
- **The wheel mapping is narrow, and every exclusion is the browser's own
  behaviour.** A vertical wheel over the strip scrolls it sideways (Firefox's
  tab strip and VS Code's editor tabs; a mouse user has no other way to reach
  an off-screen tab). A genuine horizontal `deltaX` — a trackpad swipe, or
  Shift+wheel, which Chromium already re-axes into `deltaX` — is left to the
  browser's own `overflow-x: auto` handling; a `ctrlKey` wheel is a pinch-zoom
  and is never hijacked; and a wheel that cannot move the strip (already at
  the end, or no overflow) is NOT consumed, so it bubbles exactly as before the
  listener existed. It is a NON-passive native listener because React's
  `onWheel` is registered passive and cannot `preventDefault`.
- **The drop indicator lives in the NON-scrolling root, clamped.** An
  absolutely-positioned child of a scroll container scrolls with the content,
  while the indicator is placed from live VIEWPORT rects — so the outer
  indicator stays a child of the `position: relative` root (correct at any
  scrollLeft with no correction) and is clamped to the scroller's visible span,
  which closes the second half of 395's residual: a drop past the scrolled-out
  boundary paints a bar at the edge the hidden tabs are beyond. The INNER
  strip's indicator IS such a child, and it adds the strip's `scrollLeft` back
  — a latent defect (only the nudge could scroll that strip, and only while
  the active tab was squeezed off) that user scrolling would have made live.
  A paper/library drag toward either edge auto-scrolls the strip
  (`autoScrollForDrag`, called AFTER the drop-index rect reads so the write
  never sits between two of the gesture's own reads).

**Research findings, recorded as directions taken and declined.** Bare scroll
with a hidden scrollbar and no arrow buttons (Safari and Gabriel's reference;
Firefox's edge arrows declined). Vertical-wheel mapping (Firefox, VS Code).
Keyboard reachability needs nothing: a focused tab is scrolled into view by the
browser's own focus handling. Instant nudge over `scroll-behavior: smooth`
(a second programmatic scroll racing a smooth one is the double-scroll shape).
Two things Chrome does that this pass deliberately does NOT: CLOSE STABILITY —
Chrome freezes tab widths after a close while the pointer stays inside the
strip, so the next close lands under the same cursor; with CSS-flex
compression the widths redistribute on the close, so closing several tabs in a
row can be a chase — and an EDGE FADE/CHEVRON when content is off-screen.
Both are product decisions with their own design pass (the fade needs a scroll
listener, which the scroll census governs) and are recorded here rather than
half-built.

CI: [bar-occupancy.test.tsx](../../../src/components/editor-layout/__tests__/bar-occupancy.test.tsx)
gains a section driving the REAL `TopBar` over a crowded strip — the ladder's
DOM (compressible inactive wrappers, the resisting active tab, the pinned
root, the scroller with the seam pair, the pinned `+`), an activation nudge
through the real strip with the scroller and the tab's rects stubbed, and the
anti-oscillation leg, which stubs the labels' `scrollWidth`/`clientWidth` so the
row's box reads 300 while its natural width is 360 (a rule reading the box
keeps the tools open; the real one collapses them and STAYS collapsed once the
freed width reaches the strip). Its census: both strips spread the ONE scroller
style and spell no overflow axis; both mount `useTabStripScroller` and NO file
in either silo writes `scrollLeft` outside the module; no tab file hand-writes
a positive `minWidth` (asked per TAG — the inner strip's body-portaled menus
carry one, and a menu's floor is not a tab's) or the label floor; every label
span carries the attribute. [tab-strip-occupancy.test.tsx](../../../src/components/chrome/__tests__/tab-strip-occupancy.test.tsx)
drives the primitives over stubbed geometry and the hook end to end (a real
`WheelEvent` on the scroller, `defaultPrevented` read back; the resize park
through the REAL bus). [tab-strip-scroll.test.tsx](../../../library/components/panel-tabs/__tests__/tab-strip-scroll.test.tsx)
drives the REAL `PanelTabStrip`: a scroller now, the label floor on every
inactive label, no chrome-blind tab floor, and the indicator's scrollLeft
correction through a real `dragover`. **No pre-561 suite could see any of
this**: every strip fixture in the repo has tabs that FIT, where the
compressed and the natural width are the same number by construction. Three
pre-561 legs are RENEGOTIATED in place with the reason at the site — the
`overflow-x: clip` census (it pinned the ABSENCE of the decision as the
contract), the seam-anchor needle (it pinned `shrink-0` on every inline
wrapper, which was the non-compression, not the anchor), and the
`ACTIVE_MIN_CONTENT` pin (a variant field now). Measured by neutering each half
in turn: inline wrappers back to `shrink-0` takes 2 legs, the label floor 2,
the compressed-box feed 1, the activation/close nudge 3, the wheel listener 1,
the resize park 1, the inner indicator's scrollLeft 1, the outer scroller's
seam pair 2, and a private nudge re-forked into the inner strip
1 (the census).

**Owed, not claimed:** the preview eyeball, and it is REQUIRED here rather
than nice to have — three of the constraints are pixel/gesture facts jsdom
cannot see: the seam overhang under `overflow-y: hidden`, the wheel mapping's
feel, and the drop indicator at a non-zero `scrollLeft`. NOT FSA-masked (pure
layout chrome over `localStorage` tab state). Open ~10 tabs at a normal window
width and narrow it: tabs compress → the strip scrolls → the active tab stays
visible → its bottom seam still merges into the canvas → a paper dragged onto
the far-right end shows the indicator and lands there.
