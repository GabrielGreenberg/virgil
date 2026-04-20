/**
 * Coupled highlight state for Links.
 *
 * Owns the "which link is active / hovered?" store that drives both
 * the margin icon and — for Mode B anchor links — the text-range
 * highlight. Hovering either end sets the state; both ends re-render
 * in the target card's theme color.
 *
 * Phase 2 wires this up. Phase 0 is a stub that defines the state
 * shape + the `alwaysShowLinkedText` preference default.
 */

export interface LinkHighlightState {
  /** Currently selected link id, or null. */
  activeLinkId: string | null;
  /** Hovered link id (overrides active for visuals), or null. */
  hoveredLinkId: string | null;
  /** When true, Mode B text ranges show a subtle persistent background
   *  even when no link is active/hovered. Intensifies on hover/select. */
  alwaysShowLinkedText: boolean;
}

export const DEFAULT_LINK_HIGHLIGHT_STATE: LinkHighlightState = {
  activeLinkId: null,
  hoveredLinkId: null,
  alwaysShowLinkedText: false,
};

/** Per-link visual state returned by `useLinkHighlight(link)` (Phase 2). */
export type LinkVisualState = "idle" | "hover" | "active";
