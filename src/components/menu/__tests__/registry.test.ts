// MenuRegistry: the React-backend registry that satisfies MenuRegistryHandle
// (design §2.2/§2.3). Tests the snapshot, version bumps (keystroke sanctity:
// re-snapshot only on a registration-version change), active-id navigation,
// activation, the registryFor() cross-backend lookup seam, and the contract
// shape both backends must satisfy (R2).

import { describe, it, expect, vi } from "vitest";
import {
  MenuRegistry,
  registryFor,
  publishRegistry,
  unpublishRegistry,
  type MenuItemRegistration,
} from "../registry";
import type { MenuRegistryHandle } from "../types";

function reg(over: Partial<MenuItemRegistration> = {}): MenuItemRegistration {
  return { id: "x", region: "list", disabled: false, run: () => {}, ...over };
}

describe("MenuRegistry — snapshot + versioning", () => {
  it("orders the snapshot by registration order", () => {
    const r = new MenuRegistry("m", "list");
    r.register(reg({ id: "a" }));
    r.register(reg({ id: "b" }));
    r.register(reg({ id: "c" }));
    expect(r.items().map((n) => n.id)).toEqual(["a", "b", "c"]);
  });

  it("stamps domId as `${menuId}-item-${id}`", () => {
    const r = new MenuRegistry("grab", "list");
    r.register(reg({ id: "footnote" }));
    expect(r.items()[0].domId).toBe("grab-item-footnote");
    expect(r.domIdFor("footnote")).toBe("grab-item-footnote");
  });

  it("bumps the version on register / unregister / disabled-flip, NOT on a ref set", () => {
    const r = new MenuRegistry("m", "list");
    r.register(reg({ id: "a" }));
    const v0 = r.getVersion();
    // ref set: NOT a nav-structural change → no bump.
    r.setRef("a", {} as HTMLElement);
    expect(r.getVersion()).toBe(v0);
    // re-register with the same fields → no bump.
    r.register(reg({ id: "a" }));
    expect(r.getVersion()).toBe(v0);
    // disabled flip → bump.
    r.register(reg({ id: "a", disabled: true }));
    expect(r.getVersion()).toBeGreaterThan(v0);
  });

  it("captures a ref set BEFORE register (the real commit order) — refFor returns the live el", () => {
    // The REAL React mount order: a ref callback fires at COMMIT, `register`
    // runs in a passive effect AFTER. So `setRef` lands before the record
    // exists. Pre-fix, `setRef`'s `if (rec)` gate dropped the element and the
    // ref stayed null forever (dead §3.5 scroll-into-view). This is the inverse
    // of the masking order above — it must now return the live element, and a
    // ref set must STILL not bump the version.
    const r = new MenuRegistry("m", "list");
    const el = {} as HTMLElement;
    r.setRef("a", el); // commit-phase: no record yet
    const v0 = r.getVersion();
    r.register(reg({ id: "a" })); // passive effect: record created after
    expect(r.refFor("a")).toBe(el);
    // register bumped (new item), but the ref itself never bumps:
    r.setRef("a", {} as HTMLElement);
    const v1 = r.getVersion();
    r.setRef("a", null);
    expect(r.getVersion()).toBe(v1);
    expect(r.refFor("a")).toBeNull();
  });

  it("refFor survives an unregister→register churn (disabled-flip re-register keeps no stale ref)", () => {
    const r = new MenuRegistry("m", "list");
    const el = {} as HTMLElement;
    r.register(reg({ id: "a" }));
    r.setRef("a", el);
    expect(r.refFor("a")).toBe(el);
    // A disabled-flip in useMenuItem unregisters then re-registers. The ref map
    // is independent of the record, so it is only cleared by an explicit
    // unregister (real unmount) — a bare re-register must NOT strand the ref.
    r.register(reg({ id: "a", disabled: true }));
    expect(r.refFor("a")).toBe(el);
    // A real unmount (unregister) DOES clear the ref map entry.
    r.unregister("a");
    expect(r.refFor("a")).toBeNull();
  });

  it("reuses the cached snapshot until the version changes", () => {
    const r = new MenuRegistry("m", "list");
    r.register(reg({ id: "a" }));
    const s1 = r.items();
    const s2 = r.items();
    expect(s1).toBe(s2); // same reference — not rebuilt
    r.register(reg({ id: "b" }));
    const s3 = r.items();
    expect(s3).not.toBe(s1); // rebuilt after the bump
  });

  it("notifies subscribers on a structural change", () => {
    const r = new MenuRegistry("m", "list");
    const fn = vi.fn();
    r.subscribe(fn);
    r.register(reg({ id: "a" }));
    expect(fn).toHaveBeenCalled();
  });
});

