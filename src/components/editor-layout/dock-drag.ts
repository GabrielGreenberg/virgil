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
    // Split mode: prefer the live `[data-panel-half]` anchors' rects so
    // the outline + hit-test follow the user's current ratio (and any
    // min-height clamping), rather than a hardcoded 50/50 phantom.
    // Falls through to the 50/50 fallback only if anchors are missing.
    if (split) {
      const halves = readSplitHalfRects(col);
      if (halves) {
        // Boundary = midpoint between the two half rects (the divider line).
        const halfBoundary = (halves.top.bottom + halves.bottom.top) / 2;
        const half: "top" | "bottom" = y < halfBoundary ? "top" : "bottom";
        let chosenLeft = (half === "top" ? halves.top : halves.bottom).left;
        let chosenTop = (half === "top" ? halves.top : halves.bottom).top;
        let chosenWidth = (half === "top" ? halves.top : halves.bottom).width;
        let chosenHeight = (half === "top" ? halves.top : halves.bottom).height;
        let otherLeft = (half === "top" ? halves.bottom : halves.top).left;
        let otherTop = (half === "top" ? halves.bottom : halves.top).top;
        let otherWidth = (half === "top" ? halves.bottom : halves.top).width;
        let otherHeight = (half === "top" ? halves.bottom : halves.top).height;

        // Predict post-drop extension: dropping a panel into an empty top
        // half flips `extendsOverToolbar` to true (panel-column.tsx),
        // shifting the stack up so its top moves from y=64 to y=podGap
        // and its height grows by (64 - podGap). Without this prediction,
        // the glow renders at the LOW pre-drop position and the panel
        // visually jumps up on drop.
        const topAnchor = col.querySelector<HTMLElement>(
          '[data-panel-half="top"]',
        );
        const topEmpty =
          !!topAnchor && !topAnchor.hasAttribute("data-dock-slot");
        // The action toolbar wrapper is only rendered when the column is
        // NOT extended over the toolbar (see panel-column.tsx).
        const currentlyExtended = !col.querySelector("[data-tool-strip]");
        if (half === "top" && topEmpty && !currentlyExtended && topAnchor) {
          const stack = topAnchor.parentElement;
          if (stack) {
            const stackH = stack.getBoundingClientRect().height;
            if (stackH > 0) {
              // Ratio derives consistently in either extension mode.
              const ratio = Math.max(
                0.05,
                Math.min(0.95, (halves.top.height + podGap / 2) / stackH),
              );
              const extTop = fullTop; // TOP_BAR + podGap
              const extH = fullHeight; // 100dvh - TOP_BAR - 2*podGap
              const predTopH = ratio * extH - podGap / 2;
              const predBotTop = extTop + ratio * extH + podGap / 2;
              const predBotH = (1 - ratio) * extH - podGap / 2;
              chosenLeft = halves.top.left;
              chosenTop = extTop;
              chosenWidth = halves.top.width;
              chosenHeight = predTopH;
              otherLeft = halves.bottom.left;
              otherTop = predBotTop;
              otherWidth = halves.bottom.width;
              otherHeight = predBotH;
            }
          }
        }

        return {
          slotKey: `${side}-${half}` as DockSlotKey,
          rect: { left: chosenLeft, top: chosenTop, width: chosenWidth, height: chosenHeight },
          companionRect: { left: otherLeft, top: otherTop, width: otherWidth, height: otherHeight },
        };
      }
    }
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
    // Split fallback: divide the full pod region evenly. Only reached
    // when the live anchors aren't measurable (defensive).
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

/** Read the live `[data-panel-half]` anchors on `col` and return their
 *  current viewport rects. The anchors are sized by the user's split
 *  ratio (CSS calc on `${ratio * 100}%`) so this is the source of truth
 *  for where the halves actually sit on screen. Returns null when split
 *  mode isn't engaged or either anchor is missing / collapsed. */
function readSplitHalfRects(
  col: HTMLElement,
): { top: DOMRect; bottom: DOMRect } | null {
  const top = col.querySelector<HTMLElement>('[data-panel-half="top"]');
  const bottom = col.querySelector<HTMLElement>('[data-panel-half="bottom"]');
  if (!top || !bottom) return null;
  const topR = top.getBoundingClientRect();
  const botR = bottom.getBoundingClientRect();
  if (topR.height <= 0 || botR.height <= 0) return null;
  return { top: topR, bottom: botR };
}

/**
 * Auto-dock proximity test: find the dock target whose far-top corner
 * is closest to the floating panel's matching top corner — within
 * `AUTO_DOCK_PROXIMITY` pixels (Euclidean).
 *
 * Why corner-to-corner? Edge-to-edge snapping made the entire column
 * width a hot zone, so a panel hovering over the middle of a dock
 * auto-redocked on release. With a corner gate, redocking is
 * intentional: the user has to nudge the panel into one of the dock's
 * outer-top corners. Hovering over the dock center stays floating.
 *
 * In split mode there are TWO snap corners per column:
 *  - the top half's top-outer corner (= the dock pod's top corner)
 *  - the bottom half's top-outer corner (= the divider's outer corner)
 * Both are eligible; whichever the panel's top corner is closer to wins.
 *
 * "Far corner" = the dock pod's OUTER side: LEFT for the left-side dock,
 * RIGHT for the right-side dock. The panel's matching corner is its
 * top-LEFT (left dock) or top-RIGHT (right dock).
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
  const podGap =
    parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue("--pod-gap"),
    ) || 10;
  const TOP_BAR = 32;
  let bestSide: "left" | "right" | null = null;
  let bestDist = Infinity;
  let bestColRect: DOMRect | null = null;
  for (const col of Array.from(cols)) {
    const r = col.getBoundingClientRect();
    const side = (col.dataset.panelColumnSide ?? "left") as "left" | "right";
    const split = side === "left" ? splitState.left : splitState.right;
    // Snap corners for this column. Always include the top corner at the
    // dock pod's predicted top (TOP_BAR + podGap, post-extend position —
    // consistent regardless of whether the column currently extends over
    // the toolbar). In split mode, add the bottom half's top corner so
    // dragging toward the lower half is also eligible.
    const cornerX = side === "left" ? r.left : r.right;
    const snapCorners: { x: number; y: number }[] = [
      { x: cornerX, y: TOP_BAR + podGap },
    ];
    if (split) {
      const bottomAnchor = col.querySelector<HTMLElement>(
        '[data-panel-half="bottom"]',
      );
      if (bottomAnchor) {
        const botR = bottomAnchor.getBoundingClientRect();
        if (botR.height > 0) {
          snapCorners.push({ x: cornerX, y: botR.top });
        }
      }
    }
    // Floating panel's matching top-outer corner.
    const panelCornerX =
      side === "left" ? panelRect.x : panelRect.x + panelRect.width;
    const panelCornerY = panelRect.y;
    for (const corner of snapCorners) {
      const dx = corner.x - panelCornerX;
      const dy = corner.y - panelCornerY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < threshold && dist < bestDist) {
        bestSide = side;
        bestDist = dist;
        bestColRect = r;
      }
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
