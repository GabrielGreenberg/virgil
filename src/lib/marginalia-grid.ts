/**
 * Line-aligned margin grid placement algorithm.
 *
 * Every UUID-bearing text element generates an implicit grid in both margins:
 * - Rows = number of text lines in the element
 * - Columns = the `laneCols` the caller resolved for that side — up to
 *   MARGINALIA_COLS (2) on the right, 1 on the left (its inner slot is
 *   reserved for the paragraph popout button), and fewer (or none) at a
 *   narrowed margin, where the lane SSOT hands the outboard bands to the
 *   tucked selection bolt (`resolveMarkerCols`)
 *
 * Markers fill cells left-to-right, top-to-bottom. When a node's grid
 * overflows (more markers than cells), the LAST cell is reserved for a
 * "+K" overflow pill (R16): the markers that don't fit are returned in an
 * overflow group instead of being stacked/clamped, and the margin renders
 * a pill in the reserved cell whose popover lists them.
 *
 * This module is a pure function with no DOM access — all measurements come
 * from the useMarginalia hook via AnchorNodeMetrics.
 */

import { marginSideForMarkerType, type PanelSideMap } from "./margin-side";
import {
  MARGINALIA_COL_GAP,
  MARGINALIA_ICON_SIZE,
  marginaliaGridX,
  type AnchorNodeMetrics,
  type GridCell,
  type MarginaliaMarker,
  type MarkerOverflowGroup,
  type PositionedMarker,
} from "./marginalia";

export interface MarkerPositionsResult {
  /** Markers that fit in their node's grid, with resolved pixel cells. */
  positioned: PositionedMarker[];
  /** One group per overflowing (node, side): the reserved last cell where
   *  the "+K" pill renders, plus the hidden markers it stands in for. */
  overflowGroups: MarkerOverflowGroup[];
  /** CHIP-B: markers whose card resolved to `source:'orphan'` (`m.unanchored`).
   *  They have no live paragraph to line-align against, so they're carried
   *  out of the grid for the margin's fixed "unanchored — click to re-pin"
   *  dock instead of being silently dropped (the RC2 vanish bug). Side is
   *  resolved the same way as a positioned marker (override > dock > default).
   */
  orphans: Array<MarginaliaMarker & { side: "left" | "right" }>;
}

/** Pixel coordinates for grid cell (row, col) of `node` on `side`. */
function cellAt(
  side: "left" | "right",
  node: AnchorNodeMetrics,
  row: number,
  col: number,
): GridCell {
  // Pixel Y: center the icon vertically within the text line.
  const y =
    node.top + row * node.lineHeight + (node.lineHeight - MARGINALIA_ICON_SIZE) / 2;

  // Pixel X (container-relative), from the lane SSOT's per-side col0 offset
  // (`marginaliaGridX`). Left margin packs from the outer edge inward toward
  // the text; right margin packs from `MARGINALIA_GRID_X_RIGHT` — the col0
  // offset in the right-lane band list, OUTBOARD of the inboard selection-bolt
  // band (so the bolt no longer paints over the markers) — outward toward the
  // scrollbar. `cell.x` is relative to the marker container's own edge
  // (`podRight − MARGIN_WIDTH_RIGHT` / `podLeft`), the SAME reference the
  // pod-anchored bolt and the lane-fit predicate use.
  const x =
    marginaliaGridX(side) + col * (MARGINALIA_ICON_SIZE + MARGINALIA_COL_GAP);

  return { col, row, x, y };
}

/**
 * Compute final pixel positions for all margin markers using the
 * line-aligned grid system.
 *
 * @param getMetrics  Per-UUID lookup of measurements from
 *                    useMarginaliaRegistry. Returns `null` for off-screen
 *                    or not-yet-measured blocks — those (non-orphan) markers
 *                    are skipped from grid placement, which is correct
 *                    (off-screen blocks don't render marginalia; an unmeasured
 *                    but resolved block re-renders once the registry observes
 *                    it — CHIP-B part 2). An `m.unanchored` (orphan) marker
 *                    has no live paragraph at all, so it never consults
 *                    `getMetrics` — it goes straight to the `orphans` bucket.
 * @param markers     Flat list of markers from the margin-marker builder
 * @param panelSides  Which side each panel is currently docked on
 * @param laneCols    Per-side effective marker COLUMNS at the current margin,
 *                    from `resolveMarkerCols` in the lane SSOT (tasks 214/325).
 *                    `0` renders NOTHING on that side — no cells, no "+K" pill,
 *                    no re-pin dock — because the whole column is pod-anchored
 *                    at lane offsets the prose has taken back; placing any of it
 *                    would paint over the last words of the line. A REDUCED
 *                    count is the cramped right lane, where the tucked selection
 *                    bolt occupies the outboard columns' bands and the grid
 *                    keeps only what stays inboard of it; the surplus markers
 *                    ride the "+K" overflow pill that already exists for an
 *                    over-full grid. Required (not defaulted) so no consumer can
 *                    inherit a count it never decided; the fail-open case
 *                    belongs to `resolveMarkerCols`, which owns what unmeasured
 *                    means.
 * @returns Positioned markers, per-(node, side) overflow groups (R16), and
 *          the orphan markers for the fixed re-pin dock (CHIP-B)
 */
