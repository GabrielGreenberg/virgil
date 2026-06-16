// nav-core: the pure roving-aria-activedescendant index math (design §3.1/§3.4).
// Tests list wrap + Home/End, grid Left/Right/Up/Down by coords.col, and the
// composite grid↔list cross-region edge MATRIX (R3): every grid corner ↔ list
// head, disabled at the seam, partial last row, lastGridCol memory.

import { describe, it, expect } from "vitest";
import {
  computeNextActive,
  buildLetterMap,
  initialActiveId,
  freshNavMemory,
  type NavMemory,
} from "../nav-core";
import type { MenuNode } from "../types";

// ── fixtures ──────────────────────────────────────────────────────────────

function listNode(id: string, opts: Partial<MenuNode> = {}): MenuNode {
  return {
    id,
    region: "list",
    disabled: false,
    run: () => {},
    domId: `m-item-${id}`,
    ref: null,
    ...opts,
  };
}

function gridNode(id: string, row: number, col: number, opts: Partial<MenuNode> = {}): MenuNode {
  return {
    id,
    region: "grid",
    coords: { row, col },
    disabled: false,
    run: () => {},
    domId: `m-item-${id}`,
    ref: null,
    ...opts,
  };
}

// ── list nav ────────────────────────────────────────────────────────────────

describe("list nav", () => {
  const nodes = [listNode("a"), listNode("b"), listNode("c")];

  it("Down steps forward and wraps", () => {
    expect(computeNextActive("list", nodes, "a", "down", freshNavMemory())).toBe("b");
    expect(computeNextActive("list", nodes, "c", "down", freshNavMemory())).toBe("a");
  });

  it("Up steps back and wraps", () => {
    expect(computeNextActive("list", nodes, "b", "up", freshNavMemory())).toBe("a");
    expect(computeNextActive("list", nodes, "a", "up", freshNavMemory())).toBe("c");
  });

  it("Home/End jump to first/last enabled", () => {
    expect(computeNextActive("list", nodes, "b", "home", freshNavMemory())).toBe("a");
    expect(computeNextActive("list", nodes, "b", "end", freshNavMemory())).toBe("c");
  });

  it("skips disabled rows in both directions and at Home/End", () => {
    const withDisabled = [
      listNode("a"),
      listNode("b", { disabled: true }),
      listNode("c"),
      listNode("d", { disabled: true }),
    ];
    expect(computeNextActive("list", withDisabled, "a", "down", freshNavMemory())).toBe("c");
    expect(computeNextActive("list", withDisabled, "c", "down", freshNavMemory())).toBe("a"); // wrap past disabled d
    expect(computeNextActive("list", withDisabled, "c", "up", freshNavMemory())).toBe("a");
    expect(computeNextActive("list", withDisabled, "a", "end", freshNavMemory())).toBe("c"); // d disabled
  });

  it("no active id → Down lands on first, Up lands on last", () => {
    expect(computeNextActive("list", nodes, null, "down", freshNavMemory())).toBe("a");
    expect(computeNextActive("list", nodes, null, "up", freshNavMemory())).toBe("c");
  });

  it("Left/Right are inert in a list", () => {
    expect(computeNextActive("list", nodes, "b", "left", freshNavMemory())).toBe("b");
    expect(computeNextActive("list", nodes, "b", "right", freshNavMemory())).toBe("b");
  });

  it("all-disabled list returns null", () => {
    const allDisabled = [listNode("a", { disabled: true }), listNode("b", { disabled: true })];
    expect(computeNextActive("list", allDisabled, null, "down", freshNavMemory())).toBeNull();
  });

  it("initialActiveId is the first enabled node", () => {
    expect(initialActiveId(nodes)).toBe("a");
    expect(initialActiveId([listNode("a", { disabled: true }), listNode("b")])).toBe("b");
    expect(initialActiveId([])).toBeNull();
  });
});

// ── horizontal-orientation list nav (opt-in, the color swatch row) ────────────

