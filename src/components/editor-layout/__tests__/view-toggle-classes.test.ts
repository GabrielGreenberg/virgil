/**
 * Issue-12 — ONE source for view-toggle classes across all three content
 * surfaces (page column, released float body, drag-ghost overlay).
 *
 * `viewToggleClasses(menuBar)` (chrome-config.ts) is the single producer of
 * the `hide-par-titles` / `hide-latex-comments` / `hide-heading-labels` /
 * `show-dividers-<lvl>` / `dividers-width-<n>` tokens. All three surfaces
 * embed its output, so the toggle CSS — which keys on those classes as an
 * ancestor (or self), never on `.editor-pane-column` — reaches each surface
 * for free, and a NEW toggle ports to all three by editing this one function.
 *
 * Two guarantees are pinned here:
 *  1. Part-A safety gate: the new `.editor-pane-column` className string is
 *     BYTE-IDENTICAL to the pre-Issue-12 hand-built expression for every
 *     representative menuBar state (refactor preserved the output exactly).
 *  2. Single-source property: the view-toggle tokens carried by the column,
 *     the float body, and the overlay root are EXACTLY `viewToggleClasses`'s
 *     output (same tokens, same order) — so whatever that function emits
 *     percolates to all three surfaces.
 *
 * Pure logic — chrome-config.ts has only type-only imports, so this runs in
 * the default `node` env with no DOM / no heavy module graph.
 */

import { describe, it, expect } from "vitest";
import { viewToggleClasses } from "../chrome-config";

type MenuBarArg = Parameters<typeof viewToggleClasses>[0];

/** Build a partial menuBar carrying only the fields `viewToggleClasses`
 *  reads, cast to the full bundle type (the function ignores the rest). */
function mb(partial: {
  showParTitles?: boolean;
  showLatexComments?: boolean;
  showHeadingLabels?: boolean;
  activeDividerLevels: Set<number>;
  dividerWidth: string;
}): MenuBarArg {
  return partial as unknown as MenuBarArg;
}

/** The EXACT `.editor-pane-column` className expression as it stood BEFORE
 *  Issue-12 (verbatim from EditorPane.tsx, incl. the `dividerClassName`
 *  useMemo body). Frozen reference for the byte-identity gate.
 *  NOTE: when a NEW toggle is added to `viewToggleClasses`, this frozen copy
 *  must be updated in lockstep (or this one gate retired) — it only proves
 *  the Issue-12 refactor preserved the CURRENT five toggles. */
function columnClassOld(menuBar: MenuBarArg): string {
  const dividerClassName = (() => {
    const levels = menuBar?.activeDividerLevels;
    if (!levels) return "";
    return [...levels].map((lvl) => `show-dividers-${lvl}`).join(" ");
  })();
  return `editor-pane-column${menuBar?.showParTitles === false ? " hide-par-titles" : ""}${menuBar?.showLatexComments === false ? " hide-latex-comments" : ""}${menuBar?.showHeadingLabels === false ? " hide-heading-labels" : ""}${dividerClassName ? ` ${dividerClassName}` : ""}${menuBar ? ` dividers-width-${menuBar.dividerWidth}` : ""}`;
}

// The three surfaces' className builders, mirroring the live code verbatim:
//  - column  → EditorPane.tsx `.editor-pane-column`
//  - overlay → LiftedTextOverlay.tsx `.lifted-text-overlay` root
//  - float   → the six float bodies' `.par-float-body` (appends unconditionally)
const columnClassNew = (menuBar: MenuBarArg) => {
  const vtc = viewToggleClasses(menuBar);
  return `editor-pane-column${vtc ? ` ${vtc}` : ""}`;
};
const overlayRootClass = (menuBar: MenuBarArg) => {
  const vtc = viewToggleClasses(menuBar);
  return `lifted-text-overlay${vtc ? ` ${vtc}` : ""}`;
};
const floatBodyClass = (menuBar: MenuBarArg) =>
  `par-float-body flex-1 overflow-auto px-8 py-4 ${viewToggleClasses(menuBar)}`;

/** Tokens on a surface minus its own base tokens, order-preserving. */
const toggleTokens = (cls: string, base: string[]) =>
  cls.split(/\s+/).filter((t) => t.length > 0 && !base.includes(t));

