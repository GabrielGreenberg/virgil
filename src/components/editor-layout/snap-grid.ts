// Directional snap-grid for every floating toolbar. Pure, no React.
//
// Lines are congruent with the edges of the main text (editor column),
// plus — when the editor is split — the edges of each split pane.
// Every boundary emits two directional lines at the same coordinate so
// a pod can snap on either side: one for a pod whose body sits *inside*
// the line (inset by HORIZ/VERT), and one for a pod whose body sits
// *outside* it (same padding, opposite direction). The opposite edge
// of the pod never tries to grab the same line — which is what lets a
// toolbar be dragged freely past the text bounds.
//
// Snapping operates on the screen-space AABB of the menu wrapper, which
// is what getBoundingClientRect() returns even under CSS rotation — so
// rotation is handled for free.

export const SNAP = 40;
export const HORIZ = 10;
export const VERT = 16;

export type HGridLine = { y: number; side: "top" | "bottom"; source: string };
export type VGridLine = { x: number; side: "left" | "right"; source: string };
export type SnapGrid = { h: HGridLine[]; v: VGridLine[] };

export type RectLike = { left: number; top: number; right: number; bottom: number };

/** Emit each of a region's four edges as **two** directional lines — one
 *  attracting a pod on the inside of the line, one attracting a pod on
 *  the outside. Both use the same padding, so the pod body ends up the
 *  same distance from the line in either direction. */
function bidirectionalRegionLines(rect: RectLike, source: string): { h: HGridLine[]; v: VGridLine[] } {
  return {
    h: [
      // top edge of region: pod below (inside) or pod above (outside)
      { y: rect.top, side: "top", source: `${source}.top-inside` },
      { y: rect.top, side: "bottom", source: `${source}.top-outside` },
      // bottom edge: pod above (inside) or pod below (outside)
      { y: rect.bottom, side: "top", source: `${source}.bottom-outside` },
      { y: rect.bottom, side: "bottom", source: `${source}.bottom-inside` },
    ],
    v: [
      // left edge: pod right of it (inside) or pod left of it (outside)
      { x: rect.left, side: "left", source: `${source}.left-inside` },
      { x: rect.left, side: "right", source: `${source}.left-outside` },
      // right edge: pod left of it (inside) or pod right of it (outside)
      { x: rect.right, side: "left", source: `${source}.right-outside` },
      { x: rect.right, side: "right", source: `${source}.right-inside` },
    ],
  };
}

export function computeSnapGrid(opts: {
  /** The main-text region — its four edges are the primary snap lines.
   *  Matches the editor column's viewport rect. */
  editorCol?: RectLike | null;
  /** Editor split panes, when the editor is split. Each pane
   *  contributes its own four-edge snap lines so the floating toolbars
   *  can align to either half of the split independently. */
  splitPanes?: RectLike[] | null;
}): SnapGrid {
  const h: HGridLine[] = [];
  const v: VGridLine[] = [];
  const push = (r: { h: HGridLine[]; v: VGridLine[] }) => {
    h.push(...r.h);
    v.push(...r.v);
  };
  if (opts.editorCol) push(bidirectionalRegionLines(opts.editorCol, "editor-col"));
  if (opts.splitPanes) {
    opts.splitPanes.forEach((rect, i) => push(bidirectionalRegionLines(rect, `split-pane-${i}`)));
  }
  return { h, v };
}

export type AxisSnap =
  | { kind: "h"; line: HGridLine; edge: "top" | "bottom"; target: number }
  | { kind: "v"; line: VGridLine; edge: "left" | "right"; target: number }
  | null;

/** Given the menu's wrapper rect and its knob overflow, find the best
 *  snap candidate per axis. The "visible body" rect is the wrapper
 *  *expanded* by the knob overflow (the knob protrudes OUTSIDE the
 *  wrapper's measurable bounds), and it's the body edge that aligns to
 *  `line ± INSET`. This matches the historical MenuBar behavior. */
export function snapWrapper(opts: {
  wrapper: { left: number; top: number; width: number; height: number };
  overflow: { left: number; right: number; top: number; bottom: number };
  grid: SnapGrid;
}): { xSnap: AxisSnap; ySnap: AxisSnap } {
  const { wrapper, overflow, grid } = opts;
  const bodyL = wrapper.left - overflow.left;
  const bodyR = wrapper.left + wrapper.width + overflow.right;
  const bodyT = wrapper.top - overflow.top;
  const bodyB = wrapper.top + wrapper.height + overflow.bottom;

  let best: AxisSnap = null;
  let bestDist = SNAP;
  for (const line of grid.v) {
    if (line.side === "left") {
      const target = line.x + HORIZ;
      const d = Math.abs(bodyL - target);
      if (d < bestDist) { best = { kind: "v", line, edge: "left", target }; bestDist = d; }
    } else {
      const target = line.x - HORIZ;
      const d = Math.abs(bodyR - target);
      if (d < bestDist) { best = { kind: "v", line, edge: "right", target }; bestDist = d; }
    }
  }
  const xSnap = best;

  best = null;
  bestDist = SNAP;
  for (const line of grid.h) {
    if (line.side === "top") {
      const target = line.y + VERT;
      const d = Math.abs(bodyT - target);
      if (d < bestDist) { best = { kind: "h", line, edge: "top", target }; bestDist = d; }
    } else {
      const target = line.y - VERT;
      const d = Math.abs(bodyB - target);
      if (d < bestDist) { best = { kind: "h", line, edge: "bottom", target }; bestDist = d; }
    }
  }
  const ySnap = best;

  return { xSnap, ySnap };
}

