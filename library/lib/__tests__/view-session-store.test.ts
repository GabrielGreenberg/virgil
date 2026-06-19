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
  setListSort,
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
    expect(s.layout.navWidth).toBe(210);
    expect(s.layout.middleWidth).toBe(330);
    expect(s.layout.papersHeight).toBe(144);
    // col-sort seeds ONLY the singleton central list's default sort.
    expect(s.scopes[""].left.lists["central"].sort).toEqual({
      col: "title",
      dir: "asc",
    });

    // Legacy keys are NOT deleted.
    expect(localStorage.getItem(PAPER_PINNED_KEY)).not.toBeNull();
    expect(localStorage.getItem(CITED_ONLY_KEY)).toBe("1");
    expect(localStorage.getItem(COL_SORT_KEY)).not.toBeNull();
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