export function computeMarkerPositions(
  getMetrics: (uuid: string) => AnchorNodeMetrics | null,
  markers: readonly MarginaliaMarker[],
  panelSides: PanelSideMap,
  laneCols: { left: number; right: number },
): MarkerPositionsResult {
  if (markers.length === 0)
    return { positioned: [], overflowGroups: [], orphans: [] };

  const orphans: Array<MarginaliaMarker & { side: "left" | "right" }> = [];

  // Pass 1 — resolve each marker's side + metrics and group per
  // (textObjectId, side), preserving input order. Grouping first lets us
  // know a grid's total occupancy before placing anything, which is what
  // the reserved-last-cell rule needs.
  interface NodeGroup {
    side: "left" | "right";
    node: AnchorNodeMetrics;
    textObjectId: string;
    items: MarginaliaMarker[];
  }
  const groups = new Map<string, NodeGroup>();
  for (const m of markers) {
    // Resolve side first, through the ONE margin-side authority
    // (`@/lib/margin-side`): explicit override > current panel dock >
    // registry default. The anchor rail runs the same call with the same
    // `panelSides`, which is what keeps the marker and the rail on the same
    // edge under a non-default dock. Orphans need a side for the dock too, so
    // this runs before the metrics gate.
    const side = marginSideForMarkerType(m.type, panelSides, m.side);

    // Task 214 — the CRAMPED regime. Ask BEFORE the orphan branch: the re-pin
    // dock lives inside the same pod-anchored column, so a side the margin
    // can't host drops its whole chrome set together (grid cells, "+K" pill,
    // dock). This mirrors what zen and the read-only reader were already
    // documented to do — hide. Between "all columns" and "none" the lane
    // resolution can also hand back a REDUCED count (task 325: the tucked bolt
    // takes the outboard bands); that is the sub-lane the pre-325 comment here
    // wrongly said a two-column grid had none of.
    if (laneCols[side] <= 0) continue;

    // CHIP-B: an orphan card has no live paragraph — it can't be line-aligned.
    // Carry it to the fixed re-pin dock instead of culling it (the RC2 vanish).
    if (m.unanchored) {
      orphans.push({ ...m, side });
      continue;
    }

    const node = getMetrics(m.textObjectId);
    if (!node) continue; // anchor TextObject not visible / not yet measured

    const key = `${m.textObjectId}|${side}`;
    let g = groups.get(key);
    if (!g) {
      g = { side, node, textObjectId: m.textObjectId, items: [] };
      groups.set(key, g);
    }
    g.items.push(m);
  }

  // Pass 2 — place each group's markers L→R, T→B, in whatever columns the lane
  // resolution granted this side. The inner-left slot (col=1 on the left) is
  // reserved across all paragraphs and headings — it's the strip immediately
  // next to the grab handle, kept clear for the paragraph popout button — so
  // the left side is always a single effective column; the right side gets both
  // where the lane is whole and one where the tucked bolt has taken the outboard
  // band. The count is the caller's resolved answer, never re-derived here.
  const positioned: PositionedMarker[] = [];
  const overflowGroups: MarkerOverflowGroup[] = [];

  for (const g of groups.values()) {
    const effectiveCols = laneCols[g.side];
    const capacity = Math.max(1, g.node.lineCount) * effectiveCols;
    const overflowing = g.items.length > capacity;
    // R16: when overflowing, reserve the LAST cell for the "+K" pill; only
    // capacity-1 markers render and the rest ride the pill's popover.
    const visibleCount = overflowing ? capacity - 1 : g.items.length;

    for (let idx = 0; idx < visibleCount; idx++) {
      const row = Math.floor(idx / effectiveCols);
      const col = idx % effectiveCols;
      positioned.push({
        ...g.items[idx],
        side: g.side,
        cell: cellAt(g.side, g.node, row, col),
      });
    }

    if (overflowing) {
      const pillIdx = capacity - 1;
      overflowGroups.push({
        side: g.side,
        textObjectId: g.textObjectId,
        cell: cellAt(
          g.side,
          g.node,
          Math.floor(pillIdx / effectiveCols),
          pillIdx % effectiveCols,
        ),
        hidden: g.items.slice(visibleCount),
      });
    }
  }

  return { positioned, overflowGroups, orphans };
}