/** Read the rotation knob overflow from a toolbar wrapper. Every
 *  floating toolbar exposes its knob via `data-toolbar-knob=""` on a
 *  descendant button. The knob protrudes past the wrapper's bounds, so
 *  snap math needs to know by how much on each side. Returns zeros
 *  when no knob is present (e.g. at-home MenuBar or collapsed pods). */
export function readKnobOverflow(wrap: HTMLElement): { left: number; right: number; top: number; bottom: number } {
  const knob = wrap.querySelector("[data-toolbar-knob]") as HTMLElement | null;
  const wRect = wrap.getBoundingClientRect();
  const kRect = knob?.getBoundingClientRect();
  if (!kRect) return { left: 0, right: 0, top: 0, bottom: 0 };
  return {
    left: Math.max(0, wRect.left - kRect.left),
    right: Math.max(0, kRect.right - wRect.right),
    top: Math.max(0, wRect.top - kRect.top),
    bottom: Math.max(0, kRect.bottom - wRect.bottom),
  };
}

/** One-shot snap resolver shared by every floating-toolbar drag (main
 *  MenuBar, detached Actions, detached Formatting). Given raw cursor-
 *  derived coordinates and the toolbar's wrapper element, reads the
 *  wrapper's current size and knob overflow, runs the directional
 *  snap math, clamps the result so the pod body (wrapper extended by
 *  knob overflow) stays fully inside the viewport, and returns
 *  absolute {left, top} in viewport coords.
 *
 *  Callers feed these back into whatever state drives the toolbar's
 *  `style.left`/`style.top` on the portal wrapper. When `wrapper` is
 *  null or unmeasured (first frame after mount), falls back to the
 *  raw coords so the pod still follows the cursor. */
export function resolveDragPosition(opts: {
  rawLeft: number;
  rawTop: number;
  wrapper: HTMLElement | null;
  grid: SnapGrid;
  winW: number;
  winH: number;
}): { left: number; top: number } {
  const { rawLeft, rawTop, wrapper, grid, winW, winH } = opts;
  // Defensive viewport clamp — when the wrapper hasn't rendered yet
  // (first frame after a portal-mounted tear-off) we can't measure the
  // body, but we still want to keep the pod on-screen. Clamp the raw
  // coords assuming zero size so the wrapper's top-left at least stays
  // inside the viewport. Subsequent frames clamp precisely.
  if (!wrapper) return {
    left: Math.max(0, Math.min(winW, rawLeft)),
    top: Math.max(0, Math.min(winH, rawTop)),
  };
  const wRect = wrapper.getBoundingClientRect();
  const width = wRect.width;
  const height = wRect.height;
  if (width === 0 || height === 0) return {
    left: Math.max(0, Math.min(winW, rawLeft)),
    top: Math.max(0, Math.min(winH, rawTop)),
  };
  const overflow = readKnobOverflow(wrapper);
  const { xSnap, ySnap } = snapWrapper({
    wrapper: { left: rawLeft, top: rawTop, width, height },
    overflow,
    grid,
  });
  const style = applySnapStyle({
    overflow,
    xSnap,
    ySnap,
    free: { left: rawLeft, top: rawTop },
    winSize: { w: winW, h: winH },
  });
  const resolvedLeft = style.left !== undefined ? style.left : winW - (style.right ?? 0) - width;
  const resolvedTop = style.top !== undefined ? style.top : winH - (style.bottom ?? 0) - height;
  // Viewport clamp — keep the entire body (wrapper plus knob overflow
  // on each side) inside the window so no floating toolbar can slip
  // under the browser chrome or off any edge. When the body is wider
  // or taller than the viewport (pathological), clamp to the min edge
  // so at least the leading/top corner stays visible.
  const minLeft = overflow.left;
  const maxLeft = Math.max(minLeft, winW - width - overflow.right);
  const minTop = overflow.top;
  const maxTop = Math.max(minTop, winH - height - overflow.bottom);
  return {
    left: Math.max(minLeft, Math.min(maxLeft, resolvedLeft)),
    top: Math.max(minTop, Math.min(maxTop, resolvedTop)),
  };
}

/** Derive CSS position props from snap state. Uses left/top for free or
 *  "start-side" snaps, and right/bottom for "end-side" snaps so we don't
 *  need to know the wrapper's rendered size. Non-snapped axes fall back
 *  to free coords. */
export function applySnapStyle(opts: {
  overflow: { left: number; right: number; top: number; bottom: number };
  xSnap: AxisSnap;
  ySnap: AxisSnap;
  free: { left: number; top: number };
  winSize: { w: number; h: number };
}): { left?: number; right?: number; top?: number; bottom?: number } {
  const { overflow, xSnap, ySnap, free, winSize } = opts;
  const out: { left?: number; right?: number; top?: number; bottom?: number } = {};

  // The body extends OUTSIDE the wrapper by `overflow` on each side
  // (the knob protrudes past the measurable box). To put the body edge
  // on the target, shift the wrapper inward by the overflow.
  if (xSnap && xSnap.kind === "v") {
    if (xSnap.edge === "left") out.left = xSnap.target + overflow.left;
    else out.right = winSize.w - xSnap.target + overflow.right;
  } else {
    out.left = free.left;
  }
  if (ySnap && ySnap.kind === "h") {
    if (ySnap.edge === "top") out.top = ySnap.target + overflow.top;
    else out.bottom = winSize.h - ySnap.target + overflow.bottom;
  } else {
    out.top = free.top;
  }
  return out;
}
