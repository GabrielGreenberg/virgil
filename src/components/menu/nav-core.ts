/**
 * The pure, React-free navigation core for the `<Menu>` primitive
 * (design §3.1/§3.4). All roving-`aria-activedescendant` index math lives here
 * so it is exhaustively unit-testable — list wrap + Home/End, grid Left/Right
 * in-row + Up/Down between rows by `coords.col`, and the composite grid↔list
 * cross-region edge with remembered `lastGridCol` + partial-last-row clamp +
 * disabled-skip at the seam.
 *
 * The controller (`useMenuKeyboard`) is a thin React wrapper that feeds the
 * live snapshot + active id in and applies the returned next-id. Keystroke
 * sanctity: every function here is O(snapshot length ~11–16) index arithmetic
 * over an array — never a doc read, never `doc.descendants`.
 */

import type { MenuLayout, MenuNode, MenuOrientation, NavDir } from "./types";

/** Carried across moves: the column the user last occupied in the grid, so
 *  re-entering the grid from the list lands on the same column (§3.4). */
export interface NavMemory {
  lastGridCol: number;
}

export function freshNavMemory(): NavMemory {
  return { lastGridCol: 0 };
}

const ENABLED = (n: MenuNode) => !n.disabled && n.region !== "widget";

/** The first enabled (navigable) node, or null. */
function firstEnabled(nodes: MenuNode[]): MenuNode | null {
  return nodes.find(ENABLED) ?? null;
}

/** The default active node when a menu first opens / has no active id —
 *  the first enabled node in snapshot order. */
export function initialActiveId(nodes: MenuNode[]): string | null {
  return firstEnabled(nodes)?.id ?? null;
}

// ── List nav ────────────────────────────────────────────────────────────────

/** Step within a flat list, wrapping, skipping disabled. Vertical (default):
 *  Up/Down step, Left/Right inert. Horizontal (opt-in, §3-color-popover):
 *  Left/Right step, Up/Down inert. Home/End jump to first/last enabled in both.
 *  Returns the next id (or the current one if there is no enabled target). */
function listMove(
  nodes: MenuNode[],
  activeId: string | null,
  dir: NavDir,
  orientation: MenuOrientation,
): string | null {
  const enabled = nodes.filter(ENABLED);
  if (enabled.length === 0) return null;
  if (dir === "home") return enabled[0].id;
  if (dir === "end") return enabled[enabled.length - 1].id;
  // Normalize the stepping axis: the "forward" key is Down (vertical) or Right
  // (horizontal); the "backward" key is Up or Left. The off-axis keys are inert.
  const forward = orientation === "horizontal" ? "right" : "down";
  const backward = orientation === "horizontal" ? "left" : "up";
  if (dir !== forward && dir !== backward) return activeId; // off-axis: inert
  const curIdx = enabled.findIndex((n) => n.id === activeId);
  if (curIdx < 0)
    return dir === forward ? enabled[0].id : enabled[enabled.length - 1].id;
  const delta = dir === forward ? 1 : -1;
  const nextIdx = (curIdx + delta + enabled.length) % enabled.length;
  return enabled[nextIdx].id;
}

// ── Grid nav ─────────────────────────────────────────────────────────────────

interface GridShape {
  /** Grid nodes only, indexed by their snapshot order. */
  cells: MenuNode[];
  /** Max row index present in the grid (>= 0), or -1 if empty. */
  maxRow: number;
}

function gridShape(nodes: MenuNode[]): GridShape {
  const cells = nodes.filter((n) => n.region === "grid");
  let maxRow = -1;
  for (const c of cells) {
    if (c.coords && c.coords.row > maxRow) maxRow = c.coords.row;
  }
  return { cells, maxRow };
}

/** The enabled cells in a given grid row, ordered by column. */
function rowCells(cells: MenuNode[], row: number): MenuNode[] {
  return cells
    .filter((c) => c.coords?.row === row)
    .sort((a, b) => (a.coords!.col - b.coords!.col));
}

/** Pick the enabled cell in `row` nearest to (clamped at) `col`. Skips
 *  disabled by walking outward, then falls back to any enabled cell in the
 *  row. Returns null if the row has no enabled cell (the caller decides the
 *  cross-region fallthrough). */