describe("MenuRegistry — active id + navigation + activation", () => {
  it("setActive ignores disabled / unknown / widget nodes", () => {
    const r = new MenuRegistry("m", "list");
    r.register(reg({ id: "a" }));
    r.register(reg({ id: "b", disabled: true }));
    r.register(reg({ id: "w", region: "widget" }));
    r.setActive("a");
    expect(r.activeId()).toBe("a");
    r.setActive("b"); // disabled → ignored
    expect(r.activeId()).toBe("a");
    r.setActive("w"); // widget → ignored
    expect(r.activeId()).toBe("a");
    r.setActive("nope"); // unknown → ignored
    expect(r.activeId()).toBe("a");
  });

  it("move() steps the active cursor via the layout nav", () => {
    const r = new MenuRegistry("m", "list");
    r.register(reg({ id: "a" }));
    r.register(reg({ id: "b" }));
    r.move("down"); // no active → first
    expect(r.activeId()).toBe("a");
    r.move("down");
    expect(r.activeId()).toBe("b");
    r.move("down"); // wrap
    expect(r.activeId()).toBe("a");
  });

  it("setOrientation('horizontal') flips a list to step on Left/Right (Up/Down inert)", () => {
    const r = new MenuRegistry("m", "list");
    r.register(reg({ id: "a" }));
    r.register(reg({ id: "b" }));
    r.setOrientation("horizontal");
    r.move("right"); // no active → first
    expect(r.activeId()).toBe("a");
    r.move("right");
    expect(r.activeId()).toBe("b");
    r.move("down"); // off-axis → inert
    expect(r.activeId()).toBe("b");
    r.move("left");
    expect(r.activeId()).toBe("a");
  });

  it("activate() runs the active node's handler; activateById runs a specific one", () => {
    const r = new MenuRegistry("m", "list");
    const runA = vi.fn();
    const runB = vi.fn();
    r.register(reg({ id: "a", run: runA }));
    r.register(reg({ id: "b", run: runB }));
    r.setActive("a");
    r.activate();
    expect(runA).toHaveBeenCalledTimes(1);
    r.activateById("b");
    expect(runB).toHaveBeenCalledTimes(1);
  });

  it("activate() is inert on a disabled node", () => {
    const r = new MenuRegistry("m", "list");
    const run = vi.fn();
    r.register(reg({ id: "a", disabled: true, run }));
    r.activateById("a");
    expect(run).not.toHaveBeenCalled();
  });

  it("unregistering the active node clears the active id", () => {
    const r = new MenuRegistry("m", "list");
    r.register(reg({ id: "a" }));
    r.setActive("a");
    r.unregister("a");
    expect(r.activeId()).toBeNull();
    expect(r.items()).toHaveLength(0);
  });
});

describe("MenuRegistry — setOrder (combobox re-rank: snapshot follows live VISUAL order)", () => {
  it("re-sorts items() to the published visual index without re-registering", () => {
    const r = new MenuRegistry("m", "combobox");
    ["a", "b", "c"].forEach((id) => r.register(reg({ id })));
    expect(r.items().map((n) => n.id)).toEqual(["a", "b", "c"]);
    // A fuzzy re-rank reorders the VISUAL rows to c, a, b. The rows are
    // key-stable, so they never re-register — they publish their live index.
    r.setOrder("c", 0);
    r.setOrder("a", 1);
    r.setOrder("b", 2);
    expect(r.items().map((n) => n.id)).toEqual(["c", "a", "b"]);
  });

  it("arrow nav follows visual order after a NON-CYCLIC re-rank (fails pre-fix)", () => {
    const r = new MenuRegistry("m", "combobox");
    ["a", "b", "c", "d", "e"].forEach((id) => r.register(reg({ id })));
    // Visual order becomes b, a, c, d, e — swapping the first two is a NON-cyclic
    // permutation, so insertion-order nav and visual-order nav DIVERGE (a cyclic
    // rotation would walk identically and hide the bug — the skip-bug only shows
    // under a non-cyclic permutation).
    const visual = ["b", "a", "c", "d", "e"];
    visual.forEach((id, i) => r.setOrder(id, i));
    expect(r.items().map((n) => n.id)).toEqual(visual);
    r.setActive("b"); // the visually-first row
    r.move("down");
    // Visual-next is "a". Pre-fix (snapshot sorted by insertion order
    // [a,b,c,d,e]) "b" sat at index 1, so down → "c" — the skip this fixes.
    expect(r.activeId()).toBe("a");
    r.move("down");
    expect(r.activeId()).toBe("c");
  });

  it("setOrder is idempotent (no bump on an unchanged order) and never clears active", () => {
    const r = new MenuRegistry("m", "combobox");
    r.register(reg({ id: "a" })); // insertion order 0
    r.register(reg({ id: "b" }));
    r.setActive("a");
    const v0 = r.getVersion();
    r.setOrder("a", 0); // unchanged → no bump
    expect(r.getVersion()).toBe(v0);
    r.setOrder("a", 5); // changed → bump, but active survives (unlike unregister)
    expect(r.getVersion()).toBeGreaterThan(v0);
    expect(r.activeId()).toBe("a");
  });
});

describe("registryFor — the cross-backend lookup seam (§2.3)", () => {
  it("publish / lookup / unpublish round-trips", () => {
    const r = new MenuRegistry("seam-test", "list");
    expect(registryFor("seam-test")).toBeNull();
    publishRegistry("seam-test", r);
    expect(registryFor("seam-test")).toBe(r);
    unpublishRegistry("seam-test", r);
    expect(registryFor("seam-test")).toBeNull();
  });

  it("unpublish only clears when the published handle still matches (remount race)", () => {
    const r1 = new MenuRegistry("race", "list");
    const r2 = new MenuRegistry("race", "list");
    publishRegistry("race", r1);
    publishRegistry("race", r2); // r2 claims the id
    unpublishRegistry("race", r1); // stale unpublish — must NOT clear r2
    expect(registryFor("race")).toBe(r2);
    unpublishRegistry("race", r2);
    expect(registryFor("race")).toBeNull();
  });

  it("the MenuRegistry satisfies the MenuRegistryHandle contract (R2)", () => {
    // A compile-time + runtime assertion that the React backend implements the
    // same contract the PM-slash backend (Phase C) must satisfy.
    const handle: MenuRegistryHandle = new MenuRegistry("contract", "list");
    expect(typeof handle.items).toBe("function");
    expect(typeof handle.move).toBe("function");
    expect(typeof handle.setActive).toBe("function");
    expect(typeof handle.activeId).toBe("function");
    expect(typeof handle.activate).toBe("function");
  });
});
