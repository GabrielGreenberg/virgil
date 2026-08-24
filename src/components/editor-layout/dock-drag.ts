"use client";

import { useEffect, useState } from "react";
import type { Side } from "@/hooks/useViewPrefs";
import { paneColumns } from "./pane-dom";

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
 *  - Redock: while a floating panel is being dragged, each mousemove
 *    hit-tests the drag arithmetic against the dock geometry SNAPSHOT
 *    captured at gesture begin (`readDockGeometry`, below — never a live
 *    DOM sweep per move) and writes the would-be insertion point here.
 *    On release, the parent reads this and either redocks or lets the
 *    float settle wherever it landed.
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

/** `--pod-gap`'s fallback when the custom property is unset/unparseable. */
const DEFAULT_POD_GAP = 10;

/* ── Geometry SNAPSHOT vs hit-test ARITHMETIC (task 330) ──────────────────
 *
 * This module used to expose only LIVE hit-tests: one call =
 * `querySelectorAll` for the columns + `getComputedStyle(:root)` for
 * `--pod-gap` + a `getBoundingClientRect` per column, and — inside the 80px
 * proximity gate — a second `querySelectorAll` for the bands plus a rect read
 * PER BAND and per stack frame. `FloatingPanel`'s move handler called that on
 * every raw `mousemove` while ALSO committing React state, so a float drag was
 * write→read→write layout thrash at 120-240 Hz, with the read set GROWING near
 * a dock (Gabriel's "especially laggy near the docking sites").
 *
 * The shape of the fix — the same one the drop-mode controller's move path
 * already has — is to split the two halves that were fused:
 *
 *   `readDockGeometry()`  the ONE DOM sweep. Called on GESTURE EDGES only.
 *   `resolveDockTarget…`  pure arithmetic over that snapshot. Per move.
 *
 * Deliberately, no "live" convenience wrapper survives: a function that swept
 * the DOM and answered in one call is exactly what a per-move caller reaches
 * for. `findDockTargetAtPoint` (dead since the band-stack model — zero callers
 * in either silo) and `findDockTargetByPanelProximity` (whose only two callers
 * were the two FloatingPanel sites converted with this) are both DELETED, per
 * AGENTS.md "A registry earns its name by being read". A consumer must now
 * spell `readDockGeometry` to sweep — which its own move-path source contract
 * can forbid.
 */

/** A band footprint / frame rect in viewport px. */
export interface DockRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** One dock column's captured geometry. */
export interface DockColumnGeometry {
  side: Side;
  /** The column's own horizontal extent at capture time. The proximity test
   *  snaps to a column's OUTER edge and derives its corner y from
   *  `TOP_BAR + podGap`, so the vertical extent is not part of the answer —
   *  capturing `top`/`bottom` would be two fields nothing reads (their only
   *  reader was the point-in-column test deleted with `findDockTargetAtPoint`). */
  left: number;
  right: number;
  /** The sticky dock region (`[data-stack-frame]`), or the derived phantom. */
  frame: DockRect;
  /** Band footprints (`[data-dock-slot]`), top→bottom. */
  bands: DockRect[];
}

/**
 * Everything the dock hit-test needs, captured in ONE sweep. Snapshot it on a
 * gesture edge (`readDockGeometry`) and answer every subsequent move from it.
 */
export interface DockGeometry {
  podGap: number;
  columns: DockColumnGeometry[];
}

/** Read the band anchors (`[data-dock-slot]`) in a column's stack frame,
 *  top→bottom, with their viewport rects. */
function readBandRects(col: HTMLElement): DockRect[] {
  const frame = col.querySelector<HTMLElement>("[data-stack-frame]");
  const scope = frame ?? col;
  return Array.from(scope.querySelectorAll<HTMLElement>("[data-dock-slot]")).map(
    (el) => {
      const r = el.getBoundingClientRect();
      return { left: r.left, top: r.top, width: r.width, height: r.height };
    },
  );
}

/** The viewport rect of a column's stack frame (the sticky dock region).
 *  Falls back to a phantom derived from the column rect + pod-gap when
 *  the frame element isn't present. */
