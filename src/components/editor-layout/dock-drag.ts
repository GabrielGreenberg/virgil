"use client";

import { useEffect, useState } from "react";
import type { DockSlotKey } from "@/hooks/useViewPrefs";

/**
 * Shared signal: which dock slot is currently the active drag target,
 * and the viewport-pixel rect at which the dock outline should render.
 *
 * Used in two flows:
 *  - Undock: on mousedown of a docked panel header, the slot's docked
 *    rect is captured and stored here. The outline persists at that
 *    rect for the entire drag, so it doesn't shift around even after
 *    the panel undocks and the slot DOM changes shape.
 *  - Redock: while a floating panel is being dragged, on each mousemove
 *    we hit-test the cursor against gutter columns and write the would-
 *    be drop slot here. On release, the parent reads this and either
 *    redocks or lets the float settle wherever it landed.
 *
 * Module-level (not React Context) because the producer (the panel
 * shell) and the consumer (a body-portaled outline component, plus
 * EditorLayout for the redock-on-mouseup decision) sit in different
 * parts of the React tree.
 */

export interface DockDragTarget {
  slotKey: DockSlotKey;
  rect: { left: number; top: number; width: number; height: number };
  /** When the target is one half of a split column, the OTHER half's
   *  rect — drawn as a fainter secondary outline so the user sees both
   *  stacked pods during a drag. Absent for non-split (`-full`) targets. */
  companionRect?: { left: number; top: number; width: number; height: number };
}

let active: DockDragTarget | null = null;
const listeners = new Set<() => void>();

export function setDockDragTarget(target: DockDragTarget | null) {
  // Cheap structural compare so identical re-sets during a hover-stable
  // mousemove stream don't churn React.
  const sameRect = (
    a?: { left: number; top: number; width: number; height: number },
    b?: { left: number; top: number; width: number; height: number },
  ) =>
    (!a && !b) ||
    (!!a && !!b && a.left === b.left && a.top === b.top && a.width === b.width && a.height === b.height);
  const same =
    active === target ||
    (!!active &&
      !!target &&
      active.slotKey === target.slotKey &&
      sameRect(active.rect, target.rect) &&
      sameRect(active.companionRect, target.companionRect));
  if (same) return;
  active = target;
  listeners.forEach((l) => l());
}

export function getDockDragTarget(): DockDragTarget | null {
  return active;
}

export function useDockDragTarget(): DockDragTarget | null {
  const [t, setT] = useState<DockDragTarget | null>(active);
  useEffect(() => {
    const sub = () => setT(getDockDragTarget());
    listeners.add(sub);
    return () => {
      listeners.delete(sub);
    };
  }, []);
  return t;
}

/**
 * Distance threshold in viewport pixels. A floating panel auto-docks
 * when its nearest corner is within this distance of a dock's
 * peripheral (outer) edge.
 */
export const AUTO_DOCK_PROXIMITY = 80;

/**
 * Hit-test the cursor against the visible gutter columns and return the
 * dock target the cursor is currently over (or null when off-gutter).
 *
 * Geometry priority for the outline rect:
 *   1. The actual `[data-dock-slot]` anchor's bounding rect when the
 *      slot is occupied — pixel-perfect match to the real dock pod.
 *   2. A "phantom" rect derived from the column rect, viewport, and
 *      pod-gap — used when the slot is empty (no anchor exists yet).
 *
 * Split-aware: when the side is split, the half is chosen by the
 * cursor's y-position relative to the column.
 */
