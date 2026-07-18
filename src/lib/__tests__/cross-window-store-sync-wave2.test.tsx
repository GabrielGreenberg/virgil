// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

/**
 * Cross-window sync, wave 2 (task 179) — the seven stores left over from the
 * 177 census.
 *
 * Same bug class, same two assertions per store:
 *   1. a PEER window's write is observed without a reload, and
 *   2. this window's NEXT write preserves the peer's change.
 * (2) is the one that actually pins the clobber — a store can look synced and
 * still serialize its stale base back over the peer.
 *
 * Two shapes are covered, because they fail differently:
 *   - module-global (`useZenMode`, `pref-links`, `view-session-store`) — the
 *     177 move: one `readXFromStorage()` shared by hydrate and sync.
 *   - hook-state (`usePreferences`, `useWordCountConfig`, `useLibraryTabs`,
 *     the `ActionsMenuPanel` palette) — the listener lives in an effect via
 *     `useStorageKeySync`, and any store that persists from a state-watching
 *     effect must write through `writeStorageIfChanged` or the sync echoes
 *     back out as a write and two windows ping-pong forever.
 */

// Deterministic in-memory localStorage — the ambient one in this runner is
// Node's experimental Web Storage and lacks a usable `clear`.
function installLocalStorage() {
  const m = new Map<string, string>();
  const ls = {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => { m.set(k, String(v)); },
    removeItem: (k: string) => { m.delete(k); },
    clear: () => { m.clear(); },
    key: (i: number) => [...m.keys()][i] ?? null,
    get length() { return m.size; },
  };
  Object.defineProperty(globalThis, "localStorage", {
    value: ls, configurable: true, writable: true,
  });
}

/** A PEER window's write: the blob lands in storage, then the native
 *  `storage` event fires — which real browsers deliver only to OTHER
 *  windows, never the writer. */
function peerWrite(key: string, blob: unknown) {
  localStorage.setItem(key, JSON.stringify(blob));
  window.dispatchEvent(new StorageEvent("storage", { key }));
}

const read = (key: string) => JSON.parse(localStorage.getItem(key)!);

beforeEach(() => { installLocalStorage(); vi.resetModules(); });

/* ── the primitives ─────────────────────────────────────────────────── */

