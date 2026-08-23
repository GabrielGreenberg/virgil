/**
 * The tidy-tree LAYOUT engine — pure, DOM-free, and the only place tree
 * geometry is decided.
 *
 * Reingold–Tilford shape, generalized to variable node widths: each subtree
 * carries its own left/right CONTOUR (the extreme edges at each relative
 * depth), and a sibling is pushed right by exactly the amount that clears every
 * shared depth of the block already placed. That is what makes two deep
 * subtrees tuck together instead of reserving each other's full bounding box —
 * and it is why "no two labels overlap" is a PROPERTY of the algorithm rather
 * than something a fixture happens not to trip.
 *
 * It is pure for the same reason the marginalia grid packer is: geometry that
 * can be exercised without a DOM is geometry whose invariants can be swept over
 * generated trees rather than pinned to hand-counted pixels. The view measures
 * (one batch of reads per `source` change) and hands the sizes in; nothing here
 * touches an element.
 *
 * Coordinates: `x`/`y` are the LABEL box's top-left, in a space whose origin is
 * the layout's own top-left (the view positions the container, not the nodes).
 * A roofed node's triangle is drawn ABOVE its label, inside the row gap the
 * layout reserves for it — so labels on one row always share a top edge, which
 * is what makes a tree read as a tree.
 */

import type { ForestRenderNode } from "./grammar";
import { noteForestWork } from "./stats";

/** A node's measured label box. Index-aligned with {@link flattenForestTree}. */
export interface ForestNodeSize {
  width: number;
  height: number;
}

export interface ForestLayoutOptions {
  /** Minimum horizontal gap between adjacent subtree contours. */
  hGap: number;
  /** Vertical gap between one row's label bottom and the next row's label top. */
  vGap: number;
  /** Height of a roof triangle, added to the gap ABOVE a row that has one. */
  roofHeight: number;
}

export const DEFAULT_FOREST_LAYOUT: ForestLayoutOptions = {
  hGap: 20,
  vGap: 26,
  roofHeight: 13,
};

/** A placed label box, plus the index that ties it back to the render tree. */
export interface ForestPlacedNode {
  index: number;
  x: number;
  y: number;
  width: number;
  height: number;
  roofed: boolean;
}

