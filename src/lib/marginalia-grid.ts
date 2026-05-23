/**
 * Line-aligned margin grid placement algorithm.
 *
 * Every UUID-bearing text element generates an implicit grid in both margins:
 * - Rows = number of text lines in the element
 * - Columns = MARGINALIA_COLS (2) per side
 *
 * Markers fill cells left-to-right, top-to-bottom. When the grid overflows
 * (more markers than cells), excess markers clamp to the last row.
 *
 * This module is a pure function with no DOM access — all measurements come
 * from the useMarginalia hook via AnchorNodeMetrics.
 */

import type { PanelId } from "@/hooks/useViewPrefs";
import {
  MARKER_META,
  MARGINALIA_COLS,
  MARGINALIA_COL_GAP,
  MARGINALIA_GUTTER_WIDTH,
  MARGINALIA_ICON_SIZE,
  MARGINALIA_INNER_PAD,
  type AnchorNodeMetrics,
  type MarginaliaMarker,
  type PositionedMarker,
} from "./marginalia";

/**
 * Compute final pixel positions for all margin markers using the
 * line-aligned grid system.
 *
 * @param getMetrics  Per-UUID lookup of measurements from
 *                    useMarginaliaRegistry. Returns `null` for off-screen
 *                    or not-yet-measured blocks — those markers are
 *                    silently skipped, which is correct (off-screen
 *                    blocks don't render marginalia).
 * @param markers     Flat list of markers from EditorLayout
 * @param panelSides  Which side each panel is currently docked on
 * @returns Markers with resolved side, grid cell, and pixel coordinates
 */
export function computeMarkerPositions(
  getMetrics: (uuid: string) => AnchorNodeMetrics | null,
  markers: readonly MarginaliaMarker[],
  panelSides: Partial<Record<PanelId, "left" | "right" | null>>,
): PositionedMarker[] {
  if (markers.length === 0) return [];

  const result: PositionedMarker[] = [];
  // Track how many markers have been placed per paragraph+side
  const counters = new Map<string, number>();

  for (const m of markers) {
    const node = getMetrics(m.textObjectId);
    if (!node) continue; // anchor TextObject not visible / not yet measured

    // Resolve side: explicit override > current panel dock > default
    const meta = MARKER_META[m.type];
    const dockedSide = panelSides[meta.panelId];
    const side: "left" | "right" = m.side ?? dockedSide ?? meta.defaultSide;

    const key = `${m.textObjectId}|${side}`;
    const idx = counters.get(key) ?? 0;
    counters.set(key, idx + 1);

    // Grid placement: fill L→R within a row, T→B across rows.
    // The inner-left slot (col=1 on the left) is reserved across all
    // paragraphs and headings — it's the strip immediately next to the
    // grab handle, kept clear for the paragraph popout button. So on
    // the left side we use a single effective column (col=0, outer);
    // markers beyond the first stack to additional rows. The right
    // side keeps both columns.
    const effectiveCols = side === "left" ? 1 : MARGINALIA_COLS;
    let row = Math.floor(idx / effectiveCols);
    let col = idx % effectiveCols;
    let overflow = false;

    // Overflow: clamp to last row if the grid is full
    if (row >= node.lineCount) {
      row = Math.max(0, node.lineCount - 1);
      overflow = true;
    }

    // Pixel Y: center the icon vertically within the text line
    const y =
      node.top + row * node.lineHeight + (node.lineHeight - MARGINALIA_ICON_SIZE) / 2;

    // Pixel X: icons are inset from the text edge by MARGINALIA_INNER_PAD.
    // Left gutter packs from right (text edge) toward left (outer edge).
    // Right gutter packs from left (text edge) toward right (outer edge).
    const iconsWidth =
      MARGINALIA_COLS * MARGINALIA_ICON_SIZE +
      (MARGINALIA_COLS - 1) * MARGINALIA_COL_GAP;
    const x =
      side === "left"
        ? MARGINALIA_GUTTER_WIDTH -
          MARGINALIA_INNER_PAD -
          iconsWidth +
          col * (MARGINALIA_ICON_SIZE + MARGINALIA_COL_GAP)
        : MARGINALIA_INNER_PAD +
          col * (MARGINALIA_ICON_SIZE + MARGINALIA_COL_GAP);

    result.push({
      ...m,
      side,
      cell: { col, row, x, y },
      overflow,
    });
  }

  return result;
}
