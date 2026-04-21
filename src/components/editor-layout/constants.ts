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