export function findDockTargetAtPoint(
  x: number,
  y: number,
  splitState: { left: boolean; right: boolean },
): DockDragTarget | null {
  if (typeof document === "undefined") return null;
  const cols = document.querySelectorAll<HTMLElement>(
    "[data-panel-column-side]",
  );
  for (const col of Array.from(cols)) {
    const r = col.getBoundingClientRect();
    if (x < r.left || x > r.right || y < r.top || y > r.bottom) continue;
    const side = (col.dataset.panelColumnSide ?? "left") as "left" | "right";
    const split = side === "left" ? splitState.left : splitState.right;
    // Always derive the FULL dock-frame rect from column geometry —
    // not the live slot anchor's rect. The anchor may be smaller than
    // the dock area when the docked panel auto-fits to short content;
    // the "set-down" outline should still preview the full available
    // dock frame (where the panel will land), not the current
    // occupant's tighter footprint.
    const podGap =
      parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue("--pod-gap"),
      ) || 10;
    const TOP_BAR = 32;
    const podLeft = side === "left" ? r.left + 4 : r.left + 4 + podGap;
    const podRight = side === "left" ? r.right - 4 - podGap : r.right - 4;
    const fullTop = TOP_BAR + podGap;
    const fullHeight = window.innerHeight - TOP_BAR - 2 * podGap;
    // Half boundary is the midline of the *viewport-bound* dock region,
    // not the column's bounding rect. The column extends down with the
    // document and can be many viewports tall, so `(y - r.top) < r.height/2`
    // would always pick "top". Use absolute viewport y instead.
    const halfHeightForBoundary = Math.floor((fullHeight - podGap) / 2);
    const halfBoundary = fullTop + halfHeightForBoundary + podGap / 2;
    const half: "full" | "top" | "bottom" = !split
      ? "full"
      : y < halfBoundary
        ? "top"
        : "bottom";
    const slotKey = `${side}-${half}` as DockSlotKey;
    if (half === "full") {
      return {
        slotKey,
        rect: {
          left: podLeft,
          top: fullTop,
          width: podRight - podLeft,
          height: fullHeight,
        },
      };
    }
    // Split: divide the full pod region evenly. Use equal halves as a
    // reasonable default when no real anchor is available to read the
    // user's split ratio from.
    const halfHeight = Math.floor((fullHeight - podGap) / 2);
    const podWidth = podRight - podLeft;
    const topRect = { left: podLeft, top: fullTop, width: podWidth, height: halfHeight };
    const bottomRect = { left: podLeft, top: fullTop + halfHeight + podGap, width: podWidth, height: halfHeight };
    return {
      slotKey,
      rect: half === "top" ? topRect : bottomRect,
      companionRect: half === "top" ? bottomRect : topRect,
    };
  }
  return null;
}

/**
 * Auto-dock proximity test: find the dock target whose peripheral
 * (outer) edge is closest to the floating panel's nearest corner —
 * within `AUTO_DOCK_PROXIMITY` pixels.
 *
 * Why the panel rect (not the cursor)? When dragging a wide floating
 * panel, the cursor is anchored under the header, often well to the
 * inside of the panel's leading edge. Triggering on cursor would
 * require dragging far past where the panel visually meets the dock.
 * Triggering on the panel's nearest-corner-to-edge distance fires
 * when the panel itself is visually near the dock — matching what the
 * user sees.
 *
 * The "peripheral edge" is the dock's outer edge: the LEFT edge of a
 * left-side dock and the RIGHT edge of a right-side dock — the ones
 * facing away from the editor. The panel's nearest corner to a
 * vertical line is whichever side of the panel sits closer to it (its
 * left edge for the left dock, its right edge for the right dock).
 */
export function findDockTargetByPanelProximity(
  panelRect: { x: number; y: number; width: number; height: number },
  splitState: { left: boolean; right: boolean },
  threshold: number = AUTO_DOCK_PROXIMITY,
  /** Optional cursor coords. When provided, the cursor's y is used to
   *  pick the half in split mode — better aligned with user intent than
   *  the panel's vertical center, which for a tall floating panel can
   *  land in a different half than the cursor. */
  cursor?: { x: number; y: number },
): DockDragTarget | null {
  if (typeof document === "undefined") return null;
  const cols = document.querySelectorAll<HTMLElement>(
    "[data-panel-column-side]",
  );
  let bestSide: "left" | "right" | null = null;
  let bestDist = Infinity;
  let bestColRect: DOMRect | null = null;
  for (const col of Array.from(cols)) {
    const r = col.getBoundingClientRect();
    const side = (col.dataset.panelColumnSide ?? "left") as "left" | "right";
    // Signed distance from the panel's near-edge corner to the dock's
    // peripheral (outer) edge. We clamp to ≥0 so a panel whose edge is
    // already past the peripheral edge counts as fully snapped (dist=0)
    // — otherwise a wide panel hovering off-screen past the gutter
    // could measure as "far" by absolute distance.
    //
    // Right dock peripheral edge = column.right. Snap when panel.right
    // is at or past it (within `threshold` of the inside).
    // Left dock peripheral edge = column.left. Snap when panel.left is
    // at or past it.
    const dist =
      side === "left"
        ? Math.max(0, panelRect.x - r.left)
        : Math.max(0, r.right - (panelRect.x + panelRect.width));
    if (dist < threshold && dist < bestDist) {
      bestSide = side;
      bestDist = dist;
      bestColRect = r;
    }
  }
  if (!bestSide || !bestColRect) return null;
  // Reuse the cursor-based finder by probing at the column's x-center.
  // For y, prefer the cursor when supplied — it represents user intent
  // (which half the user is aiming at) better than panel-center, which
  // for a tall float can sit far from where the user is hovering.
  const probeX = (bestColRect.left + bestColRect.right) / 2;
  const probeY = cursor ? cursor.y : panelRect.y + panelRect.height / 2;
  return findDockTargetAtPoint(probeX, probeY, splitState);
}
