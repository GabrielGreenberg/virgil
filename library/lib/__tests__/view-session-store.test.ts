// @vitest-environment jsdom
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  VIEW_SESSION_KEY,
  __resetViewSessionForTests,
  flushNow,
  getSession,
  setCitedOnly,
  setLeftPinnedActiveId,
  setListQuery,
  setListScroll,
  setListScrollQuiet,
  setLayout,
  setListSort,
  setListViewMode,
  resetPaperViewModeOnOpen,
  migrateLegacyLayoutSizes,
  setPanelTabs,
  setProjectHidden,
  setProjectPinned,
  setSelection,
  subscribe,
  togglePaperPin,
} from "../view-session-store";

// Legacy keys the Tier-A seed reads from.
const PAPER_PINNED_KEY = "virgil-library-paper-pinned";
const PROJECT_HIDDEN_KEY = "virgil-library-project-hidden";
const PROJECT_PINNED_KEY = "virgil-library-project-pinned";
const CITED_ONLY_KEY = "virgil-library-project-cited-only";
const COL_WIDTHS_KEY = "virgil-library-col-widths";
const COL_SORT_KEY = "virgil-library-col-sort";
const NAV_WIDTH_KEY = "virgil-library-nav-width";
const MIDDLE_WIDTH_KEY = "virgil-library-left-width";
const PAPERS_HEIGHT_KEY = "virgil-library-papers-height";

// The project's jsdom env doesn't ship a full localStorage; install a
// minimal in-memory shim (mirrors src/lib/identity/__tests__/identity-flag).
const memStore = new Map<string, string>();
const setItemSpy = vi.fn((k: string, v: string) => void memStore.set(k, v));
beforeAll(() => {
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => (memStore.has(k) ? memStore.get(k)! : null),
      setItem: setItemSpy,
      removeItem: (k: string) => void memStore.delete(k),
      clear: () => memStore.clear(),
    },
  });
});