function readStackFrameRect(
  col: HTMLElement,
  colRect: { left: number; right: number },
  side: Side,
  podGap: number,
): DockRect {
  const frame = col.querySelector<HTMLElement>("[data-stack-frame]");
  if (frame) {
    const r = frame.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) {
      return { left: r.left, top: r.top, width: r.width, height: r.height };
    }
  }
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
 * THE dock DOM sweep — columns, `--pod-gap`, per-column stack frame and band
 * footprints. Call this on a gesture EDGE (drag begin, or a real invalidation
 * such as the LayoutGestureBus window-resize edge), never per move: it is
 * `querySelectorAll` + a forced-layout rect read per column and per band.
 *
 * Membership comes from `paneColumns()` (task 438), not a document-global
 * sweep: under multi-pane keep-alive up to four `EditorPane`s are mounted and a
 * HIDDEN one's column reports `left = right = 0`, so its snap corner
 * `(0, TOP_BAR + podGap)` sits nearer the viewport's top-left than any real
 * column's and wins `resolveDockTargetByPanelProximity` outright — after which
 * `resolveBandTargetIn` reads that column's all-zero band rects and answers
 * `index = bands.length` with a zero-size outline. Same shape task 272 recorded
 * for the 0px COLLAPSED column, one cause over: that one was fixed by clearing
 * the collapse sentinel, which does nothing for a hidden pane.
 */
export function readDockGeometry(): DockGeometry {
  if (typeof document === "undefined") {
    return { podGap: DEFAULT_POD_GAP, columns: [] };
  }
  const podGap =
    parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue("--pod-gap"),
    ) || DEFAULT_POD_GAP;
  const columns: DockColumnGeometry[] = [];
  for (const col of paneColumns()) {
    const r = col.getBoundingClientRect();
    const side = (col.dataset.panelColumnSide ?? "left") as Side;
    columns.push({
      side,
      left: r.left,
      right: r.right,
      frame: readStackFrameRect(col, r, side, podGap),
      bands: readBandRects(col),
    });
  }
  return { podGap, columns };
}

/**
 * Resolve the band insertion point + outline rect for a probe `y` within a
 * captured column. `index` is the stack gap the probe is over: the count of
 * bands whose vertical midpoint is above `y`, clamped to `[0, bands.length]`.
 * The outline rect previews where the band would land — the existing band's
 * footprint at the insertion boundary, or the full stack frame when the stack
 * is empty. PURE: arithmetic over the snapshot, no DOM.
 */
function resolveBandTargetIn(col: DockColumnGeometry, y: number): DockDragTarget {
  const { side, bands, frame } = col;
  if (bands.length === 0) {
    // Empty stack: insertion at index 0; preview the full dock frame.
    return { side, index: 0, rect: frame };
  }

  // Insertion index = number of bands whose midpoint sits above the
  // probe. Clamped to [0, bands.length].
  let index = 0;
  for (const b of bands) {
    const mid = b.top + b.height / 2;
    if (y > mid) index += 1;
    else break;
  }
  if (index > bands.length) index = bands.length;

  // Outline rect: preview the slot the new band occupies. For an
  // insertion at the bottom (index === bands.length) hug the bottom
  // band's footprint; otherwise hug the band currently at `index` (the
  // one the new band would push down).
  const refBand = index < bands.length ? bands[index] : bands[bands.length - 1];
  return {
    side,
    index,
    rect: { left: refBand.left, top: refBand.top, width: refBand.width, height: refBand.height },
  };
}

/**
 * Auto-dock proximity test: find the column whose outer-top corner is
 * closest to the floating panel's matching top corner — within
 * `threshold` pixels (Euclidean). Resolves the band insertion index from
 * the cursor's y (preferred) or the panel's vertical center.
 *
 * PURE — every input comes from `geom` (a `readDockGeometry()` snapshot) plus
 * the caller's own drag arithmetic, so this is safe to call per pointer event.
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
export function resolveDockTargetByPanelProximity(
  geom: DockGeometry,
  panelRect: { x: number; y: number; width: number; height: number },
  threshold: number = AUTO_DOCK_PROXIMITY,
  /** Optional cursor coords. When provided, the cursor's y picks the
   *  band insertion index — better aligned with user intent than the
   *  panel's vertical center, which for a tall float can land in a
   *  different gap than the cursor. */
  cursor?: { x: number; y: number },
): DockDragTarget | null {
  let best: DockColumnGeometry | null = null;
  let bestDist = Infinity;
  for (const col of geom.columns) {
    // Snap corner at the dock frame's predicted outer-top corner
    // (TOP_BAR + podGap — consistent regardless of toolbar extension).
    const cornerX = col.side === "left" ? col.left : col.right;
    const cornerY = TOP_BAR + geom.podGap;
    const panelCornerX =
      col.side === "left" ? panelRect.x : panelRect.x + panelRect.width;
    const panelCornerY = panelRect.y;
    const dx = cornerX - panelCornerX;
    const dy = cornerY - panelCornerY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < threshold && dist < bestDist) {
      best = col;
      bestDist = dist;
    }
  }
  if (!best) return null;
  // Resolve the band insertion index from the cursor y (user intent) or
  // the panel's vertical center as a fallback.
  const probeY = cursor ? cursor.y : panelRect.y + panelRect.height / 2;
  return resolveBandTargetIn(best, probeY);
}