function cellAtRowNearCol(
  cells: MenuNode[],
  row: number,
  col: number,
): MenuNode | null {
  const inRow = rowCells(cells, row); // sorted by col, may include disabled
  if (inRow.length === 0) return null;
  // Clamp the target column to the row's actual extent (partial-last-row, R3).
  const cols = inRow.map((c) => c.coords!.col);
  const minCol = cols[0];
  const maxCol = cols[cols.length - 1];
  const target = Math.max(minCol, Math.min(col, maxCol));
  // Find the enabled cell with the smallest |col - target|, ties → lower col.
  let best: MenuNode | null = null;
  let bestDist = Infinity;
  for (const c of inRow) {
    if (!ENABLED(c)) continue;
    const dist = Math.abs(c.coords!.col - target);
    if (dist < bestDist) {
      best = c;
      bestDist = dist;
    }
  }
  return best;
}

// ── Composite (grid above list) ──────────────────────────────────────────────

/**
 * Step inside a grid region. Left/Right move within the active cell's row
 * (skipping disabled, clamped at the row ends — no wrap across rows).
 * Up/Down move between rows by column. Returns either a next grid id, or the
 * sentinel `{ exit: "below" | "above" }` when the move falls off the grid edge
 * (the composite layout then crosses into the list).
 */
type GridStep =
  | { id: string }
  | { exit: "below" }
  | { exit: "above" }
  | { id: null }; // no enabled target at all

function gridMove(
  shape: GridShape,
  active: MenuNode | null,
  dir: NavDir,
  mem: NavMemory,
): GridStep {
  const { cells, maxRow } = shape;
  if (cells.length === 0) return { id: null };
  // Resolve a starting cell + column.
  const cur =
    active && active.region === "grid" && active.coords ? active : null;
  if (dir === "home") {
    const c = cellAtRowNearCol(cells, 0, -Infinity as unknown as number);
    return c ? { id: c.id } : { id: null };
  }
  if (dir === "end") {
    const c = cellAtRowNearCol(cells, maxRow, Infinity as unknown as number);
    return c ? { id: c.id } : { exit: "below" };
  }
  const curRow = cur?.coords?.row ?? 0;
  const curCol = cur?.coords?.col ?? mem.lastGridCol;

  if (dir === "left" || dir === "right") {
    const inRow = rowCells(cells, curRow);
    const enabledInRow = inRow.filter(ENABLED);
    if (enabledInRow.length === 0) return { id: cur?.id ?? null };
    const idx = enabledInRow.findIndex((c) => c.id === cur?.id);
    if (idx < 0) return { id: enabledInRow[0].id };
    const nextIdx = dir === "right" ? idx + 1 : idx - 1;
    if (nextIdx < 0 || nextIdx >= enabledInRow.length) {
      return { id: cur!.id }; // clamp at row ends (no wrap)
    }
    return { id: enabledInRow[nextIdx].id };
  }

  // Up / Down between rows by column.
  if (dir === "down") {
    for (let r = curRow + 1; r <= maxRow; r++) {
      const c = cellAtRowNearCol(cells, r, curCol);
      if (c) return { id: c.id };
    }
    return { exit: "below" }; // fell off the bottom of the grid → into the list
  }
  // up
  for (let r = curRow - 1; r >= 0; r--) {
    const c = cellAtRowNearCol(cells, r, curCol);
    if (c) return { id: c.id };
  }
  return { exit: "above" }; // off the top of the grid (no region above) → no-op
}

/**
 * The one public mover. Computes the next active id for a given layout,
 * snapshot, current active id, direction, and (mutable) nav memory. Updates
 * `mem.lastGridCol` when leaving the grid downward so re-entry lands on the
 * same column. Returns the next id (or the current id when a move is a no-op /
 * clamped).
 */
