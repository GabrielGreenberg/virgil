// @vitest-environment jsdom
//
// Task 929 — the view-pref blobs are version-skew safe.
//
// A PWA routinely runs two builds at once: an old window stays open while a
// new one loads the update. Both write the same two blobs. Before this task an
// older build let every stored key into live prefs and `persist` split them by
// ITS scope table, rewriting each blob whole — so a global pref a newer build
// added was re-homed into the older window's WINDOW blob and erased from the
// global blob on its next gesture. Gone, for every window.
//
// Pinned here: closed-world on read, open-world on write; window-scoped
// registry keys coerced like global ones; `appliedPrefMigrations` merged as a
// set union on peer sync; and the scope table pinned, so a flip cannot ship
// without a declared migration.
import { describe, it, expect, afterEach, beforeAll, beforeEach, vi } from "vitest";

const WINDOW_ID = "skew-window";
vi.mock("@/lib/multi-window/window-id", () => ({ getWindowId: () => WINDOW_ID }));
vi.mock("@/lib/storage", () => ({ isDevStorage: false }));
vi.mock("@/lib/multi-window/bus", () => ({
  publish: () => {},
  subscribe: () => () => {},
}));

import { render, fireEvent, cleanup, act } from "@testing-library/react";
import { useViewPrefs, loadPrefs } from "../useViewPrefs";
import { PANEL_SIDE_MIGRATIONS } from "../panel-side-migrations";
import { STRUCTURAL_GLOBAL_PREF_KEYS } from "@/lib/view-prefs/structural-globals";
import { REGISTRY_GLOBAL_KEYS, VIEW_PREF_REGISTRY } from "@/lib/view-prefs/registry";

const GLOBAL_KEY = "virgil-view-prefs/global";
const WINDOW_KEY = `virgil-view-prefs/window/${WINDOW_ID}`;
const read = (k: string) => JSON.parse(localStorage.getItem(k) || "{}");
const write = (k: string, v: unknown) => localStorage.setItem(k, JSON.stringify(v));

function installStorageShim(name: "localStorage" | "sessionStorage") {
  const store = new Map<string, string>();
  Object.defineProperty(window, name, {
    configurable: true,
    value: {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
      key: (i: number) => [...store.keys()][i] ?? null,
      get length() {
        return store.size;
      },
    },
  });
}

function Probe() {
  const vp = useViewPrefs();
  return (
    <button
      data-testid="probe"
      data-migrations={vp.prefs.appliedPrefMigrations.join(",")}
      data-bib-filter={vp.prefs.bibFilter}
      onClick={() => vp.toggleViewPref("showCardTitles")}
    >
      probe
    </button>
  );
}

beforeAll(() => {
  installStorageShim("localStorage");
  installStorageShim("sessionStorage");
});
beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe("open-world on write: a key another build wrote survives this build's write", () => {
  it("an unknown GLOBAL key stays in the global blob, untouched, and never moves to the window blob", () => {
    write(GLOBAL_KEY, { showCardTitles: true, futureGlobalPref: { level: 3 } });
    const { getByTestId } = render(<Probe />);
    fireEvent.click(getByTestId("probe")); // toggles a KNOWN global pref → persist

    const g = read(GLOBAL_KEY);
    expect(g.showCardTitles).toBe(false); // the gesture landed
    expect(g.futureGlobalPref).toEqual({ level: 3 }); // the newer build's key survived
    expect("futureGlobalPref" in read(WINDOW_KEY)).toBe(false); // not re-homed
  });

  it("an unknown WINDOW key stays in the window blob", () => {
    write(WINDOW_KEY, { futureLayoutPref: "x" });
    write(GLOBAL_KEY, { showCardTitles: true });
    const { getByTestId } = render(<Probe />);
    fireEvent.click(getByTestId("probe"));

    expect(read(WINDOW_KEY).futureLayoutPref).toBe("x");
    expect("futureLayoutPref" in read(GLOBAL_KEY)).toBe(false);
  });

  it("closed-world on read: an unknown key never reaches live prefs", () => {
    write(GLOBAL_KEY, { futureGlobalPref: 1 });
    write(WINDOW_KEY, { futureLayoutPref: 2 });
    const live = loadPrefs() as unknown as Record<string, unknown>;
    expect("futureGlobalPref" in live).toBe(false);
    expect("futureLayoutPref" in live).toBe(false);
  });

  it("this build's OWN retired keys are still dropped, not carried", () => {
    write(WINDOW_KEY, { activeLeft: "notes", editorSplit: true });
    write(GLOBAL_KEY, { showCardTitles: true, omniCategories: { left: [], right: [] } });
    const { getByTestId } = render(<Probe />);
    fireEvent.click(getByTestId("probe"));

    const w = read(WINDOW_KEY);
    expect("activeLeft" in w).toBe(false);
    expect("editorSplit" in w).toBe(false);
    expect("omniCategories" in read(GLOBAL_KEY)).toBe(false);
  });
});