describe("list nav — horizontal orientation", () => {
  const nodes = [listNode("a"), listNode("b"), listNode("c")];

  it("Right/Left step (the swatch row's axis), wrapping", () => {
    expect(computeNextActive("list", nodes, "a", "right", freshNavMemory(), "horizontal")).toBe("b");
    expect(computeNextActive("list", nodes, "c", "right", freshNavMemory(), "horizontal")).toBe("a");
    expect(computeNextActive("list", nodes, "b", "left", freshNavMemory(), "horizontal")).toBe("a");
    expect(computeNextActive("list", nodes, "a", "left", freshNavMemory(), "horizontal")).toBe("c");
  });

  it("Up/Down are inert when horizontal (the off-axis keys)", () => {
    expect(computeNextActive("list", nodes, "b", "up", freshNavMemory(), "horizontal")).toBe("b");
    expect(computeNextActive("list", nodes, "b", "down", freshNavMemory(), "horizontal")).toBe("b");
  });

  it("no active id → Right lands on first, Left lands on last", () => {
    expect(computeNextActive("list", nodes, null, "right", freshNavMemory(), "horizontal")).toBe("a");
    expect(computeNextActive("list", nodes, null, "left", freshNavMemory(), "horizontal")).toBe("c");
  });

  it("Home/End still jump to first/last enabled regardless of orientation", () => {
    expect(computeNextActive("list", nodes, "b", "home", freshNavMemory(), "horizontal")).toBe("a");
    expect(computeNextActive("list", nodes, "b", "end", freshNavMemory(), "horizontal")).toBe("c");
  });

  it("skips disabled swatches on Right/Left", () => {
    const withDisabled = [
      listNode("a"),
      listNode("b", { disabled: true }),
      listNode("c"),
    ];
    expect(computeNextActive("list", withDisabled, "a", "right", freshNavMemory(), "horizontal")).toBe("c");
    expect(computeNextActive("list", withDisabled, "c", "left", freshNavMemory(), "horizontal")).toBe("a");
  });

  it("the default (omitted) orientation is still vertical — Up/Down step, Left/Right inert", () => {
    // Guards the 6 migrated vertical menus: omitting the arg keeps the old axis.
    expect(computeNextActive("list", nodes, "a", "down", freshNavMemory())).toBe("b");
    expect(computeNextActive("list", nodes, "a", "right", freshNavMemory())).toBe("a");
    // An explicit "vertical" matches the default exactly.
    expect(computeNextActive("list", nodes, "a", "down", freshNavMemory(), "vertical")).toBe("b");
    expect(computeNextActive("list", nodes, "a", "right", freshNavMemory(), "vertical")).toBe("a");
  });

  it("a combobox stays vertical even if a horizontal orientation is passed (it owns Left/Right)", () => {
    expect(computeNextActive("combobox", nodes, "a", "down", freshNavMemory(), "horizontal")).toBe("b");
    expect(computeNextActive("combobox", nodes, "a", "right", freshNavMemory(), "horizontal")).toBe("a");
  });
});

// ── grid nav (pure grid layout) ──────────────────────────────────────────────