export function computeNextActive(
  layout: MenuLayout,
  nodes: MenuNode[],
  activeId: string | null,
  dir: NavDir,
  mem: NavMemory,
  orientation: MenuOrientation = "vertical",
): string | null {
  const active = nodes.find((n) => n.id === activeId) ?? null;

  if (layout === "list" || layout === "combobox") {
    // Orientation only flips a `list` menu's axis. A `combobox` stays vertical
    // (its Left/Right are owned by the input via `onArrowHorizontal`).
    return listMove(
      nodes,
      activeId,
      dir,
      layout === "list" ? orientation : "vertical",
    );
  }

  // No active node yet (the menu just opened, the editor caret holds focus): the
  // first arrow ENTERS the menu at the first enabled node, for every layout —
  // matching the list's no-active behavior (`listMove` returns the first/last on
  // a null active). Without this seed, a grid/composite Down would start its
  // row search at row 1 and skip the first row entirely. Home/End and any
  // direction all land on the snapshot's first enabled cell as the entry point.
  if (!active) {
    const seed = initialActiveId(nodes);
    if (seed !== null) return seed;
  }

  const shape = gridShape(nodes);
  const listNodes = nodes.filter((n) => n.region === "list");

  if (layout === "grid") {
    const step = gridMove(shape, active, dir, mem);
    if ("id" in step) return step.id ?? activeId;
    // No list region in a pure grid → edge exits are no-ops (clamp).
    return activeId;
  }

  // composite: grid above list.
  const inList = active?.region === "list";
  if (inList) {
    // List nav, but Up off the first enabled list item re-enters the grid at
    // {maxRow, lastGridCol} (clamped), and Left/Right are inert in the list.
    const enabledList = listNodes.filter(ENABLED);
    if (enabledList.length === 0) {
      // Empty list — fall through to grid handling.
    } else {
      if (dir === "down") {
        const idx = enabledList.findIndex((n) => n.id === active!.id);
        if (idx >= 0 && idx < enabledList.length - 1) return enabledList[idx + 1].id;
        return active!.id; // clamp at list bottom (no wrap to grid)
      }
      if (dir === "home") return enabledList[0].id;
      if (dir === "end") return enabledList[enabledList.length - 1].id;
      if (dir === "up") {
        const idx = enabledList.findIndex((n) => n.id === active!.id);
        if (idx > 0) return enabledList[idx - 1].id;
        // Up off list[0] → re-enter grid at {maxRow, lastGridCol}, clamped,
        // walking up to find an enabled cell if the bottom rows are disabled.
        if (shape.maxRow >= 0) {
          for (let r = shape.maxRow; r >= 0; r--) {
            const c = cellAtRowNearCol(shape.cells, r, mem.lastGridCol);
            if (c) return c.id;
          }
        }
        return active!.id; // no enabled grid cell → stay
      }
      // left/right inert in the list region
      return active!.id;
    }
  }

  // Active is in the grid (or nothing active yet) → grid nav, with the
  // down-edge crossing into the list.
  const step = gridMove(shape, active, dir, mem);
  if ("exit" in step) {
    if (step.exit === "below") {
      // Remember the column we left from, then land on the first enabled list
      // item (skip-disabled at the seam, R3).
      if (active?.region === "grid" && active.coords) {
        mem.lastGridCol = active.coords.col;
      }
      const firstList = listNodes.find(ENABLED);
      if (firstList) return firstList.id;
      return activeId; // no enabled list item → clamp in the grid
    }
    return activeId; // exit "above" → nothing above the grid → no-op
  }
  // A regular in-grid move — keep the column memory fresh.
  if (step.id) {
    const landed = nodes.find((n) => n.id === step.id);
    if (landed?.region === "grid" && landed.coords) {
      mem.lastGridCol = landed.coords.col;
    }
    return step.id;
  }
  return activeId;
}

/** Build the O(1) bare-letter fast-path map from the snapshot. Maps each
 *  node's `letter` + any `letterAliases` (uppercased) to its id; disabled
 *  nodes are EXCLUDED so a greyed row's letter is inert (matches today). */
export function buildLetterMap(nodes: MenuNode[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const n of nodes) {
    if (n.disabled) continue;
    if (n.letter) map.set(n.letter.toUpperCase(), n.id);
    for (const alias of n.letterAliases ?? []) {
      map.set(alias.toUpperCase(), n.id);
    }
  }
  return map;
}
