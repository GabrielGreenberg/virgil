// Quadrant-aware spawn position for popped-out floating panels and cards.
// Given the trigger element's bounding rect (the docked panel/card the user
// clicked on) and the float's full size, compute an inward-biased placement:
// the float clears the trigger vertically (above when the trigger is in the
// bottom half, below when in the top half) and drifts laterally toward the
// viewport center (rightward from a left-side trigger, leftward from a
// right-side trigger). When no anchor is supplied (e.g. keyboard shortcut),
// fall back to a centered placement.

import { FLOATING_PANEL_VIEWPORT_MARGIN } from "./constants";
import type { Side } from "@/hooks/useViewPrefs";
import { paneColumn } from "./pane-dom";

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

/**
 * Spawn rect for "open panel as float at the column rect": the float
 * appears exactly where the docked column would have rendered. Measures
 * the live column wrapper (it's still mounted as the omni backdrop). If
 * the wrapper isn't in the DOM yet, falls back to a strip-adjacent rect.
 *
 * Resolved through `paneColumn` (task 438). This one already failed SAFE — a
 * hidden pane's zero rect misses the `width > 0 && height > 0` guard and drops
 * to the hard-coded fallback — but it is the same sweep as its three siblings
 * and moves with them, or it becomes the next reader's "the pattern is fine
 * here".
 */
const FALLBACK_COLUMN_WIDTH = 320;
const FALLBACK_TOP_OFFSET = 56;
const FALLBACK_STRIP_OFFSET = 48;
const MIN_COLUMN_FLOAT_WIDTH = 280;

export function computeColumnSpawnRect(side: Side): SpawnRect {
  if (typeof document !== "undefined") {
    const col = paneColumn(side);
    if (col) {
      const r = col.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        // The column may have been shrunk below a usable panel width
        // (e.g. legacy dock prefs). Bump to a minimum, growing inward
        // toward the editor so the float doesn't push past the strip.
        if (r.width >= MIN_COLUMN_FLOAT_WIDTH) {
          return { x: r.left, y: r.top, width: r.width, height: r.height };
        }
        const width = MIN_COLUMN_FLOAT_WIDTH;
        const x = side === "left" ? r.left : r.right - width;
        return { x, y: r.top, width, height: r.height };
      }
    }
  }
  const vw = typeof window !== "undefined" ? window.innerWidth : 1200;
  const vh = typeof window !== "undefined" ? window.innerHeight : 800;
  const width = FALLBACK_COLUMN_WIDTH;
  const top = FALLBACK_TOP_OFFSET;
  const height = Math.max(200, vh - top - 8);
  const x =
    side === "left"
      ? FALLBACK_STRIP_OFFSET
      : vw - width - FALLBACK_STRIP_OFFSET;
  return { x, y: top, width, height };
}
