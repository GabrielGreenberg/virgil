import { beforeEach, describe, expect, it } from "vitest";
import {
  createCardStore,
  getCardStore,
  disposeCardStore,
  type AnchoredCardRef,
  type CardStore,
} from "../anchored-card-store";

/**
 * Regression guard for the A4 keystone invariant: card SELECTION and EXPANSION
 * are two INDEPENDENT axes (N1, the full 2×2). A future edit that re-welds the
 * axes (e.g. `select` also pushing into `expandedSet` — the exact pre-A4 bug)
 * would pass tsc and the rest of the suite silently. These tests fail loudly if
 * either axis-pure primitive ever touches the other axis.
 *
 * The store is now a per-doc INSTANCE (`createCardStore()`), so each test gets a
 * fresh isolated store — no manual cross-test reset needed.
 */

const a: AnchoredCardRef = { kind: "note", id: "a" };
const b: AnchoredCardRef = { kind: "footnote", id: "b" };
const c: AnchoredCardRef = { kind: "citation", id: "c" };

// A fresh, isolated store per test (replaces the old module-singleton reset).
let cardStore: CardStore;
beforeEach(() => {
  cardStore = createCardStore();
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

/**
 * The keystone guard for the PER-DOC scoping refactor: two stores are fully
 * isolated. Under multi-doc keep-alive each doc has its own instance, so a
 * gesture in doc B must NOT leak selection/expansion/hover into doc A. This is
 * the direct proof that the cross-doc bleed the refactor targets is killed —
 * including the two latent bugs the factory fixes (the `toggleExpanded`
 * self-call binding and the per-instance `lastSelected` snapshot cache).
 */
describe("anchored-card-store — per-doc isolation", () => {
  it("select / expand / hover on one store never touch another", () => {
    const docA = createCardStore();
    const docB = createCardStore();

    docA.select(a);
    docA.expand(b);
    docA.setHover(c);

    // docB is untouched by every axis.
    expect(docB.getState().selected).toBeNull();
    expect(docB.getState().expandedSet).toEqual([]);
    expect(docB.getState().hover).toBeNull();
    expect(docB.isSelected(a)).toBe(false);
    expect(docB.isExpanded(b)).toBe(false);

    // And the inverse: a gesture in docB doesn't disturb docA's state.
    docB.select(c);
    expect(docA.getState().selected).toEqual(a);
    expect(docB.getState().selected).toEqual(c);
  });

  it("toggleExpanded mutates only its own instance (self-call binding)", () => {
    // The pre-refactor bug: a module-singleton `toggleExpanded` self-call would
    // mutate the global, not the instance. Prove the toggle stays local.
    const docA = createCardStore();
    const docB = createCardStore();
    docA.toggleExpanded(a);
    expect(docA.isExpanded(a)).toBe(true);
    expect(docB.isExpanded(a)).toBe(false);
    docA.toggleExpanded(a);
    expect(docA.isExpanded(a)).toBe(false);
    expect(docB.getState().expandedSet).toEqual([]);
  });

  it("getCardStore is per-docId and stable; disposeCardStore resets a doc", () => {
    const s1 = getCardStore("doc-1");
    const s2 = getCardStore("doc-2");
    // Same docId → same instance (idempotent registry).
    expect(getCardStore("doc-1")).toBe(s1);
    expect(s1).not.toBe(s2);

    s1.select(a);
    expect(getCardStore("doc-1").getState().selected).toEqual(a);
    // doc-2 is untouched.
    expect(s2.getState().selected).toBeNull();

    // A true unmount drops the store; the next resolve is a fresh instance with
    // reset interaction state (cold re-open semantics).
    disposeCardStore("doc-1");
    const s1b = getCardStore("doc-1");
    expect(s1b).not.toBe(s1);
    expect(s1b.getState().selected).toBeNull();

    // Clean up the registry so these ids don't leak into other tests.
    disposeCardStore("doc-1");
    disposeCardStore("doc-2");
  });
});