describe("writeStorageIfChanged", () => {
  it("skips the write when the value is unchanged", async () => {
    const { writeStorageIfChanged } = await import("@/lib/cross-window-storage");
    const spy = vi.spyOn(localStorage, "setItem");
    writeStorageIfChanged("k", "a");
    writeStorageIfChanged("k", "a"); // the echo
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it("reports whether storage HOLDS the value — not whether it wrote", async () => {
    const { writeStorageIfChanged } = await import("@/lib/cross-window-storage");
    expect(writeStorageIfChanged("k", "a")).toBe(true);  // wrote
    expect(writeStorageIfChanged("k", "a")).toBe(true);  // already there
    // A failed write is the only false — callers tracking "what is on disk"
    // (view-session-store's merge base) must not advance past a quota error.
    const spy = vi.spyOn(localStorage, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    expect(writeStorageIfChanged("k", "b")).toBe(false);
    spy.mockRestore();
  });
});

describe("useStorageKeySync", () => {
  it("covers every key it is given and unsubscribes on unmount", async () => {
    const { useStorageKeySync } = await import("@/lib/cross-window-storage");
    const cb = vi.fn();
    const { unmount } = renderHook(() => useStorageKeySync(["a", "b"], cb));

    window.dispatchEvent(new StorageEvent("storage", { key: "a" }));
    window.dispatchEvent(new StorageEvent("storage", { key: "b" }));
    window.dispatchEvent(new StorageEvent("storage", { key: "c" }));
    expect(cb).toHaveBeenCalledTimes(2);

    unmount();
    window.dispatchEvent(new StorageEvent("storage", { key: "a" }));
    expect(cb).toHaveBeenCalledTimes(2);
  });

  it("does not re-subscribe when an inline key array is re-created", async () => {
    const { useStorageKeySync } = await import("@/lib/cross-window-storage");
    const cb = vi.fn();
    const { rerender } = renderHook(() => useStorageKeySync(["a"], cb));
    rerender();
    rerender();
    window.dispatchEvent(new StorageEvent("storage", { key: "a" }));
    expect(cb).toHaveBeenCalledTimes(1); // one live listener, not three
  });
});

/* ── module-global stores ───────────────────────────────────────────── */

describe("useZenMode cross-window sync", () => {
  const KEY = "virgil-zen-mode";

  it("re-syncs from a peer write, and the next local write preserves it", async () => {
    const { useZenMode } = await import("@/hooks/useZenMode");
    const { result } = renderHook(() => useZenMode());
    act(() => result.current.setLeftMargin(200));

    // Peer (same base) turns zen ON and rewrites the whole blob.
    act(() => peerWrite(KEY, { on: true, leftMargin: 200, rightMargin: 320 }));

    expect(result.current.on).toBe(true);            // observed, no reload
    expect(result.current.rightMargin).toBe(320);

    // The clobber test: our next whole-blob write starts from the refreshed
    // base, so the peer's right margin and zen flag survive it.
    act(() => result.current.setLeftMargin(210));
    expect(read(KEY)).toEqual({ on: true, leftMargin: 210, rightMargin: 320 });
  });

  it("runs a peer blob through the same validation as the hydrate", async () => {
    const { useZenMode } = await import("@/hooks/useZenMode");
    const { result } = renderHook(() => useZenMode());

    act(() => peerWrite(KEY, { on: "yes", leftMargin: "wide" }));
    expect(result.current.on).toBe(false);           // non-boolean rejected
    expect(result.current.leftMargin).toBe(160);     // non-number → default

    act(() => peerWrite(KEY, true));                 // legacy boolean form
    expect(result.current.on).toBe(true);
  });
});

describe("pref-links cross-window sync", () => {
  const KEY = "virgil-pref-links";
  const ID = "topbarBackground>>tabBg";
  const OTHER = "topbarBackground>>libraryBg";

  it("re-syncs from a peer write, and the next local write preserves it", async () => {
    const s = await import("@/lib/pref-links");
    s.loadPrefLinks();
    s.setLinkField(ID, "locked", false);
    const v0 = s.getPrefLinksVersion();

    // Peer unlocks the OTHER link and rewrites the whole map.
    act(() => peerWrite(KEY, {
      [ID]: { deltaL: 0, locked: false },
      [OTHER]: { deltaL: 0.25, locked: false },
    }));

    expect(s.getPrefLinksVersion()).toBeGreaterThan(v0);
    expect(s.getLinkState(OTHER)).toEqual({ deltaL: 0.25, locked: false });

    s.setLinkField(ID, "deltaL", -0.1);
    expect(read(KEY)[OTHER]).toEqual({ deltaL: 0.25, locked: false });
    expect(read(KEY)[ID]).toEqual({ deltaL: -0.1, locked: false });
  });

  it("drops malformed entries from a peer blob", async () => {
    const s = await import("@/lib/pref-links");
    s.loadPrefLinks();
    act(() => peerWrite(KEY, { [ID]: { deltaL: "lots", locked: true } }));
    expect(s.getLinkState(ID)).toEqual(s.DEFAULT_LINK_STATES[ID]);
  });
});

/* ── hook-state stores ──────────────────────────────────────────────── */

describe("usePreferences cross-window sync", () => {
  const PREFS = "virgil-editor-prefs";
  const TRANSFORMS = "virgil-editor-transforms";

  it("re-syncs from a peer write, and the next local write preserves it", async () => {
    const { usePreferences } = await import("@/hooks/usePreferences");
    const { result } = renderHook(() => usePreferences());
    act(() => result.current.updatePref("topbarBackground", "#111111"));

    act(() => peerWrite(PREFS, {
      topbarBackground: "#111111",
      tabBg: "#222222",
    }));

    expect(result.current.prefs.tabBg).toBe("#222222");

    act(() => result.current.updatePref("topbarBackground", "#333333"));
    expect(read(PREFS).tabBg).toBe("#222222");       // peer's change survived
    expect(read(PREFS).topbarBackground).toBe("#333333");
  });

  it("watches the transforms key too, not just prefs", async () => {
    const { usePreferences } = await import("@/hooks/usePreferences");
    const { result } = renderHook(() => usePreferences());
    const before = result.current.transforms;

    act(() => peerWrite(TRANSFORMS, { ...before, contrast: 15 }));
    expect(result.current.transforms.contrast).toBe(15);
  });
});

describe("useWordCountConfig cross-window sync", () => {
  const KEY = "virgil-wordcount-config";

  it("re-syncs from a peer write, and the next local write preserves it", async () => {
    const { useWordCountConfig } = await import("@/hooks/useWordCountConfig");
    const { result } = renderHook(() => useWordCountConfig());
    act(() => result.current.setInclude("headings", false));

    // Peer (same base) opts comments IN and rewrites the whole include map.
    act(() => peerWrite(KEY, { include: { headings: false, comments: true } }));

    expect(result.current.config.include.comments).toBe(true);

    act(() => result.current.setInclude("math", false));
    expect(read(KEY).include.comments).toBe(true);   // peer's change survived
    expect(read(KEY).include.headings).toBe(false);
    expect(read(KEY).include.math).toBe(false);
  });
});

/* ── the library silo ───────────────────────────────────────────────── */

describe("library panel-tab persistence is echo-safe", () => {
  it("re-persisting an unchanged blob writes nothing (no peer ping-pong)", async () => {
    const store = await import("@library/lib/library-store");
    const state = { openIds: ["central"], activeId: "central" };

    store.savePanelTabs("left", state, {});
    const spy = vi.spyOn(localStorage, "setItem");
    // What the cross-window sync's setState makes the persist effect do.
    store.savePanelTabs("left", store.loadPanelTabs("left", {}), {});
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("view-session-store cross-window sync", () => {
  const KEY = "virgil-library-view-session";

  afterEach(() => { vi.useRealTimers(); });

  it("adopts a peer blob when this window has nothing unflushed", async () => {
    const s = await import("@library/lib/view-session-store");
    s.setCitedOnly(false);
    s.flushNow();

    act(() => peerWrite(KEY, {
      ...s.getSession(), citedOnly: true, projectPinned: ["a"],
    }));

    expect(s.getSession().citedOnly).toBe(true);
    expect(s.getSession().projectPinned).toEqual(["a"]);
  });

  it("MERGES a peer blob that lands mid-debounce instead of dropping either side", async () => {
    vi.useFakeTimers();
    const s = await import("@library/lib/view-session-store");
    s.setCitedOnly(false);
    s.flushNow();

    // This window pins a project — still only in memory (250 ms debounce).
    s.setProjectPinned(["mine"]);

    // The peer, from the same base, hides a project and flips citedOnly.
    peerWrite(KEY, {
      ...s.getSession(), projectPinned: [], projectHidden: ["theirs"], citedOnly: true,
    });

    // Neither side is lost: the peer's untouched-by-us fields land, our
    // unflushed field is re-applied on top.
    expect(s.getSession().projectHidden).toEqual(["theirs"]);
    expect(s.getSession().citedOnly).toBe(true);
    expect(s.getSession().projectPinned).toEqual(["mine"]);

    // …and the pending write flushes the MERGED blob, so the peer converges.
    vi.advanceTimersByTime(500);
    expect(read(KEY).projectPinned).toEqual(["mine"]);
    expect(read(KEY).projectHidden).toEqual(["theirs"]);
  });

  it("keeps a peer's edit to a DIFFERENT scope while preserving ours", async () => {
    vi.useFakeTimers();
    const s = await import("@library/lib/view-session-store");
    s.setPanelTabs("mine", "left", { openIds: ["central"], activeId: "central" });
    s.flushNow();

    s.setPanelTabs("mine", "left", { openIds: ["central", "x"], activeId: "x" });
    const peerBlob = {
      ...s.getSession(),
      scopes: {
        ...s.getSession().scopes,
        mine: { left: { tabs: { openIds: ["central"], activeId: "central" }, lists: {} }, right: { lists: {} } },
        theirs: { left: { tabs: { openIds: ["central"], activeId: "central" }, lists: {} }, right: { lists: {} } },
      },
    };
    peerWrite(KEY, peerBlob);

    expect(Object.keys(s.getSession().scopes)).toContain("theirs");
    expect(s.getSession().scopes["mine"]?.left?.tabs?.activeId).toBe("x");
    vi.advanceTimersByTime(500);
  });

  it("merges at LEAF granularity inside the SAME scope (both windows use scope '')", async () => {
    // The singleton scope holds both panels, every list's sort/query/scroll,
    // and the tab state — so a scope-level swap would still clobber. Window A
    // edits the left list's query; window B, from the same base, selects a row
    // in the RIGHT panel. Both must survive.
    vi.useFakeTimers();
    const s = await import("@library/lib/view-session-store");
    s.setListQuery("", "left", "central", "");
    s.flushNow();

    s.setListQuery("", "left", "central", "foo");          // ours, unflushed
    const peer = JSON.parse(JSON.stringify(s.getSession()));
    peer.scopes[""].left.lists.central.query = "";         // peer never saw ours
    peer.scopes[""].right.selectedKeys = ["row-7"];        // peer's own edit
    peerWrite(KEY, peer);

    expect(s.getSession().scopes[""].left.lists.central.query).toBe("foo");
    expect(s.getSession().scopes[""].right.selectedKeys).toEqual(["row-7"]);

    vi.advanceTimersByTime(500);
    expect(read(KEY).scopes[""].left.lists.central.query).toBe("foo");
    expect(read(KEY).scopes[""].right.selectedKeys).toEqual(["row-7"]);
  });

  it("keeps the live session when a peer writes an unreadable blob", async () => {
    const s = await import("@library/lib/view-session-store");
    s.setCitedOnly(true);
    s.flushNow();

    // Wrong schema version (a future Virgil, or a hand edit) and outright
    // corruption must NOT reset this window's view to an empty session.
    act(() => peerWrite(KEY, { schemaVersion: 99, scopes: {} }));
    expect(s.getSession().citedOnly).toBe(true);

    localStorage.setItem(KEY, "{not json");
    act(() => { window.dispatchEvent(new StorageEvent("storage", { key: KEY })); });
    expect(s.getSession().citedOnly).toBe(true);
  });

  it("does not treat a FAILED write as persisted (the merge base holds)", async () => {
    vi.useFakeTimers();
    const s = await import("@library/lib/view-session-store");
    s.setCitedOnly(false);
    s.flushNow();

    s.setProjectPinned(["mine"]);
    const spy = vi.spyOn(localStorage, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    vi.advanceTimersByTime(500);          // flush fails silently
    spy.mockRestore();

    // Our change never reached disk, so a peer blob must not be adopted over
    // it — the pre-fix bug cleared the base here and dropped `mine`.
    peerWrite(KEY, { ...s.getSession(), projectPinned: [], citedOnly: true });
    expect(s.getSession().projectPinned).toEqual(["mine"]);
    expect(s.getSession().citedOnly).toBe(true);
  });
});
