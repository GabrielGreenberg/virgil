"use client";

import { useEffect, useState } from "react";
import type { Side } from "@/hooks/useViewPrefs";

/**
 * Shared signal: which dock target a drag is currently over, and the
 * viewport-pixel rect at which the dock outline should render.
 *
 * In the band-stack model a dock target is a *band insertion point* on
 * one side: `{ side, index }` where `index` is the gap in that side's
 * stack the dragged panel would be inserted at (0 = above the top band,
 * `stack.length` = below the bottom band). The consumer (EditorPane)
 * calls `viewPrefs.redockPanel(id, target.side, target.index)`.
 *
 * Used in two flows:
 *  - Undock: on mousedown of a docked panel header, the band's docked
 *    rect is captured and stored here as a lift-off "ghost". The outline
 *    persists at that rect for the entire drag, so it doesn't shift
 *    around even after the panel undocks and the stack DOM reflows.
 *  - Redock: while a floating panel is being dragged, on each mousemove
 *    we hit-test the cursor against gutter columns and write the would-
 *    be insertion point here. On release, the parent reads this and
 *    either redocks or lets the float settle wherever it landed.
 *
 * Module-level (not React Context) because the producer (the panel
 * shell) and the consumer (a body-portaled outline component, plus
 * EditorPane for the redock-on-mouseup decision) sit in different parts
 * of the React tree.
 */

export interface DockDragTarget {
  /** Which side column the target is on. */
  side: Side;
  /** Band insertion index in that side's stack, clamped to
   *  `[0, stack.length]`. 0 = above the top band; `stack.length` =
   *  below the bottom band. */
  index: number;
  /** Viewport rect at which the set-down / lift-off outline renders. */
  rect: { left: number; top: number; width: number; height: number };
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
      active.side === target.side &&
      active.index === target.index &&
      sameRect(active.rect, target.rect));
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
 * when its nearest corner is within this distance of a dock column's
 * peripheral (outer) edge.
 */
export const AUTO_DOCK_PROXIMITY = 80;

/** Approx. height of the Virgil bar above the dock region. */
const TOP_BAR = 32;

/** Read the live band anchors (`[data-dock-slot]`) in a column's stack
 *  frame, top→bottom, with their current viewport rects. */
function readBandRects(col: HTMLElement): { el: HTMLElement; rect: DOMRect }[] {
  const frame = col.querySelector<HTMLElement>("[data-stack-frame]");
  const scope = frame ?? col;
  const bands = Array.from(
    scope.querySelectorAll<HTMLElement>("[data-dock-slot]"),
  );
  return bands.map((el) => ({ el, rect: el.getBoundingClientRect() }));
}

/** The viewport rect of a column's stack frame (the sticky dock region).
 *  Falls back to a phantom derived from the column rect + pod-gap when
 *  the frame element isn't present. */
function stackFrameRect(
  col: HTMLElement,
  colRect: DOMRect,
  podGap: number,
): { left: number; top: number; width: number; height: number } {
  const frame = col.querySelector<HTMLElement>("[data-stack-frame]");
  if (frame) {
    const r = frame.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) {
      return { left: r.left, top: r.top, width: r.width, height: r.height };
    }
  }
  const side = (col.dataset.panelColumnSide ?? "left") as Side;
  const podLeft = side === "left" ? colRect.left + 4 : colRect.left + 4 + podGap;
  const podRight = side === "left" ? colRect.right - 4 - podGap : colRect.right - 4;
  return {
    left: podLeft,
    top: TOP_BAR + podGap,
    width: podRight - podLeft,
    height: window.innerHeight - TOP_BAR - 2 * podGap,
  };
}

/**
 * Resolve the band insertion point + outline rect for a cursor `y`
 * within a column. `index` is the stack gap the cursor is over: it's the
 * count of bands whose vertical midpoint is above `y`, clamped to
 * `[0, bands.length]`. The outline rect previews where the band would
 * land — the existing band's footprint at the insertion boundary, or the
 * full stack frame when the stack is empty.
 */
