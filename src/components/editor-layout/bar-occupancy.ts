// ───────────────────────────────────────────────────────────────────────────
// The Virgil bar's occupancy rule — ONE width negotiation for the whole bar
// ───────────────────────────────────────────────────────────────────────────
//
// > **The Virgil bar's occupants are ranked, and under compression the LOWEST
// > rank yields first.** The ladder is stated ONCE, here:
// >
// >   1. PROTECTED STATUS — the data-integrity badges (save state, preservation
// >      refusal, external change, sync conflict, mirror recovery), the running
// >      timer, and the collapse toggle itself. Never yields. This is not a
// >      preference: AGENTS.md ("The honesty half") makes a data-integrity
// >      notice un-hideable by a layout preference, and the toggle is what makes
// >      a collapse reversible.
// >   2. TABS — Gabriel's decision (2026-08-19): "text tabs should occlude the
// >      tools in this case." Tabs outrank the collapsible tools.
// >   3. COLLAPSIBLE TOOLS — the `topbarRightCollapsed` group. Collapses
// >      automatically when tiers 1+2 need the room, behind the same chip the
// >      user already collapses it with, so the tools stay REACHABLE. Collapse
// >      beats bare z-order for exactly that reason: a tool hidden under a tab
// >      is unclickable with no affordance to reach it.
// >
// > When tier 2 STILL does not fit after tier 3 has yielded, it degrades in
// > a stated order rather than clipping (task 561, Gabriel's decision on the
// > fork 395 left open): COMPRESS — inactive tabs share the width and
// > ellipsize to a floor, the active tab resists — then SCROLL, with the
// > active tab always nudged into view. That ladder is shared with the
// > Library's inner strip (src/components/chrome/tab-strip-occupancy.ts).
// > Under it sits a structural FLOOR: the tab row lives in a scroll container,
// > which clips, so even at the bottom of the ladder tabs can never paint over
// > tier 1. The invariant the TopBar/TabStrip comments used to PROMISE is a
// > mechanism now.
//
// WHY THIS EXISTS (task 2026-08-19-395). The bar had three independent
// positioners and no priority rule. `TabStrip` is `flex-1 min-w-0` but its
// tabs are `shrink-0` and it had no overflow clip, so at a narrow window the
// tab row simply spilled RIGHT into the `shrink-0` status cluster and the two
// interleaved by paint order (the active folder tab carries `zIndex: 10`;
// several status buttons are `relative` and later in DOM order) — Gabriel's
// screenshot: tool icons crossing the "Coherence Intro: main.tex" label.
// Meanwhile TopBar's own comment claimed "the toolbar never overlaps tabs even
// when they crowd the middle", clamped against a "topbar-left sentinel" that
// was a COMMENT with no element and no consumer: the floating-MenuBar pod that
// once read it was retired (`93b286c0` moved the MenuBar into the pod chrome
// header; `bab3a399` deleted the dead `menuLocation` pref), and the prose
// outlived the mechanism by two months. A comment describing a dead mechanism
// is how the next reader concludes the bar is safe.
//
// ── The predicate, and why it needs no hysteresis and no cache ─────────────
//
// Let W be the bar's inner width, R the protected status width (plus the
// pinned "+" and the strip's own padding, which are constants exactly like
// R), T the tab row's NATURAL (max-content) width and K the tools group's
// natural width. The honest question is state-INDEPENDENT:
//
//     everything fits  ⟺  T + K + R ≤ W
//
// but W and R are awkward to measure (the bar carries WCO window-inset padding
// and the protected set changes as badges self-gate). The tab strip's OWN
// assigned box — its SCROLLER, the flex-1 occupant beside the `shrink-0`
// status cluster — already carries both:
//
//     tabStripPx = W − R − (toolsCollapsed ? 0 : K)
//
// `T` must be the tab row's NATURAL width, never its laid-out one: since task
// 561 the row COMPRESSES to the scroller's width before it scrolls, so its box
// is bounded by `tabStripPx` by construction and the predicate below could
// never say "collapse" if it read the box. `tabRowNaturalWidth`
// (tab-strip-occupancy.ts) recovers the natural width — box + the width the
// labels lost to ellipsizing + the overflow past the scroller — which is what
// keeps "the tools yield BEFORE the tabs compress" true and the rule below
// state-independent.
//
// Substituting gives the same predicate in either state:
//
//     expanded   fits ⟺ T ≤ tabStripPx            ⟺ T + K + R ≤ W
//     collapsed  fits ⟺ T + K ≤ tabStripPx        ⟺ T + K + R ≤ W
//
// So `resolveBarOccupancy` is a pure function of three LIVE measurements plus
// the current state, and it cannot oscillate: collapsing changes `tabStripPx`
// by exactly K, which the `toolsCollapsed ? K : 0` term cancels. Nothing is
// cached, nothing is latched, and no measurement has to be taken in a state
// the app is not currently in — which is what a naive "does the tab row
// overflow?" rule would have needed, and why that rule flip-flops in the band
// where collapsing frees just enough room to un-collapse.
//
// The only tolerance is `BAR_FIT_EPSILON_PX`, applied in the direction that
// PREFERS THE CURRENT STATE, so a sub-pixel wobble in a fractional
// `contentRect.width` can't flip the boolean back and forth at the boundary.

