// @vitest-environment jsdom
//
// Task 677 — the peer-sync door runs the SAME normalization as the load door.
//
// There used to be two doors from stored bytes to live `ViewPrefs`, and only
// one of them repaired anything. `loadPrefs` ran the renames, the
// presentation-pod strip, the placement merge, the `printOptions` deep merge
// and the subtractive unknown-id scrub. `rereadGlobal` — which fires on a
// peer's bus event, on the native `storage` event, and on the same-window
// listener set — did `setPrefs(prev => ({ ...prev, ...JSON.parse(raw) }))`.
//
// Virgil is a PWA and mixed builds are ordinary: one window still holds the
// bundle from before an update and persists a global blob carrying a retired
// panel id. The new window merged it verbatim, and its next `persist`
// RE-PUBLISHED it as its own — precisely the round-trip (saved prefs →
// snapshot → promote-defaults → shipped defaults) the scrub exists to make
// impossible.
//
// These tests pin the repaired contract in both halves: the pure door
// (`normalizeGlobalSlice`) and the live React peer-sync path.
import { describe, it, expect, afterEach, beforeAll, beforeEach, vi } from "vitest";

const WINDOW_ID = "test-window";
vi.mock("@/lib/multi-window/window-id", () => ({ getWindowId: () => WINDOW_ID }));
// useViewPrefs transitively pulls `@/lib/storage` (see the
// vitest_extension_barrel_storage_mock gotcha).
vi.mock("@/lib/storage", () => ({ isDevStorage: false }));
// BroadcastChannel is absent in jsdom. The `storage`-event floor (task 599) is
// the path under test here anyway.
vi.mock("@/lib/multi-window/bus", () => ({
  publish: () => {},
  subscribe: () => () => {},
}));

import { StrictMode } from "react";
import { render, fireEvent, cleanup, act } from "@testing-library/react";
import { useViewPrefs, normalizeGlobalSlice } from "../useViewPrefs";

const GLOBAL_KEY = "virgil-view-prefs/global";
const persistedGlobal = () => JSON.parse(localStorage.getItem(GLOBAL_KEY) || "{}");

function installStorageShim(name: "localStorage" | "sessionStorage") {
  const store = new Map<string, string>();
  Object.defineProperty(window, name, {
    configurable: true,
    value: {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
    },
  });
}

/** Write a blob the way a PEER window would — straight to storage, then the
 *  native `storage` event this window hears (the writing window never does). */
function peerWritesGlobal(blob: unknown) {
  localStorage.setItem(GLOBAL_KEY, JSON.stringify(blob));
  act(() => {
    window.dispatchEvent(new StorageEvent("storage", { key: GLOBAL_KEY }));
  });
}

/** Renders the live prefs a peer can corrupt, plus a button that forces a
 *  `persist` so we can see what this window writes BACK to disk. */
function Probe() {
  const vp = useViewPrefs();
  return (
    <button
      data-testid="probe"
      data-divider-width={vp.prefs.dividerWidth}
      data-placements={vp.prefs.placements.map((p) => p.id).join(",")}
      data-hidden-marginalia={vp.prefs.hiddenMarginaliaTypes.join(",")}
      data-show-marginalia={String(vp.prefs.showMarginalia)}
      onClick={() => vp.toggleViewPref("showCardTitles")}
    >
      probe
    </button>
  );
}