function resolveBandTarget(
  col: HTMLElement,
  colRect: DOMRect,
  y: number,
  podGap: number,
): DockDragTarget {
  const side = (col.dataset.panelColumnSide ?? "left") as Side;
  const bands = readBandRects(col);
  const frame = stackFrameRect(col, colRect, podGap);

  if (bands.length === 0) {
    // Empty stack: insertion at index 0; preview the full dock frame.
    return { side, index: 0, rect: frame };
  }

  // Insertion index = number of bands whose midpoint sits above the
  // cursor. Clamped to [0, bands.length].
  let index = 0;
  for (const b of bands) {
    const mid = b.rect.top + b.rect.height / 2;
    if (y > mid) index += 1;
    else break;
  }
  if (index > bands.length) index = bands.length;

  // Outline rect: preview the slot the new band occupies. For an
  // insertion at the bottom (index === bands.length) hug the bottom
  // band's footprint; otherwise hug the band currently at `index` (the
  // one the new band would push down).
  const refBand = index < bands.length ? bands[index].rect : bands[bands.length - 1].rect;
  const rect = {
    left: refBand.left,
    top: refBand.top,
    width: refBand.width,
    height: refBand.height,
  };
  return { side, index, rect };
}

/**
 * Hit-test the cursor against the visible gutter columns and return the
 * band insertion target the cursor is currently over (or null when
 * off-gutter).
 */
export function findDockTargetAtPoint(x: number, y: number): DockDragTarget | null {
  if (typeof document === "undefined") return null;
  const cols = document.querySelectorAll<HTMLElement>("[data-panel-column-side]");
  const podGap =
    parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue("--pod-gap"),
    ) || 10;
  for (const col of Array.from(cols)) {
    const r = col.getBoundingClientRect();
    if (x < r.left || x > r.right || y < r.top || y > r.bottom) continue;
    return resolveBandTarget(col, r, y, podGap);
  }
  return null;
}

/**
 * Auto-dock proximity test: find the column whose outer-top corner is
 * closest to the floating panel's matching top corner — within
 * `threshold` pixels (Euclidean). Resolves the band insertion index from
 * the cursor's y (preferred) or the panel's vertical center.
 *
 * Why corner-to-corner? Edge-to-edge snapping made the entire column
 * width a hot zone, so a panel hovering over the middle of a dock
 * auto-redocked on release. With a corner gate, redocking is
 * intentional: the user has to nudge the panel into one of the dock's
 * outer-top corners. Hovering over the dock center stays floating.
 *
 * "Far corner" = the dock column's OUTER side: LEFT for the left-side
 * dock, RIGHT for the right-side dock. The panel's matching corner is
 * its top-LEFT (left dock) or top-RIGHT (right dock).
 */
export function findDockTargetByPanelProximity(
  panelRect: { x: number; y: number; width: number; height: number },
  threshold: number = AUTO_DOCK_PROXIMITY,
  /** Optional cursor coords. When provided, the cursor's y picks the
   *  band insertion index — better aligned with user intent than the
   *  panel's vertical center, which for a tall float can land in a
   *  different gap than the cursor. */
  cursor?: { x: number; y: number },
): DockDragTarget | null {
  if (typeof document === "undefined") return null;
  const cols = document.querySelectorAll<HTMLElement>("[data-panel-column-side]");
  const podGap =
    parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue("--pod-gap"),
    ) || 10;
  let bestCol: HTMLElement | null = null;
  let bestColRect: DOMRect | null = null;
  let bestDist = Infinity;
  for (const col of Array.from(cols)) {
    const r = col.getBoundingClientRect();
    const side = (col.dataset.panelColumnSide ?? "left") as Side;
    // Snap corner at the dock frame's predicted outer-top corner
    // (TOP_BAR + podGap — consistent regardless of toolbar extension).
    const cornerX = side === "left" ? r.left : r.right;
    const cornerY = TOP_BAR + podGap;
    const panelCornerX =
      side === "left" ? panelRect.x : panelRect.x + panelRect.width;
    const panelCornerY = panelRect.y;
    const dx = cornerX - panelCornerX;
    const dy = cornerY - panelCornerY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < threshold && dist < bestDist) {
      bestCol = col;
      bestColRect = r;
      bestDist = dist;
    }
  }
  if (!bestCol || !bestColRect) return null;
  // Resolve the band insertion index from the cursor y (user intent) or
  // the panel's vertical center as a fallback.
  const probeY = cursor ? cursor.y : panelRect.y + panelRect.height / 2;
  return resolveBandTarget(bestCol, bestColRect, probeY, podGap);
}