describe("every registry key is coerced, either scope", () => {
  it("an out-of-domain WINDOW-scoped enum loads as its registry default", () => {
    write(WINDOW_KEY, { bibFilter: "uncited" });
    expect(loadPrefs().bibFilter).toBe(VIEW_PREF_REGISTRY.bibFilter.default);
    write(WINDOW_KEY, { bibFilter: "all" });
    expect(loadPrefs().bibFilter).toBe("all");
  });

  it("a window key's own blob wins over a stale copy in the global blob", () => {
    write(WINDOW_KEY, { bibFilter: "all" });
    write(GLOBAL_KEY, { bibFilter: "cited" });
    expect(loadPrefs().bibFilter).toBe("all");
  });
});

describe("appliedPrefMigrations merges as a set union on peer sync", () => {
  it("an older peer's blob with fewer ids does not erase this window's", () => {
    expect(PANEL_SIDE_MIGRATIONS.length).toBeGreaterThan(0);
    // Empty profile → every side migration is recorded as applied.
    const { getByTestId } = render(<Probe />);
    const all = PANEL_SIDE_MIGRATIONS.map((m) => m.id).join(",");
    expect(getByTestId("probe").dataset.migrations).toBe(all);

    write(GLOBAL_KEY, { appliedPrefMigrations: [] });
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: GLOBAL_KEY }));
    });
    expect(getByTestId("probe").dataset.migrations).toBe(all);
  });
});

describe("scope is one pinned fact", () => {
  // Flipping a key's scope is a cross-BUILD hazard: during the overlap an
  // older window reads the key from the other blob. `loadPrefs` reads each key
  // from its own scope's blob first and only FALLS BACK to the other, so a
  // flip is adopted in either direction — but a flip must be a deliberate,
  // reviewed act. Changing this list without that review is the failure.
  const PINNED_GLOBAL_KEYS = [
    "appliedPrefMigrations", "autocorrectTypos", "cardOutlineChrome", "checkSpelling",
    "codePaneRatio", "dividerLevels", "dividerWidth", "editorBottomMargin",
    "editorLeftMargin", "editorRightMargin", "editorTopMargin", "hiddenHighlightTypes",
    "hiddenMarginaliaTypes", "omniDimResting", "omniHiddenCategories", "pageWidth",
    "placements", "printOptions", "showCardTitles", "showHeadingLabels",
    "showHighlights", "showLatexComments", "showMarginalia", "showParTitles",
  ];

  it("the global key set matches the pinned list (a scope flip needs review)", () => {
    const live = [...STRUCTURAL_GLOBAL_PREF_KEYS, ...REGISTRY_GLOBAL_KEYS].sort();
    // A NEW global key is fine (append it here); a key LEAVING this list, or a
    // window key joining it, is a scope flip — confirm the fallback read covers
    // it and that an older build's write will not strand the value.
    expect(live).toEqual(PINNED_GLOBAL_KEYS);
  });
});
