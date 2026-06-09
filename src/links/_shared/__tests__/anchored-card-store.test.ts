import { beforeEach, describe, expect, it } from "vitest";
import { cardStore, type AnchoredCardRef } from "../anchored-card-store";

/**
 * Regression guard for the A4 keystone invariant: card SELECTION and EXPANSION
 * are two INDEPENDENT axes (N1, the full 2×2). The store is pure module-scope
 * logic, so a future edit that re-welds the axes (e.g. `select` also pushing
 * into `expandedSet` — the exact pre-A4 bug) would pass tsc and the rest of the
 * suite silently. These tests fail loudly if either axis-pure primitive ever
 * touches the other axis.
 */

const a: AnchoredCardRef = { kind: "note", id: "a" };
const b: AnchoredCardRef = { kind: "footnote", id: "b" };
const c: AnchoredCardRef = { kind: "citation", id: "c" };

// The store is a module singleton — reset both axes to empty before each test.
beforeEach(() => {
  cardStore.clearSelection();
  for (const ref of [...cardStore.getState().expandedSet]) cardStore.collapse(ref);
  cardStore.setHover(null);
});

describe("anchored-card-store — selection ⟂ expansion (A4 N1)", () => {
  it("select + expand of different refs are fully independent", () => {
    cardStore.select(a);
    cardStore.expand(b);
    expect(cardStore.getState().selected).toEqual(a);
    expect(cardStore.getState().expandedSet).toEqual([b]);
    expect(cardStore.isSelected(a)).toBe(true);
    expect(cardStore.isExpanded(b)).toBe(true);
    // The cross-axis predicates stay false — selecting `a` did NOT expand it,
    // expanding `b` did NOT select it.
    expect(cardStore.isExpanded(a)).toBe(false);
    expect(cardStore.isSelected(b)).toBe(false);
  });

  it("clearSelection leaves the expansion set intact", () => {
    cardStore.expand(a);
    cardStore.expand(b);
    cardStore.select(a);
    cardStore.clearSelection();
    expect(cardStore.getState().selected).toBeNull();
    expect(cardStore.getState().expandedSet).toEqual([a, b]);
  });

  it("collapse / toggleExpanded leave the selection slot intact", () => {
    cardStore.select(a);
    cardStore.expand(a);
    cardStore.collapse(a);
    expect(cardStore.isExpanded(a)).toBe(false);
    expect(cardStore.getState().selected).toEqual(a); // halo survives a collapse
    cardStore.toggleExpanded(a); // expand again
    expect(cardStore.isExpanded(a)).toBe(true);
    expect(cardStore.getState().selected).toEqual(a);
  });

  it("selection is at most one (select replaces)", () => {
    cardStore.select(a);
    cardStore.select(b);
    expect(cardStore.getState().selected).toEqual(b);
    expect(cardStore.isSelected(a)).toBe(false);
  });

  it("expansion is multi (expand accumulates, idempotent, no dupes)", () => {
    cardStore.expand(a);
    cardStore.expand(b);
    cardStore.expand(a); // idempotent — already present
    expect(cardStore.getState().expandedSet).toEqual([a, b]);
  });

  it("toggleExpanded flips membership without touching selection", () => {
    cardStore.select(c);
    expect(cardStore.isExpanded(a)).toBe(false);
    cardStore.toggleExpanded(a);
    expect(cardStore.isExpanded(a)).toBe(true);
    cardStore.toggleExpanded(a);
    expect(cardStore.isExpanded(a)).toBe(false);
    expect(cardStore.getState().selected).toEqual(c); // untouched throughout
  });

  it("setHover is its own axis (touches neither selection nor expansion)", () => {
    cardStore.select(a);
    cardStore.expand(b);
    cardStore.setHover(c);
    expect(cardStore.getState().hover).toEqual(c);
    expect(cardStore.getState().selected).toEqual(a);
    expect(cardStore.getState().expandedSet).toEqual([b]);
  });
});