describe("grid nav", () => {
  // 3x4 grid (rows 0..2, cols 0..3).
  const grid = [
    gridNode("g00", 0, 0), gridNode("g01", 0, 1), gridNode("g02", 0, 2), gridNode("g03", 0, 3),
    gridNode("g10", 1, 0), gridNode("g11", 1, 1), gridNode("g12", 1, 2), gridNode("g13", 1, 3),
    gridNode("g20", 2, 0), gridNode("g21", 2, 1), gridNode("g22", 2, 2), gridNode("g23", 2, 3),
  ];

  it("Right/Left move within a row, clamped at the ends (no wrap)", () => {
    expect(computeNextActive("grid", grid, "g00", "right", freshNavMemory())).toBe("g01");
    expect(computeNextActive("grid", grid, "g03", "right", freshNavMemory())).toBe("g03"); // clamp
    expect(computeNextActive("grid", grid, "g01", "left", freshNavMemory())).toBe("g00");
    expect(computeNextActive("grid", grid, "g00", "left", freshNavMemory())).toBe("g00"); // clamp
  });

  it("Down/Up move between rows by column", () => {
    expect(computeNextActive("grid", grid, "g01", "down", freshNavMemory())).toBe("g11");
    expect(computeNextActive("grid", grid, "g11", "down", freshNavMemory())).toBe("g21");
    expect(computeNextActive("grid", grid, "g21", "up", freshNavMemory())).toBe("g11");
  });

  it("Down off the last grid row is a no-op in a PURE grid (no list to enter)", () => {
    expect(computeNextActive("grid", grid, "g22", "down", freshNavMemory())).toBe("g22");
  });

  it("Right skips a disabled cell within the row", () => {
    const g = [gridNode("a", 0, 0), gridNode("b", 0, 1, { disabled: true }), gridNode("c", 0, 2)];
    expect(computeNextActive("grid", g, "a", "right", freshNavMemory())).toBe("c");
  });

  it("Down skips a disabled row, landing on the next enabled row at the column", () => {
    const g = [
      gridNode("a", 0, 1),
      gridNode("b", 1, 1, { disabled: true }),
      gridNode("c", 2, 1),
    ];
    expect(computeNextActive("grid", g, "a", "down", freshNavMemory())).toBe("c");
  });
});

// ── composite (grid above list) — the cross-region edge matrix (R3) ──────────

