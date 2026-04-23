// Unified directional snap-grid for floating toolbars (main MenuBar and
// detached Actions pod). Pure, no React.
//
// Each grid line is "directional": it attracts exactly one edge of the
// menu. A side:"top" line attracts the menu's screen-top edge (menu ends
// up below the line, inset down by VERT). A side:"bottom" line attracts
// the screen-bottom edge (menu above the line). Left/right analogous
// with HORIZ. The opposite edge never tries to snap to that line — which
// is what lets a toolbar be dragged *above* the page-top line without
// its bottom accidentally grabbing the line.
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

/** Emit the four edges of a region as directional lines, each insetting
 *  *into* the region. A menu inside the region will snap to these.
 *  Sharing a coordinate with another region's line is fine and desired
 *  — they attract different menu edges. */
function regionLines(rect: RectLike, source: string): { h: HGridLine[]; v: VGridLine[] } {
  return {
    h: [
      { y: rect.top, side: "top", source: `${source}.top` },
      { y: rect.bottom, side: "bottom", source: `${source}.bottom` },
    ],
    v: [
      { x: rect.left, side: "left", source: `${source}.left` },
      { x: rect.right, side: "right", source: `${source}.right` },
    ],
  };
}

export function computeSnapGrid(opts: {
  editorCol?: RectLike | null;
  leftPanel?: RectLike | null;
  rightPanel?: RectLike | null;
  /** y of the "top pod bottom" (upper split edge, side:bottom) and
   *  "bottom pod top" (lower split edge, side:top) when the right
   *  panel is split. */
  rightSplit?: { upperY: number; lowerY: number } | null;
  leftSplit?: { upperY: number; lowerY: number } | null;
}): SnapGrid {
  const h: HGridLine[] = [];
  const v: VGridLine[] = [];
  const push = (r: { h: HGridLine[]; v: VGridLine[] }) => {
    h.push(...r.h);
    v.push(...r.v);
  };
  if (opts.editorCol) push(regionLines(opts.editorCol, "editor-col"));
  if (opts.leftPanel) push(regionLines(opts.leftPanel, "left-panel"));
  if (opts.rightPanel) push(regionLines(opts.rightPanel, "right-panel"));
  if (opts.rightSplit) {
    h.push({ y: opts.rightSplit.upperY, side: "bottom", source: "right-panel.split-upper" });
    h.push({ y: opts.rightSplit.lowerY, side: "top", source: "right-panel.split-lower" });
  }
  if (opts.leftSplit) {
    h.push({ y: opts.leftSplit.upperY, side: "bottom", source: "left-panel.split-upper" });
    h.push({ y: opts.leftSplit.lowerY, side: "top", source: "left-panel.split-lower" });
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