export interface ForestEdge {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface ForestRoof {
  apexX: number;
  apexY: number;
  leftX: number;
  rightX: number;
  baseY: number;
}

export interface ForestLayout {
  width: number;
  height: number;
  nodes: ForestPlacedNode[];
  edges: ForestEdge[];
  roofs: ForestRoof[];
}

/**
 * Depth-first flattening — THE node order every other array in this module is
 * keyed on (measured sizes in, placed boxes out). Exported so the view and the
 * layout cannot disagree about which box is which.
 */
export function flattenForestTree(root: ForestRenderNode): ForestRenderNode[] {
  const out: ForestRenderNode[] = [];
  const walk = (n: ForestRenderNode) => {
    out.push(n);
    for (const c of n.children) walk(c);
  };
  walk(root);
  return out;
}

/** Per-relative-depth extreme edges of a subtree, in that subtree's own space
 *  (its root's CENTER is x = 0). */
interface Contour {
  left: number[];
  right: number[];
}

interface Placed {
  /** Center x relative to this node's own parent's center. */
  offset: number;
  contour: Contour;
  index: number;
  children: Placed[];
}

/**
 * Place a subtree, returning its contour with the root centered at x = 0.
 *
 * The recursion is bottom-up: children are placed first (so each carries a real
 * contour), then laid side by side with the minimum clearing shift, then the
 * parent is centered over the FIRST and LAST child centers — the classic
 * definition, and the one the suite asserts as a property.
 */
function place(
  node: ForestRenderNode,
  index: { value: number },
  sizes: ForestNodeSize[],
  opts: ForestLayoutOptions,
): Placed {
  const myIndex = index.value++;
  const size = sizes[myIndex] ?? { width: 0, height: 0 };
  const halfW = size.width / 2;

  if (node.children.length === 0) {
    return {
      offset: 0,
      index: myIndex,
      contour: { left: [-halfW], right: [halfW] },
      children: [],
    };
  }

  const kids: Placed[] = [];
  for (const child of node.children) kids.push(place(child, index, sizes, opts));

  // Accumulated contour of the block of siblings placed so far, in the parent's
  // pre-centering space (first child's center at 0).
  const accLeft: number[] = [];
  const accRight: number[] = [];
  const offsets: number[] = [];

  kids.forEach((kid, k) => {
    let shift = 0;
    if (k > 0) {
      let needed = -Infinity;
      const shared = Math.min(accRight.length, kid.contour.right.length);
      for (let d = 0; d < shared; d++) {
        const want = accRight[d] + opts.hGap - kid.contour.left[d];
        if (want > needed) needed = want;
      }
      shift = needed === -Infinity ? 0 : needed;
    }
    offsets.push(shift);
    for (let d = 0; d < kid.contour.left.length; d++) {
      const l = kid.contour.left[d] + shift;
      const r = kid.contour.right[d] + shift;
      accLeft[d] = accLeft[d] === undefined ? l : Math.min(accLeft[d], l);
      accRight[d] = accRight[d] === undefined ? r : Math.max(accRight[d], r);
    }
  });

  // Centered over the first and last CHILD CENTERS (not over the subtree box) —
  // a wide right subtree must not drag the parent off its own children.
  const center = (offsets[0] + offsets[offsets.length - 1]) / 2;

  kids.forEach((kid, k) => {
    kid.offset = offsets[k] - center;
  });

  const left: number[] = [-halfW];
  const right: number[] = [halfW];
  for (let d = 0; d < accLeft.length; d++) {
    left[d + 1] = accLeft[d] - center;
    right[d + 1] = accRight[d] - center;
  }

  return {
    offset: 0,
    index: myIndex,
    contour: { left, right },
    children: kids,
  };
}

/**
 * Lay out a render tree against measured label sizes.
 *
 * Pure: same tree + same sizes + same options ⇒ byte-identical output. Every
 * geometry the view draws — label positions, parent→child edges, roof triangles
 * — comes from here, so a change of look is a change in ONE place.
 */
export function computeForestLayout(
  root: ForestRenderNode,
  sizes: ForestNodeSize[],
  opts: ForestLayoutOptions = DEFAULT_FOREST_LAYOUT,
): ForestLayout {
  noteForestWork("layout");
  const flat = flattenForestTree(root);
  const placed = place(root, { value: 0 }, sizes, opts);

  // ── Rows: label height per depth, and whether any node on that row is
  // roofed (a roof eats into the gap ABOVE its own row, so the row that
  // carries it needs that much more clearance).
  const rowHeight: number[] = [];
  const rowHasRoof: boolean[] = [];
  const depthOf = (n: Placed, d: number) => {
    const size = sizes[n.index] ?? { width: 0, height: 0 };
    rowHeight[d] = Math.max(rowHeight[d] ?? 0, size.height);
    rowHasRoof[d] = (rowHasRoof[d] ?? false) || flat[n.index].roofed;
    for (const c of n.children) depthOf(c, d + 1);
  };
  depthOf(placed, 0);

  const rowTop: number[] = [];
  for (let d = 0; d < rowHeight.length; d++) {
    if (d === 0) {
      rowTop[0] = rowHasRoof[0] ? opts.roofHeight : 0;
    } else {
      rowTop[d] =
        rowTop[d - 1] +
        rowHeight[d - 1] +
        opts.vGap +
        (rowHasRoof[d] ? opts.roofHeight : 0);
    }
  }

  // ── Absolute placement.
  const nodes: ForestPlacedNode[] = new Array(flat.length);
  const edges: ForestEdge[] = [];
  const roofs: ForestRoof[] = [];

  const assign = (n: Placed, parentCenter: number, d: number) => {
    const cx = parentCenter + n.offset;
    const size = sizes[n.index] ?? { width: 0, height: 0 };
    const y = rowTop[d];
    nodes[n.index] = {
      index: n.index,
      x: cx - size.width / 2,
      y,
      width: size.width,
      height: size.height,
      roofed: flat[n.index].roofed,
    };
    for (const c of n.children) assign(c, cx, d + 1);
  };
  assign(placed, 0, 0);

  // ── Edges and roofs, from the placed boxes.
  const link = (n: Placed) => {
    const me = nodes[n.index];
    for (const c of n.children) {
      const kid = nodes[c.index];
      // A roofed child's incoming edge stops at the triangle's APEX, which is
      // where forest draws it: the roof IS the child's top.
      const targetY = kid.roofed ? kid.y - opts.roofHeight : kid.y;
      edges.push({
        x1: me.x + me.width / 2,
        y1: me.y + me.height,
        x2: kid.x + kid.width / 2,
        y2: targetY,
      });
      link(c);
    }
  };
  link(placed);

  // ── Roofs, built from the placed boxes with NO awareness of the edges just
  // laid above them. That is a DECISION rather than an oversight (task 412),
  // and it is recorded here because silence is how the next reader concludes
  // the engine considered it.
  //
  // Where a parent has >= 3 children and a NON-OUTER one is a roofed LEAF, an
  // outer sibling's edge can clip the triangle's flank. Both halves of that
  // shape are needed and both are extreme. The roof must sit on the SIBLING
  // row, which a roofed INTERNAL node never produces — `flattenRoofs` gives it
  // a synthesized roofed ONLY-child one row down, and an only child can never
  // be a middle sibling — so it takes the `[{x},roof]` leaf spelling. And the
  // outer sibling's own label must be wide enough to swing the parent's centre
  // past the triangle: measured against the suite's own width metric, about 46
  // characters, for a clip that tops out at half the roofed label's width.
  //
  // ACCEPTED rather than routed (Gabriel, 2026-08-21): the reading is a line
  // clipping a triangle tip, not a misread tree, and routing edges around
  // obstacles is a real layout feature with its own failure modes — it would
  // either move labels (renegotiating every pin the placement already carries)
  // or bend edges, which is a look nobody asked for. What is NOT accepted is
  // silence: the geometry is PINNED in `forest-layout.test.ts` ("edges vs
  // roofs"), as an EXACT SET over the corpus plus the numbers of the one
  // declared crosser — so a future layout change that alters it fails loudly
  // and is renegotiated on purpose.
  //
  // Whether upstream `forest` routes around its own roofs is UNVERIFIED; it is
  // likely and it has not been checked, so this pin borrows no authority from
  // it.
  for (const n of nodes) {
    if (!n.roofed) continue;
    roofs.push({
      apexX: n.x + n.width / 2,
      apexY: n.y - opts.roofHeight,
      leftX: n.x,
      rightX: n.x + n.width,
      baseY: n.y,
    });
  }

  // ── Normalize into a 0-origin box.
  let minX = Infinity;
  let maxX = -Infinity;
  let maxY = 0;
  for (const n of nodes) {
    minX = Math.min(minX, n.x);
    maxX = Math.max(maxX, n.x + n.width);
    maxY = Math.max(maxY, n.y + n.height);
  }
  if (!Number.isFinite(minX)) {
    minX = 0;
    maxX = 0;
  }
  const dx = -minX;
  for (const n of nodes) n.x += dx;
  for (const e of edges) {
    e.x1 += dx;
    e.x2 += dx;
  }
  for (const r of roofs) {
    r.apexX += dx;
    r.leftX += dx;
    r.rightX += dx;
  }

  return { width: maxX - minX, height: maxY, nodes, edges, roofs };
}