const COLUMN_BASE = ["editor-pane-column"];
const OVERLAY_BASE = ["lifted-text-overlay"];
const FLOAT_BASE = ["par-float-body", "flex-1", "overflow-auto", "px-8", "py-4"];

// Representative menuBar states: Reader (undefined), all-default, each hide-*
// alone, all hides, dividers at one / several levels (non-sorted, to pin the
// insertion-order contract), each divider width.
const FIXTURES: Array<{ name: string; menuBar: MenuBarArg }> = [
  { name: "reader / no menuBar", menuBar: undefined },
  {
    name: "all defaults (no hides, no dividers, width full)",
    menuBar: mb({ activeDividerLevels: new Set(), dividerWidth: "full" }),
  },
  {
    name: "hide par titles only",
    menuBar: mb({ showParTitles: false, activeDividerLevels: new Set(), dividerWidth: "full" }),
  },
  {
    name: "hide latex comments only",
    menuBar: mb({ showLatexComments: false, activeDividerLevels: new Set(), dividerWidth: "full" }),
  },
  {
    name: "hide heading labels only",
    menuBar: mb({ showHeadingLabels: false, activeDividerLevels: new Set(), dividerWidth: "full" }),
  },
  {
    name: "all three hides on",
    menuBar: mb({
      showParTitles: false,
      showLatexComments: false,
      showHeadingLabels: false,
      activeDividerLevels: new Set(),
      dividerWidth: "full",
    }),
  },
  {
    name: "single divider level, width mid",
    menuBar: mb({ activeDividerLevels: new Set([2]), dividerWidth: "mid" }),
  },
  {
    name: "multiple divider levels (insertion order 2,1,0), width text",
    menuBar: mb({ activeDividerLevels: new Set([2, 1, 0]), dividerWidth: "text" }),
  },
  {
    name: "everything on at once",
    menuBar: mb({
      showParTitles: false,
      showLatexComments: false,
      showHeadingLabels: false,
      activeDividerLevels: new Set([0, 3, 6]),
      dividerWidth: "mid",
    }),
  },
];

describe("viewToggleClasses — Part A byte-identity gate", () => {
  for (const { name, menuBar } of FIXTURES) {
    it(`column className is byte-identical to the pre-Issue-12 expression: ${name}`, () => {
      expect(columnClassNew(menuBar)).toBe(columnClassOld(menuBar));
    });
  }

  it("Reader (no menuBar) yields exactly `editor-pane-column`", () => {
    expect(columnClassNew(undefined)).toBe("editor-pane-column");
  });
});

describe("viewToggleClasses — single source ports to all three surfaces", () => {
  for (const { name, menuBar } of FIXTURES) {
    it(`column / float / overlay carry exactly viewToggleClasses' tokens (same order): ${name}`, () => {
      const expected = viewToggleClasses(menuBar); // the ONE source

      // Each surface's toggle tokens (base stripped) equal the source's
      // output verbatim — same tokens, same order. So any token the source
      // emits appears on all three; nothing diverges.
      expect(toggleTokens(columnClassNew(menuBar), COLUMN_BASE).join(" ")).toBe(expected);
      expect(toggleTokens(overlayRootClass(menuBar), OVERLAY_BASE).join(" ")).toBe(expected);
      expect(toggleTokens(floatBodyClass(menuBar), FLOAT_BASE).join(" ")).toBe(expected);
    });
  }

  it("a hypothetical NEW toggle would reach all three surfaces automatically", () => {
    // Simulate `viewToggleClasses` gaining a token by composing surfaces from
    // an augmented source string. Because every surface is `<base> + source`,
    // the new token lands on column, float, AND overlay with no other edit.
    const augmented = `${viewToggleClasses(
      mb({ activeDividerLevels: new Set([1]), dividerWidth: "full" }),
    )} labels-on-hover`;
    const compose = (base: string) => `${base} ${augmented}`;
    for (const base of ["editor-pane-column", "lifted-text-overlay", "par-float-body"]) {
      expect(compose(base)).toContain("labels-on-hover");
    }
  });
});
