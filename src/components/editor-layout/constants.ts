// Layout constants shared across EditorLayout and its extracted submodules.
// These used to live inline; pulled out so agent edits don't have to hunt
// through a 5K-line file to find or adjust them.

/** Default width of a newly popped-out floating panel, in pixels. */
export const FLOATING_PANEL_WIDTH = 360;

/** Default height of a newly popped-out floating panel, in pixels. */
export const FLOATING_PANEL_HEIGHT = 520;

/** Minimum distance between a floating panel and the viewport edge. */
export const FLOATING_PANEL_VIEWPORT_MARGIN = 40;

/** Per-panel diagonal offset so stacked floats don't overlap exactly. */
export const FLOATING_PANEL_STACK_OFFSET = 24;

/** Base z-index for floating panels; each subsequent panel adds 1. */
export const FLOATING_PANEL_Z_BASE = 1000;

// ───────────────────────────────────────────────────────────────────────────
// Right-margin geometry SSOT (backlog #8)
// ───────────────────────────────────────────────────────────────────────────
//
// Three chrome elements share the editor's right margin — the marginalia
// marker grid, the selection bolt (⚡), and the overlay scrollbar — and each
// USED to be positioned by a private magic number in its own coordinate
// system, so they overlapped (markers under the scrollbar; bolt on top of the
// left marker column). These constants are the ONE shared lane model that all
// three derive from, so nothing collides at any margin width.
//
// The right margin is ONE ordered band list (`RIGHT_LANE_BANDS` in
// marginalia.ts) so all four elements are DISJOINT by construction. The
// selection bolt is now INBOARD of the marker grid (between the text and the
// markers), so the markers sit to its RIGHT (task 2026-07-03-030). Measured
// inward (leftward) from the pod's right edge:
//
//   pod right edge
//        │
//        ▼
//   ┌──────────┐   SCROLLBAR_GUTTER (the scrollbar thumb's footprint)
//   ├──┐           MARKER_SCROLLBAR_GAP (grid clears the scrollbar)
//   │grid│←──────── marker grid (columns NEAREST the scrollbar now)
//   └────┘
//   ├────┐         MARGINALIA_BOLT_MARKER_GAP (bolt clears the marker grid)
//   │⚡│←────────── selection bolt — its OWN band, INBOARD of the grid
//   └──┘
//   [INNER_PAD]    gap between the bolt band's inner edge and the text edge
//        │
//   text right edge
//
// Consumed by: editor-scrollbar.tsx (thumb width/inset), marginalia.ts
// (RIGHT_LANE_BANDS → the right margin width + the min-margin floor + the grid
// col x + the bolt x), and SelectionActionsMenu.tsx (the pod-anchored bolt x
// via `computeBoltLeftFromPod`, seated in the inboard band).

/** Width of the overlay scrollbar thumb, in px. */
export const SCROLLBAR_THUMB_WIDTH = 6;
/** Pixels left of the editor column's right edge where the thumb sits. */
export const SCROLLBAR_RIGHT_INSET = 3;
/**
 * Total horizontal footprint reserved for the overlay scrollbar at the pod's
 * right edge (= thumb width + its right inset). This is the SSOT every
 * right-margin element clears: the scrollbar occupies `[podRight − GUTTER,
 * podRight]`. Was the silent `9` baked into `editorCol.right − 9`.
 */
export const SCROLLBAR_GUTTER = SCROLLBAR_THUMB_WIDTH + SCROLLBAR_RIGHT_INSET; // 9

/**
 * Breathing room between the marginalia marker grid's outer (right) edge and
 * the scrollbar gutter, so the rightmost marker column sits clearly LEFT of
 * the scrollbar instead of under it. Ratified at ~3px.
 */
export const MARKER_SCROLLBAR_GAP = 3;