beforeEach(() => {
  memStore.clear();
  setItemSpy.mockClear();
  __resetViewSessionForTests();
  vi.useRealTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("view-session-store — round-trip", () => {
  it("writes and reads back selection / sort / scroll / query / tabs", () => {
    setSelection("", "left", { selectedKeys: ["a", "b"], anchorKey: "a" });
    setListSort("", "left", "central", { col: "author", dir: "asc" });
    setListScroll("", "left", "central", 420);
    setListQuery("", "left", "central", "kant");
    setPanelTabs("", "left", { openIds: ["central"], activeId: "central" });
    flushNow();

    const s = getSession();
    expect(s.scopes[""].left.selectedKeys).toEqual(["a", "b"]);
    expect(s.scopes[""].left.anchorKey).toBe("a");
    expect(s.scopes[""].left.lists["central"].sort).toEqual({
      col: "author",
      dir: "asc",
    });
    expect(s.scopes[""].left.lists["central"].scrollTop).toBe(420);
    expect(s.scopes[""].left.lists["central"].query).toBe("kant");
    expect(s.scopes[""].left.tabs).toEqual({
      openIds: ["central"],
      activeId: "central",
    });
  });

  it("reconstructs the identical session from localStorage after a simulated reload", () => {
    setSelection("", "right", { selectedKeys: ["x"], anchorKey: "x" });
    setListQuery("outer:lib-1", "left", "paper:foo", "needle");
    flushNow();

    // Simulate reload: drop the in-memory singleton; next getSession()
    // re-reads the SAME localStorage key.
    __resetViewSessionForTests();
    const reloaded = getSession();
    expect(reloaded.scopes[""].right.selectedKeys).toEqual(["x"]);
    expect(reloaded.scopes["outer:lib-1"].left.lists["paper:foo"].query).toBe(
      "needle",
    );
  });
});

describe("view-session-store — versioning / migration", () => {
  it("(a) absent blob → Tier-A seed pulls legacy keys in and leaves them intact", () => {
    localStorage.setItem(PAPER_PINNED_KEY, JSON.stringify(["paper:p1"]));
    localStorage.setItem(PROJECT_HIDDEN_KEY, JSON.stringify(["project:doc:d1"]));
    localStorage.setItem(PROJECT_PINNED_KEY, JSON.stringify(["project:doc:d2"]));
    localStorage.setItem(CITED_ONLY_KEY, "1");
    localStorage.setItem(COL_WIDTHS_KEY, JSON.stringify({ year: 80 }));
    localStorage.setItem(COL_SORT_KEY, JSON.stringify({ col: "title", dir: "asc" }));
    localStorage.setItem(NAV_WIDTH_KEY, "210");
    localStorage.setItem(MIDDLE_WIDTH_KEY, "330");
    localStorage.setItem(PAPERS_HEIGHT_KEY, "144");

    const s = getSession();
    expect(s.paperPinned).toEqual(["paper:p1"]);
    expect(s.projectHidden).toEqual(["project:doc:d1"]);
    expect(s.projectPinned).toEqual(["project:doc:d2"]);
    expect(s.citedOnly).toBe(true);
    expect(s.layout.colWidths?.year).toBe(80);
    // Column/pod SIZES are deliberately NOT part of the Tier-A seed anymore —
    // they're adopted (freshest-wins, then key-deleted) one-shot by
    // migrateLegacyLayoutSizes(), so the seed leaves the size fields unset and
    // the size keys untouched (the migration owns them).
    expect(s.layout.navWidth).toBeUndefined();
    expect(s.layout.middleWidth).toBeUndefined();
    expect(s.layout.papersHeight).toBeUndefined();
    // col-sort seeds ONLY the singleton central list's default sort.
    expect(s.scopes[""].left.lists["central"].sort).toEqual({
      col: "title",
      dir: "asc",
    });

    // Legacy keys are NOT deleted by the seed — including the size keys, which
    // the seed now leaves entirely for migrateLegacyLayoutSizes() to consume.
    expect(localStorage.getItem(PAPER_PINNED_KEY)).not.toBeNull();
    expect(localStorage.getItem(CITED_ONLY_KEY)).toBe("1");
    expect(localStorage.getItem(COL_SORT_KEY)).not.toBeNull();
    expect(localStorage.getItem(NAV_WIDTH_KEY)).toBe("210");
    expect(localStorage.getItem(MIDDLE_WIDTH_KEY)).toBe("330");
    expect(localStorage.getItem(PAPERS_HEIGHT_KEY)).toBe("144");
  });

  it("(b) schemaVersion missing or !==1 → empty session, no throw, no seed", () => {
    localStorage.setItem(
      VIEW_SESSION_KEY,
      JSON.stringify({ scopes: { "": { left: {}, right: {} } } }),
    );
    expect(() => getSession()).not.toThrow();
    const s = getSession();
    expect(s.schemaVersion).toBe(1);
    expect(s.scopes).toEqual({});
    expect(s.citedOnly).toBe(false);
  });

  it("(c) corrupt JSON → empty session, no throw", () => {
    localStorage.setItem(VIEW_SESSION_KEY, "{not valid json");
    expect(() => getSession()).not.toThrow();
    expect(getSession().scopes).toEqual({});
  });

  it("(d) future schemaVersion=2 read by v1 code → empty-session fallback (does NOT throw or wipe legacy)", () => {
    localStorage.setItem(PAPER_PINNED_KEY, JSON.stringify(["paper:keep"]));
    localStorage.setItem(
      VIEW_SESSION_KEY,
      JSON.stringify({ schemaVersion: 2, scopes: {}, citedOnly: true }),
    );
    const s = getSession();
    expect(s.schemaVersion).toBe(1);
    expect(s.citedOnly).toBe(false); // not read from the v2 blob
    // The v2 blob exists, so the seed does NOT run — legacy key untouched.
    expect(localStorage.getItem(PAPER_PINNED_KEY)).not.toBeNull();
  });

  it("non-object root (array) → empty session", () => {
    localStorage.setItem(VIEW_SESSION_KEY, JSON.stringify([1, 2, 3]));
    expect(getSession().scopes).toEqual({});
  });
});

describe("view-session-store — colOrder normalization (F#13)", () => {
  it("a valid full order round-trips unchanged", () => {
    localStorage.setItem(
      VIEW_SESSION_KEY,
      JSON.stringify({
        schemaVersion: 1,
        scopes: {},
        paperPinned: [],
        projectHidden: [],
        projectPinned: [],
        citedOnly: false,
        layout: { colOrder: ["title", "year", "author", "status", "citekey"] },
      }),
    );
    expect(getSession().layout.colOrder).toEqual([
      "title",
      "year",
      "author",
      "status",
      "citekey",
    ]);
  });

  it("drops unknown ids, dedupes, and appends the missing columns", () => {
    localStorage.setItem(
      VIEW_SESSION_KEY,
      JSON.stringify({
        schemaVersion: 1,
        scopes: {},
        paperPinned: [],
        projectHidden: [],
        projectPinned: [],
        citedOnly: false,
        // duplicate "status", an unknown "bibimp", and only 2 distinct knowns.
        layout: { colOrder: ["status", "bibimp", "status", "year"] },
      }),
    );
    // First-occurrence-wins for the knowns, unknown dropped, missing appended
    // in default order (author, title, citekey).
    expect(getSession().layout.colOrder).toEqual([
      "status",
      "year",
      "author",
      "title",
      "citekey",
    ]);
  });

  it("an absent colOrder stays undefined (consumer falls back to the default)", () => {
    localStorage.setItem(
      VIEW_SESSION_KEY,
      JSON.stringify({
        schemaVersion: 1,
        scopes: {},
        paperPinned: [],
        projectHidden: [],
        projectPinned: [],
        citedOnly: false,
        layout: { colWidths: { year: 80 } },
      }),
    );
    const layout = getSession().layout;
    expect(layout.colOrder).toBeUndefined();
    // sibling layout fields survive the normalize.
    expect(layout.colWidths?.year).toBe(80);
  });

  it("a non-array colOrder is treated as absent", () => {
    localStorage.setItem(
      VIEW_SESSION_KEY,
      JSON.stringify({
        schemaVersion: 1,
        scopes: {},
        paperPinned: [],
        projectHidden: [],
        projectPinned: [],
        citedOnly: false,
        layout: { colOrder: "year,author" },
      }),
    );
    expect(getSession().layout.colOrder).toBeUndefined();
  });

  it("setLayout({ colOrder }) persists the global order", () => {
    setLayout({ colOrder: ["citekey", "title", "year", "author", "status"] });
    flushNow();
    const raw = JSON.parse(localStorage.getItem(VIEW_SESSION_KEY) as string);
    expect(raw.layout.colOrder).toEqual([
      "citekey",
      "title",
      "year",
      "author",
      "status",
    ]);
  });
});

describe("view-session-store — pdfDropIntroDismissed slice (task 089)", () => {
  it("defaults to absent (notice shows) and setLayout persists the opt-out", () => {
    // Absent by default → the consumer treats it as "not dismissed".
    expect(getSession().layout.pdfDropIntroDismissed).toBeUndefined();

    setLayout({ pdfDropIntroDismissed: true });
    flushNow();
    const raw = JSON.parse(localStorage.getItem(VIEW_SESSION_KEY) as string);
    expect(raw.layout.pdfDropIntroDismissed).toBe(true);
  });

  it("survives a simulated reload (persisted across the singleton drop)", () => {
    setLayout({ pdfDropIntroDismissed: true });
    flushNow();
    __resetViewSessionForTests();
    expect(getSession().layout.pdfDropIntroDismissed).toBe(true);
  });
});

describe("view-session-store — idempotent seed", () => {
  it("running getSession() twice does not overwrite the blob or delete legacy keys", () => {
    localStorage.setItem(PAPER_PINNED_KEY, JSON.stringify(["paper:p1"]));
    getSession();
    // Mutate AFTER the seed; the second access must not re-seed over it.
    togglePaperPin("paper:p2");
    flushNow();
    const after = localStorage.getItem(VIEW_SESSION_KEY);

    __resetViewSessionForTests();
    const s2 = getSession();
    expect(s2.paperPinned).toEqual(["paper:p1", "paper:p2"]);
    // Blob unchanged on the re-read (no re-seed).
    expect(localStorage.getItem(VIEW_SESSION_KEY)).toBe(after);
    expect(localStorage.getItem(PAPER_PINNED_KEY)).not.toBeNull();
  });

  it("a second store init in the same window (blob present) is a no-op seed", () => {
    getSession(); // seeds empty blob
    setCitedOnly(true);
    flushNow();
    __resetViewSessionForTests(); // simulate a second Library mount re-reading
    expect(getSession().citedOnly).toBe(true);
  });
});

describe("view-session-store — per-scope / per-library isolation (coherence fix)", () => {
  it("sorting one list does not touch another list, panel, or scope", () => {
    setListSort("", "left", "central", { col: "author", dir: "asc" });
    setListSort("", "left", "paper:x", { col: "title", dir: "desc" });
    setListSort("", "right", "central", { col: "status", dir: "asc" });
    setListSort("outer:lib-1", "left", "central", { col: "citekey", dir: "desc" });

    const s = getSession();
    expect(s.scopes[""].left.lists["central"].sort).toEqual({
      col: "author",
      dir: "asc",
    });
    expect(s.scopes[""].left.lists["paper:x"].sort).toEqual({
      col: "title",
      dir: "desc",
    });
    expect(s.scopes[""].right.lists["central"].sort).toEqual({
      col: "status",
      dir: "asc",
    });
    expect(s.scopes["outer:lib-1"].left.lists["central"].sort).toEqual({
      col: "citekey",
      dir: "desc",
    });
  });
});

describe("view-session-store — selection scope", () => {
  it("setSelection on left does not mutate right", () => {
    setSelection("", "left", { selectedKeys: ["L"], anchorKey: "L" });
    setSelection("", "right", { selectedKeys: ["R"], anchorKey: "R" });
    const s = getSession();
    expect(s.scopes[""].left.selectedKeys).toEqual(["L"]);
    expect(s.scopes[""].right.selectedKeys).toEqual(["R"]);
  });
});

describe("view-session-store — restore-race tolerance", () => {
  it("leftPinnedActiveId restored even before its tab resolves (persisted, not pruned)", () => {
    setLeftPinnedActiveId("", "lib-not-yet-loaded");
    flushNow();
    __resetViewSessionForTests();
    // The store keeps the id verbatim; the consumer's includes-guard
    // decides whether to apply it once the tab resolves.
    expect(getSession().scopes[""].left.leftPinnedActiveId).toBe(
      "lib-not-yet-loaded",
    );
  });

  it("a restored custom-lib openId stays in the blob even when it doesn't resolve yet", () => {
    setPanelTabs("", "left", {
      openIds: ["central", "lib-unknown"],
      activeId: "central",
    });
    flushNow();
    __resetViewSessionForTests();
    // The store never prunes ids; only an explicit close() would.
    expect(getSession().scopes[""].left.tabs?.openIds).toEqual([
      "central",
      "lib-unknown",
    ]);
  });
});

describe("view-session-store — scroll key isolation", () => {
  it("(panel,libId) scroll positions are stored independently", () => {
    setListScroll("", "left", "central", 100);
    setListScroll("", "left", "paper:x", 250);
    const s = getSession();
    expect(s.scopes[""].left.lists["central"].scrollTop).toBe(100);
    expect(s.scopes[""].left.lists["paper:x"].scrollTop).toBe(250);
  });
});

describe("view-session-store — paper view mode (Text/PDF)", () => {
  it("round-trips per-(panel,paper) and survives a simulated reload", () => {
    setListViewMode("", "left", "paper:foo", "pdf");
    flushNow();
    expect(getSession().scopes[""].left.lists["paper:foo"].viewMode).toBe("pdf");

    // Simulate reload: drop the singleton, re-read the same localStorage.
    __resetViewSessionForTests();
    expect(getSession().scopes[""].left.lists["paper:foo"].viewMode).toBe("pdf");
  });

  it("each paper remembers its own mode — switching papers doesn't bleed", () => {
    setListViewMode("", "left", "paper:foo", "pdf");
    setListViewMode("", "left", "paper:bar", "text");
    const s = getSession();
    expect(s.scopes[""].left.lists["paper:foo"].viewMode).toBe("pdf");
    expect(s.scopes[""].left.lists["paper:bar"].viewMode).toBe("text");
  });

  it("coexists with the reader scroll on the same paper:<citekey> slice", () => {
    setListViewMode("", "left", "paper:foo", "pdf");
    setListScroll("", "left", "paper:foo", 333);
    const lv = getSession().scopes[""].left.lists["paper:foo"];
    expect(lv.viewMode).toBe("pdf");
    expect(lv.scrollTop).toBe(333);
  });
});

describe("view-session-store — always-reset-to-PDF on open (FIX #3)", () => {
  it("a fresh open defaults to PDF when a PDF exists, IGNORING a persisted Text choice", () => {
    // User toggled this paper to Text last session; it persisted.
    setListViewMode("", "left", "paper:foo", "text");
    flushNow();
    __resetViewSessionForTests(); // simulate reload (blob persists)
    expect(getSession().scopes[""].left.lists["paper:foo"].viewMode).toBe("text");

    // Reopening the paper (pdfAvailable=true) snaps it back to PDF — the prior
    // Text choice does NOT stick across the reopen.
    resetPaperViewModeOnOpen("", "left", "paper:foo", true);
    expect(getSession().scopes[""].left.lists["paper:foo"].viewMode).toBe("pdf");
  });

  it("the Text toggle still works WITHIN the session after the open reset", () => {
    resetPaperViewModeOnOpen("", "left", "paper:foo", true); // open → pdf
    expect(getSession().scopes[""].left.lists["paper:foo"].viewMode).toBe("pdf");
    // Live toggle to Text during the session.
    setListViewMode("", "left", "paper:foo", "text");
    expect(getSession().scopes[""].left.lists["paper:foo"].viewMode).toBe("text");
  });

  it("a DOCX-only source (no PDF on disk) resets to Text, never stranding on disabled PDF", () => {
    setListViewMode("", "left", "paper:docx", "pdf"); // stale persisted pdf
    resetPaperViewModeOnOpen("", "left", "paper:docx", /* pdfAvailable */ false);
    expect(getSession().scopes[""].left.lists["paper:docx"].viewMode).toBe("text");
  });

  it("is a quiet no-op (no notify) when the slice is already at the open default", () => {
    resetPaperViewModeOnOpen("", "left", "paper:foo", true); // open → pdf
    const seen = vi.fn();
    const unsub = subscribe(seen);
    // Re-running on the same open (still pdf) must not commit/notify again.
    resetPaperViewModeOnOpen("", "left", "paper:foo", true);
    expect(seen).not.toHaveBeenCalled();
    expect(getSession().scopes[""].left.lists["paper:foo"].viewMode).toBe("pdf");
    unsub();
  });
});

describe("view-session-store — write coalescing + flush", () => {
  it("N rapid setListQuery within the debounce window → ≤1 localStorage.setItem", () => {
    vi.useFakeTimers();
    // The initial absent-blob seed performs ONE synchronous setItem; reset
    // the spy after init so we measure only the debounced writes.
    getSession();
    setItemSpy.mockClear();

    for (let i = 0; i < 10; i++) {
      setListQuery("", "left", "central", `q${i}`);
    }
    // Before the timer fires: nothing written yet.
    expect(setItemSpy).not.toHaveBeenCalled();
    vi.advanceTimersByTime(250);
    // Exactly one coalesced write.
    expect(setItemSpy).toHaveBeenCalledTimes(1);
    expect(getSession().scopes[""].left.lists["central"].query).toBe("q9");
  });

  it("pagehide-style flushNow writes the latest value immediately", () => {
    vi.useFakeTimers();
    getSession();
    setListQuery("", "left", "central", "pending");
    // Pending in-memory but not yet persisted.
    flushNow();
    const raw = localStorage.getItem(VIEW_SESSION_KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw as string);
    expect(parsed.scopes[""].left.lists["central"].query).toBe("pending");
  });
});

describe("view-session-store — global slices", () => {
  it("togglePaperPin toggles membership", () => {
    togglePaperPin("paper:a");
    expect(getSession().paperPinned).toEqual(["paper:a"]);
    togglePaperPin("paper:a");
    expect(getSession().paperPinned).toEqual([]);
  });

  it("project hidden / pinned + cited-only round-trip and survive a simulated provider remount", () => {
    setProjectHidden(["project:doc:h"]);
    setProjectPinned(["project:doc:p"]);
    setCitedOnly(true);
    flushNow();
    // Simulate the ProjectLibraryProvider remount: the singleton survives.
    __resetViewSessionForTests();
    const s = getSession();
    expect(s.projectHidden).toEqual(["project:doc:h"]);
    expect(s.projectPinned).toEqual(["project:doc:p"]);
    expect(s.citedOnly).toBe(true);
  });
});

describe("view-session-store — quiet scroll write (keystroke sanctity)", () => {
  it("setListScrollQuiet does NOT notify subscribers once the slice exists, but still persists", () => {
    // Create the slice first (one notifying write is allowed on first touch).
    setListScroll("", "left", "central", 10);
    const seen = vi.fn();
    const unsub = subscribe(seen);
    // Subsequent scroll frames go quiet: no notify, value still updated.
    setListScrollQuiet("", "left", "central", 120);
    setListScrollQuiet("", "left", "central", 240);
    expect(seen).not.toHaveBeenCalled();
    expect(getSession().scopes[""].left.lists["central"].scrollTop).toBe(240);
    // And it persists to localStorage on flush.
    flushNow();
    const raw = JSON.parse(localStorage.getItem(VIEW_SESSION_KEY) as string);
    expect(raw.scopes[""].left.lists["central"].scrollTop).toBe(240);
    unsub();
  });

  it("setListScrollQuiet creates the slice via one notifying write when absent", () => {
    const seen = vi.fn();
    const unsub = subscribe(seen);
    setListScrollQuiet("", "left", "paper:fresh", 88);
    // First-ever touch creates the slice through the notifying path.
    expect(seen).toHaveBeenCalledTimes(1);
    expect(getSession().scopes[""].left.lists["paper:fresh"].scrollTop).toBe(88);
    unsub();
  });
});

describe("view-session-store — legacy layout-size migration", () => {
  function seedBlob(layout: Record<string, number>): void {
    localStorage.setItem(
      VIEW_SESSION_KEY,
      JSON.stringify({
        schemaVersion: 1,
        scopes: {},
        paperPinned: [],
        projectHidden: [],
        projectPinned: [],
        citedOnly: false,
        layout,
      }),
    );
    __resetViewSessionForTests();
  }

  it("adopts the freshest standalone key over a stale seeded layout value (the bitten-cohort bug)", () => {
    // An existing blob froze a stale middleWidth; the standalone key holds the
    // user's newer resize. The newer standalone value must win.
    seedBlob({ middleWidth: 420 });
    localStorage.setItem(MIDDLE_WIDTH_KEY, "500");

    const adopted = migrateLegacyLayoutSizes();

    expect(adopted).toBe(true);
    expect(getSession().layout.middleWidth).toBe(500);
    // The legacy key is deleted so it can never re-clobber a later store write.
    expect(localStorage.getItem(MIDDLE_WIDTH_KEY)).toBeNull();
  });

  it("is idempotent across reloads — a second run never re-clobbers a value set through the store", () => {
    seedBlob({ middleWidth: 420 });
    localStorage.setItem(MIDDLE_WIDTH_KEY, "500");
    migrateLegacyLayoutSizes(); // → 500, key deleted

    // The user resizes under the new code (store-only write).
    setLayout({ middleWidth: 600 });
    // Simulate a reload: the in-memory session resets but the (key-less) blob
    // persists. A second migration must be a no-op, NOT re-apply the old 500.
    flushNow();
    __resetViewSessionForTests();
    const adopted = migrateLegacyLayoutSizes();

    expect(adopted).toBe(false);
    expect(getSession().layout.middleWidth).toBe(600);
  });

  it("min-floors a corrupt sub-minimum legacy size and deletes every legacy key", () => {
    seedBlob({});
    localStorage.setItem(NAV_WIDTH_KEY, "40"); // below NAV_MIN (180)
    localStorage.setItem(MIDDLE_WIDTH_KEY, "900");
    localStorage.setItem(PAPERS_HEIGHT_KEY, "10"); // below PAPERS_MIN (100)

    migrateLegacyLayoutSizes();

    const { layout } = getSession();
    expect(layout.navWidth).toBe(180);
    expect(layout.middleWidth).toBe(900);
    expect(layout.papersHeight).toBe(100);
    expect(localStorage.getItem(NAV_WIDTH_KEY)).toBeNull();
    expect(localStorage.getItem(MIDDLE_WIDTH_KEY)).toBeNull();
    expect(localStorage.getItem(PAPERS_HEIGHT_KEY)).toBeNull();
  });

  it("is a no-op when no legacy keys exist", () => {
    seedBlob({ middleWidth: 360 });
    const adopted = migrateLegacyLayoutSizes();
    expect(adopted).toBe(false);
    expect(getSession().layout.middleWidth).toBe(360);
  });
});