describe("composite grid→list seam", () => {
  // Grid: 2 rows × 3 cols (rows 0,1 / cols 0,1,2). List: 2 items.
  function makeComposite(over: Partial<Record<string, Partial<MenuNode>>> = {}): MenuNode[] {
    const g = (id: string, r: number, c: number) =>
      gridNode(id, r, c, over[id] ?? {});
    const l = (id: string) => listNode(id, over[id] ?? {});
    return [
      g("g00", 0, 0), g("g01", 0, 1), g("g02", 0, 2),
      g("g10", 1, 0), g("g11", 1, 1), g("g12", 1, 2),
      l("L0"), l("L1"),
    ];
  }

  it("Down off the last grid row enters the first enabled list item", () => {
    const nodes = makeComposite();
    expect(computeNextActive("composite", nodes, "g10", "down", freshNavMemory())).toBe("L0");
    expect(computeNextActive("composite", nodes, "g12", "down", freshNavMemory())).toBe("L0");
  });

  it("remembers lastGridCol and re-enters the grid at that column on Up off list[0]", () => {
    const nodes = makeComposite();
    const mem: NavMemory = freshNavMemory();
    // Leave the grid from column 2 (g12) → list.
    expect(computeNextActive("composite", nodes, "g12", "down", mem)).toBe("L0");
    expect(mem.lastGridCol).toBe(2);
    // Up off list[0] → grid {maxRow=1, col=2} = g12.
    expect(computeNextActive("composite", nodes, "L0", "up", mem)).toBe("g12");
  });

  it("re-enters at column 0 when the grid was left from column 0", () => {
    const nodes = makeComposite();
    const mem: NavMemory = freshNavMemory();
    expect(computeNextActive("composite", nodes, "g10", "down", mem)).toBe("L0");
    expect(mem.lastGridCol).toBe(0);
    expect(computeNextActive("composite", nodes, "L0", "up", mem)).toBe("g10");
  });

  it("list nav: Down within the list, clamped at the bottom (no wrap to grid)", () => {
    const nodes = makeComposite();
    expect(computeNextActive("composite", nodes, "L0", "down", freshNavMemory())).toBe("L1");
    expect(computeNextActive("composite", nodes, "L1", "down", freshNavMemory())).toBe("L1"); // clamp
  });

  it("Up within the list moves up between list items", () => {
    const nodes = makeComposite();
    expect(computeNextActive("composite", nodes, "L1", "up", freshNavMemory())).toBe("L0");
  });

  // ── disabled at the seam ──
  it("Down off the grid SKIPS a disabled first list item to the next enabled", () => {
    const nodes = makeComposite({ L0: { disabled: true } });
    expect(computeNextActive("composite", nodes, "g11", "down", freshNavMemory())).toBe("L1");
  });

  it("Up off list re-entry SKIPS a disabled bottom-row cell, walking up to an enabled one", () => {
    // Disable the whole bottom row at the remembered column → re-entry walks up.
    const nodes = makeComposite({ g10: { disabled: true }, g11: { disabled: true }, g12: { disabled: true } });
    const mem: NavMemory = freshNavMemory();
    mem.lastGridCol = 1;
    // Up off L0 → bottom row all disabled at col 1 → walk to row 0 col 1 = g01.
    expect(computeNextActive("composite", nodes, "L0", "up", mem)).toBe("g01");
  });

  // ── partial last row clamp (R3) ──
  it("partial last grid row: re-entry column clamps to the row's actual extent", () => {
    // Bottom row has only cols 0 and 1 (no col 2). Leaving from col 2 (g02 in
    // the FULL top row), then Down — but g02 has no row below, so Down off the
    // top-right with a partial bottom row should clamp to the nearest bottom
    // cell, NOT a phantom {row1,col2}.
    const nodes = [
      gridNode("g00", 0, 0), gridNode("g01", 0, 1), gridNode("g02", 0, 2),
      gridNode("g10", 1, 0), gridNode("g11", 1, 1), // partial: no g12
      listNode("L0"),
    ];
    // Down from g02 (col 2) → bottom row nearest col 2 = g11 (col 1, clamped).
    expect(computeNextActive("composite", nodes, "g02", "down", freshNavMemory())).toBe("g11");
  });

  it("partial last row: Up off list[0] with lastGridCol beyond the row clamps to the last cell", () => {
    const nodes = [
      gridNode("g00", 0, 0), gridNode("g01", 0, 1), gridNode("g02", 0, 2),
      gridNode("g10", 1, 0), gridNode("g11", 1, 1), // partial: no col 2
      listNode("L0"),
    ];
    const mem: NavMemory = freshNavMemory();
    mem.lastGridCol = 2; // remembered a column the bottom row doesn't have
    // Up off L0 → bottom row (maxRow=1) nearest col 2 = g11 (clamped to col 1).
    expect(computeNextActive("composite", nodes, "L0", "up", mem)).toBe("g11");
  });

  it("every grid corner can reach the list head and back (round-trip)", () => {
    const nodes = makeComposite();
    // From each bottom-row corner, Down → L0; Up off L0 → back to the SAME column.
    for (const [cell, col] of [["g10", 0], ["g12", 2]] as const) {
      const mem: NavMemory = freshNavMemory();
      expect(computeNextActive("composite", nodes, cell, "down", mem)).toBe("L0");
      expect(mem.lastGridCol).toBe(col);
      const back = computeNextActive("composite", nodes, "L0", "up", mem);
      expect(nodes.find((n) => n.id === back)?.coords?.col).toBe(col);
    }
  });

  it("Left/Right are inert while active is in the list region", () => {
    const nodes = makeComposite();
    expect(computeNextActive("composite", nodes, "L0", "left", freshNavMemory())).toBe("L0");
    expect(computeNextActive("composite", nodes, "L0", "right", freshNavMemory())).toBe("L0");
  });

  it("composite with an empty list: Down off the grid clamps (no enabled list target)", () => {
    const nodes = [
      gridNode("g00", 0, 0), gridNode("g01", 0, 1),
    ];
    expect(computeNextActive("composite", nodes, "g00", "down", freshNavMemory())).toBe("g00");
  });
});

// ── letter map ────────────────────────────────────────────────────────────

describe("buildLetterMap", () => {
  it("maps uppercased letters + aliases to ids, excluding disabled rows", () => {
    const nodes = [
      listNode("footnote", { letter: "F" }),
      listNode("delete", { letter: "⌫", letterAliases: ["Backspace", "Delete"] }),
      listNode("citation", { letter: "C", disabled: true }),
    ];
    const map = buildLetterMap(nodes);
    expect(map.get("F")).toBe("footnote");
    expect(map.get("BACKSPACE")).toBe("delete");
    expect(map.get("DELETE")).toBe("delete");
    expect(map.get("C")).toBeUndefined(); // disabled → inert
  });
});
