/**
 * Shared drag/press blocklist selectors — the SSOT for "which descendants of a
 * draggable surface must NOT start a drag/lift/pin gesture when pressed."
 *
 * Three sites used to carry a hand-copied, character-identical copy of the
 * interactive-controls list (FloatingPanel window-drag, PanelCard card-lift,
 * OmniViewPanel pin-on-mousedown). They drifted apart silently. This module
 * holds the ONE list so a new interactive control (or a fix) lands everywhere.
 *
 * Runtime LEAF — imports nothing — so any UI module can consume it without a
 * cycle.
 */

/**
 * Interactive controls a press must pass THROUGH untouched: native form
 * controls, links, rich-text surfaces, explicitly-draggable elements, and the
 * opt-out hatch `[data-no-window-drag]`. A press whose target `closest()`-es one
 * of these should NOT begin the surrounding drag/lift/pin gesture.
 *
 * This is the shared BASE list. The window-drag site additionally appends
 * `[data-card]` (see {@link WINDOW_DRAG_BLOCK_SELECTOR}) so a press on a CARD
 * surface inside a float lifts the card instead of dragging the whole window
 * (bug #36) — that exclusion is NOT shared, because the card-lift and omni-pin
 * sites legitimately fire on card surfaces.
 */
export const INTERACTIVE_CONTROL_SELECTOR =
  "button, input, textarea, select, a, [contenteditable='true'], [draggable='true'], [data-no-window-drag]";

/**
 * The blocklist for the FloatingPanel WINDOW-drag gesture (`onHeaderMouseDown`,
 * which wraps the whole float body). Extends {@link INTERACTIVE_CONTROL_SELECTOR}
 * with `[data-card]`: a press anywhere on a card surface inside a float must
 * lift that CARD (PanelCard's own 5px-threshold lift), not drag the window
 * (bug #36 — the window-drag armed with zero threshold and won the race). The
 * window stays draggable from inter-card gaps / background, which are outside
 * any `[data-card]`.
 */
export const WINDOW_DRAG_BLOCK_SELECTOR = `${INTERACTIVE_CONTROL_SELECTOR}, [data-card]`;
