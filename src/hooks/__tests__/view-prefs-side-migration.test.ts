// @vitest-environment jsdom
//
// Task 381, the END-TO-END half — the REAL `loadPrefs` pipeline over a REAL
// stored blob.
//
// `card-side-derivation.test.ts` proves the derivation and the migration
// applier are correct. This suite proves the two things a test of either alone
// structurally CANNOT, because neither was ever the part that could misbehave:
//
//  1. the LOADER actually applies the side migration — and applies it BEFORE
//     the default merge, which is the whole reason a migration is needed at
//     all (the merge supplies defaults only for placement ids the blob is
//     MISSING, so a shipped `defaultStripSide` flip reaches nobody who has
//     ever opened the app); and
//  2. the loader folds a pre-381 per-side `omniCategories` blob to the
//     side-free hidden set exactly ONCE, and DELETES the legacy key so it can
//     never round-trip back and re-fold over a later hide/show.
//
// Defect legs: every `expect` marked "(defect leg)" fails on the pre-381
// loader, which merged defaults only for missing ids and read `omniCategories`
// as a live carrier.
import { describe, it, expect, beforeEach, vi } from "vitest";

const WINDOW_ID = "test-window";
vi.mock("@/lib/multi-window/window-id", () => ({ getWindowId: () => WINDOW_ID }));
vi.mock("@/lib/storage", () => ({ isDevStorage: false }));

import { loadPrefs } from "../useViewPrefs";
import { PANEL_SIDE_MIGRATIONS } from "../panel-side-migrations";

const GLOBAL_KEY = "virgil-view-prefs/global";
const REPORTS_MIGRATION = "2026-08-19-reports-right";

function writeGlobal(blob: Record<string, unknown>) {
  localStorage.setItem(GLOBAL_KEY, JSON.stringify(blob));
}
const sideOf = (p: ReturnType<typeof loadPrefs>, id: string) =>
  p.placements.find((x) => x.id === id)?.side;

beforeEach(() => localStorage.clear());

describe("loadPrefs — the reports side migration", () => {
  it("moves a STORED left placement to right (defect leg)", () => {
    // The pre-381 loader kept this `left` forever: the defaults merge below it
    // only supplies ids the blob is missing, and `reports` is present.
    writeGlobal({ placements: [{ id: "reports", side: "left" }] });
    const p = loadPrefs();
    expect(sideOf(p, "reports")).toBe("right");
    expect(p.appliedPrefMigrations).toContain(REPORTS_MIGRATION);
  });

  it("a deliberate drag back to left survives the NEXT load", () => {
    writeGlobal({ placements: [{ id: "reports", side: "left" }] });
    const first = loadPrefs();
    expect(sideOf(first, "reports")).toBe("right");
    // The user drags it back; the app persists placements + the marker.
    writeGlobal({
      placements: [{ id: "reports", side: "left" }],
      appliedPrefMigrations: first.appliedPrefMigrations,
    });
    expect(sideOf(loadPrefs(), "reports")).toBe("left");
  });

  it("a fresh profile gets the shipped default with no migration to run", () => {
    const p = loadPrefs();
    expect(sideOf(p, "reports")).toBe("right");
  });

  it("a blob with no reports placement at all takes the merged default", () => {
    writeGlobal({ placements: [{ id: "notes", side: "right" }] });
    const p = loadPrefs();
    expect(sideOf(p, "reports")).toBe("right");
    // Recorded anyway: the migration had its one chance, and the stored value
    // it would have changed did not exist.
    expect(p.appliedPrefMigrations).toContain(REPORTS_MIGRATION);
  });

  it("the marker is GLOBAL, so a peer window cannot re-apply the flip", () => {
    // `placements` is global; a per-window marker would let each window
    // re-run the flip over a deliberate drag.
    writeGlobal({ placements: [{ id: "reports", side: "left" }] });
    loadPrefs();
    // Simulate the persist: the loader's value lands in the GLOBAL slice.
    writeGlobal({
      placements: [{ id: "reports", side: "left" }],
      appliedPrefMigrations: [REPORTS_MIGRATION],
    });
    // A different window reads the same global blob.
    expect(sideOf(loadPrefs(), "reports")).toBe("left");
  });

  it("a FRESH profile's own first drag sticks", () => {
    // No stored state ⇒ nothing to migrate ⇒ every migration is recorded as
    // applied. Without that the newest user is the one the "a deliberate drag
    // sticks" rule fails for: they drag reports left on day one, and the next
    // reload finds an empty marker list and moves it back.
    const fresh = loadPrefs();
    expect(fresh.appliedPrefMigrations).toContain(REPORTS_MIGRATION);
    writeGlobal({
      placements: [{ id: "reports", side: "left" }],
      appliedPrefMigrations: fresh.appliedPrefMigrations,
    });
    expect(sideOf(loadPrefs(), "reports")).toBe("left");
  });

  it("every shipped migration is recorded on the first load", () => {
    const p = loadPrefs();
    for (const m of PANEL_SIDE_MIGRATIONS) {
      expect(p.appliedPrefMigrations).toContain(m.id);
    }
  });
});

describe("loadPrefs — omniCategories folds to omniHiddenCategories", () => {
  it("folds a pre-381 per-side blob (defect leg)", () => {
    writeGlobal({
      omniCategories: { left: ["footnotes"], right: ["notes"] },
    });
    const p = loadPrefs();
    expect(p.omniHiddenCategories).not.toContain("footnotes");
    expect(p.omniHiddenCategories).not.toContain("notes");
    expect(p.omniHiddenCategories).toContain("reports");
    // The legacy key must not survive onto the live prefs object: `loadPrefs`
    // returns `{...DEFAULT_PREFS, ...parsed}`, so an un-deleted key would
    // re-serialize on every write and be re-folded on every load — over a
    // hide/show the user made in between.
    expect("omniCategories" in (p as unknown as Record<string, unknown>)).toBe(false);
  });

  it("prefers the new key when both are present", () => {
    writeGlobal({
      omniCategories: { left: [], right: [] },
      omniHiddenCategories: ["todo"],
    });
    expect(loadPrefs().omniHiddenCategories).toEqual(["todo"]);
  });

  it("a fresh profile hides nothing", () => {
    expect(loadPrefs().omniHiddenCategories).toEqual([]);
  });

  it("drops a retired panel id from the hidden set", () => {
    writeGlobal({ omniHiddenCategories: ["todo", "quotations"] });
    expect(loadPrefs().omniHiddenCategories).toEqual(["todo"]);
  });
});
