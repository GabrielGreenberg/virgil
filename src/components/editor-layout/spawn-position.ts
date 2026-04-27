// Quadrant-aware spawn position for popped-out floating panels and cards.
// Given the trigger element's bounding rect (the docked panel/card the user
// clicked on) and the float's full size, compute an inward-biased placement:
// the float clears the trigger vertically (above when the trigger is in the
// bottom half, below when in the top half) and drifts laterally toward the
// viewport center (rightward from a left-side trigger, leftward from a
// right-side trigger). When no anchor is supplied (e.g. keyboard shortcut),
// fall back to a centered placement.

import { FLOATING_PANEL_VIEWPORT_MARGIN } from "./constants";

export interface SpawnSize {
  width: number;
  height: number;
}

export interface SpawnRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SpawnOpts {
  /** Vertical clearance between trigger and float when stacking above/below. */
  gap?: number;
  /** Horizontal drift toward the viewport center, so lateral motion is visible. */
  drift?: number;
  /** Minimum distance from viewport edges. */
  margin?: number;
  /** Viewport size. Defaults to window dimensions. */
  viewport?: { width: number; height: number };
}

const DEFAULT_GAP = 8;
const DEFAULT_DRIFT = 24;

export function computeSpawnPosition(
  anchor: DOMRect | null,
  size: SpawnSize,
  opts: SpawnOpts = {},
): SpawnRect {
  const gap = opts.gap ?? DEFAULT_GAP;
  const drift = opts.drift ?? DEFAULT_DRIFT;
  const margin = opts.margin ?? FLOATING_PANEL_VIEWPORT_MARGIN;
  const vw = opts.viewport?.width
    ?? (typeof window !== "undefined" ? window.innerWidth : 1200);
  const vh = opts.viewport?.height
    ?? (typeof window !== "undefined" ? window.innerHeight : 800);

  let x: number;
  let y: number;
  if (anchor) {
    const cx = anchor.left + anchor.width / 2;
    const cy = anchor.top + anchor.height / 2;
    // Vertical: clear the anchor entirely, biased toward the closer half's
    // opposite (bottom-half trigger → float above; top-half → float below).
    y = cy > vh / 2
      ? anchor.top - size.height - gap
      : anchor.bottom + gap;
    // Horizontal: align to the anchor's near edge, then drift inward.
    x = cx > vw / 2
      ? anchor.right - size.width - drift
      : anchor.left + drift;
  } else {
    x = (vw - size.width) / 2;
    y = (vh - size.height) / 2;
  }

  // Clamp to viewport with margin.
  const maxX = Math.max(margin, vw - size.width - margin);
  const maxY = Math.max(margin, vh - size.height - margin);
  x = Math.max(margin, Math.min(x, maxX));
  y = Math.max(margin, Math.min(y, maxY));

  return { x, y, width: size.width, height: size.height };
}