describe("normalizeGlobalSlice — the pure door", () => {
  beforeAll(() => {
    installStorageShim("localStorage");
    installStorageShim("sessionStorage");
  });
  beforeEach(() => localStorage.clear());

  it("drops a retired panel id from placements", () => {
    const out = normalizeGlobalSlice({
      placements: [
        { id: "quotations", side: "left" },
        { id: "notes", side: "left" },
      ],
    });
    expect(out.placements.map((p) => p.id)).not.toContain("quotations");
    expect(out.placements.map((p) => p.id)).toContain("notes");
  });

  it("renames a retired panel id that HAS an heir rather than dropping it", () => {
    const out = normalizeGlobalSlice({ placements: [{ id: "suggestions", side: "right" }] });
    const ids = out.placements.map((p) => p.id);
    expect(ids).not.toContain("suggestions");
    expect(ids).toContain("revisions");
  });

  it("merges in placements for panels added since the blob was written", () => {
    const out = normalizeGlobalSlice({ placements: [{ id: "notes", side: "left" }] });
    expect(out.placements.length).toBeGreaterThan(1);
  });

  it("deep-merges printOptions so a newly-added key is not missing", () => {
    const out = normalizeGlobalSlice({ printOptions: { elements: {} } });
    expect(Object.keys(out.printOptions.elements).length).toBeGreaterThan(0);
    expect(Object.keys(out.printOptions.panels).length).toBeGreaterThan(0);
  });

  it("drops a print-panel key that is not a live print vocabulary member", () => {
    const out = normalizeGlobalSlice({
      printOptions: { panels: { quotations: true } },
    });
    expect(out.printOptions.panels).not.toHaveProperty("quotations");
  });

  // ── the registry as a VALIDATOR ──────────────────────────────────────
  it("falls an out-of-domain ENUM back to the registry default", () => {
    expect(normalizeGlobalSlice({ dividerWidth: "gigantic" }).dividerWidth).toBe("text");
    expect(normalizeGlobalSlice({ dividerWidth: "mid" }).dividerWidth).toBe("mid");
  });

  it("falls a non-boolean TOGGLE back to the registry default", () => {
    expect(normalizeGlobalSlice({ showMarginalia: "yes" }).showMarginalia).toBe(true);
    expect(normalizeGlobalSlice({ showMarginalia: false }).showMarginalia).toBe(false);
  });

  it("FILTERS a set rather than resetting it — one bad member must not cost the others", () => {
    const out = normalizeGlobalSlice({ hiddenMarginaliaTypes: ["todo", "bogus", "note"] });
    expect(out.hiddenMarginaliaTypes).toEqual(["todo", "note"]);
  });

  // The `members`-vs-`domain` split this task added: `members` is the MENU
  // vocabulary, and validating against it would silently delete live state.
  it("keeps a stored member the MENU does not render (`error`, `report`)", () => {
    expect(
      normalizeGlobalSlice({ hiddenMarginaliaTypes: ["error"] }).hiddenMarginaliaTypes,
    ).toEqual(["error"]);
    expect(
      normalizeGlobalSlice({ hiddenHighlightTypes: ["report"] }).hiddenHighlightTypes,
    ).toEqual(["report"]);
  });

  it("falls a wrongly-typed geometry key back to the shipped default", () => {
    const out = normalizeGlobalSlice({ pageWidth: "800" });
    expect(typeof out.pageWidth).toBe("number");
  });

  it("is TOTAL over the global vocabulary and malformed-safe", () => {
    for (const raw of [null, undefined, 42, "x", [] as unknown]) {
      const out = normalizeGlobalSlice(raw);
      expect(Array.isArray(out.placements)).toBe(true);
      expect(typeof out.dividerWidth).toBe("string");
      expect(typeof out.printOptions).toBe("object");
    }
  });

  it("is idempotent — normalizing its own output changes nothing", () => {
    const once = normalizeGlobalSlice({
      placements: [{ id: "quotations", side: "left" }, { id: "notes", side: "left" }],
      dividerWidth: "gigantic",
    });
    expect(normalizeGlobalSlice(once)).toEqual(once);
  });
});

describe("the peer-sync door runs the same repairs as the load door", () => {
  beforeAll(() => {
    installStorageShim("localStorage");
    installStorageShim("sessionStorage");
  });
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  afterEach(() => cleanup());

  it("a peer's retired id + bogus enum reach neither live state nor the next write", () => {
    // Seed a VALID global blob and mount on it.
    localStorage.setItem(
      GLOBAL_KEY,
      JSON.stringify({ placements: [{ id: "notes", side: "left" }], dividerWidth: "mid" }),
    );
    const { getByTestId } = render(
      <StrictMode>
        <Probe />
      </StrictMode>,
    );
    const btn = getByTestId("probe");
    expect(btn.dataset.dividerWidth).toBe("mid");
    expect(btn.dataset.placements).not.toContain("quotations");

    // An older still-open build (or any peer) persists a stale blob.
    peerWritesGlobal({
      placements: [
        { id: "quotations", side: "left" },
        { id: "notes", side: "left" },
      ],
      dividerWidth: "gigantic",
      hiddenMarginaliaTypes: ["todo", "bogus"],
      showMarginalia: "yes",
    });

    // Live state took NEITHER the retired id nor the out-of-domain value.
    expect(btn.dataset.placements).not.toContain("quotations");
    expect(btn.dataset.dividerWidth).toBe("text"); // registry default, not "gigantic"
    expect(btn.dataset.hiddenMarginalia).toBe("todo");
    expect(btn.dataset.showMarginalia).toBe("true");

    // ...and this window does not RE-PUBLISH them on its next write.
    fireEvent.click(btn);
    const written = persistedGlobal();
    expect(written.placements.map((p: { id: string }) => p.id)).not.toContain("quotations");
    expect(written.dividerWidth).toBe("text");
    expect(written.hiddenMarginaliaTypes).toEqual(["todo"]);
    expect(written.showMarginalia).toBe(true);
  });

  it("a peer's un-renamed panel id arrives as its heir, not as a dropped panel", () => {
    localStorage.setItem(
      GLOBAL_KEY,
      JSON.stringify({ placements: [{ id: "notes", side: "left" }] }),
    );
    const { getByTestId } = render(
      <StrictMode>
        <Probe />
      </StrictMode>,
    );
    const btn = getByTestId("probe");
    peerWritesGlobal({ placements: [{ id: "suggestions", side: "right" }] });
    expect(btn.dataset.placements).not.toContain("suggestions");
    expect(btn.dataset.placements).toContain("revisions");
  });

  it("a peer's localStorage.clear() still leaves live state alone", () => {
    localStorage.setItem(
      GLOBAL_KEY,
      JSON.stringify({ placements: [{ id: "notes", side: "left" }], dividerWidth: "mid" }),
    );
    const { getByTestId } = render(
      <StrictMode>
        <Probe />
      </StrictMode>,
    );
    const btn = getByTestId("probe");
    localStorage.removeItem(GLOBAL_KEY);
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: GLOBAL_KEY }));
    });
    // The `raw == null` early return is deliberate: the next persist restores
    // the blob rather than the window resetting to defaults.
    expect(btn.dataset.dividerWidth).toBe("mid");
  });
});