/** Sub-pixel tolerance, applied to prefer the state the bar is already in. */
export const BAR_FIT_EPSILON_PX = 1;

/**
 * The live measurements the rule consumes. Every field is a CSS-pixel inline
 * size read from a `ResizeObserver` entry's `contentRect` (post-layout,
 * forces no layout of its own).
 */
export type BarOccupancyMeasure = {
  /**
   * The tab strip's SCROLLER content width — the tab row's assigned box, the
   * flex-1 occupant beside the pinned "+" and the `shrink-0` status cluster,
   * so it already nets out the protected width and (while expanded) the tools
   * group. `null` when there is no tab strip at all (zen mode renders a drag
   * spacer instead), which makes the rule inert.
   */
  tabStripPx: number | null;
  /** The tab row's NATURAL (max-content) width — recovered from the row by
   *  `tabRowNaturalWidth` even while it is compressed. `null` before first
   *  measure. */
  tabsNaturalPx: number | null;
  /** The tools group's natural (max-content) width. `null` before first measure. */
  toolsNaturalPx: number | null;
  /** Whether the tools group is currently collapsed — what `tabStripPx` reflects. */
  toolsCollapsed: boolean;
};

/**
 * Resolve the bar's occupancy: does the collapsible tools group have to yield?
 *
 * Fails OPEN (no auto-collapse) on any missing measurement — a bar that has
 * not been measured yet, or has no tab strip (zen), keeps every occupant
 * visible. An unnecessary expansion is the pre-395 status quo; a wrong
 * collapse hides tools nobody asked to hide.
 */
export function resolveBarOccupancy(m: BarOccupancyMeasure): {
  /** True when the collapsible tools group must yield its width to the tabs. */
  toolsCollapsed: boolean;
} {
  const { tabStripPx, tabsNaturalPx, toolsNaturalPx, toolsCollapsed } = m;
  if (tabStripPx === null || tabsNaturalPx === null || toolsNaturalPx === null) {
    return { toolsCollapsed: false };
  }
  // The tools group costs nothing to keep open when it is empty (every tool
  // self-gated off) — never collapse into a chip that reveals nothing.
  if (toolsNaturalPx <= 0) return { toolsCollapsed: false };

  const need = tabsNaturalPx + (toolsCollapsed ? toolsNaturalPx : 0);
  // Epsilon toward the current state: while collapsed, demand a clear win
  // before expanding; while expanded, tolerate a hair of crowding first.
  const fits =
    need + (toolsCollapsed ? BAR_FIT_EPSILON_PX : -BAR_FIT_EPSILON_PX) <=
    tabStripPx;
  return { toolsCollapsed: !fits };
}
