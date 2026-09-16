// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, renderHook, cleanup } from "@testing-library/react";

/**
 * Cross-window sync, wave 3 (task 599) — the stores the old guard could
 * not see, because they used the door NOT AT ALL rather than wrongly.
 *
 * Same two assertions per store as waves 1–2: a PEER write is observed without
 * a reload, and this window's next write does not clobber it from a stale base.
 * `useViewPrefs` gets the two legs the task names on top: the peer write
 * arrives by the `storage` event ALONE (the bus is stubbed to a no-op — which
 * is exactly what `bus.ts` does where BroadcastChannel is absent), and a peer
 * sync never becomes an outbound write.
 */

vi.mock("@/lib/multi-window/window-id", () => ({ getWindowId: () => "win-b" }));
vi.mock("@/lib/storage", () => ({ isDevStorage: false }));
// BroadcastChannel unavailable: `publish` no-ops and `subscribe` never fires.
vi.mock("@/lib/multi-window/bus", () => ({
  publish: () => {},
  subscribe: () => () => {},
}));

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

/** A peer window's write: the value lands, then the native `storage` event
 *  fires (browsers deliver it only to OTHER windows). */
function peerWriteRaw(key: string, raw: string) {
  localStorage.setItem(key, raw);
  window.dispatchEvent(new StorageEvent("storage", { key }));
}

beforeEach(() => { installLocalStorage(); vi.resetModules(); });
afterEach(() => cleanup());

/* ── M1 · useViewPrefs — the global prefs blob ────────────────────────── */

describe("useViewPrefs (global blob) — storage event is the floor under the bus", () => {
  const GLOBAL_KEY = "virgil-view-prefs/global";
  const readGlobal = () => JSON.parse(localStorage.getItem(GLOBAL_KEY) || "{}");

  it("re-reads a peer's global write delivered by `storage` alone, and does not clobber it", async () => {
    const { useViewPrefs } = await import("@/hooks/useViewPrefs");
    const { result } = renderHook(() => useViewPrefs());
    const peerWidth = result.current.prefs.pageWidth === 1000 ? 1001 : 1000;

    // Peer window A changes the page width.
    act(() => {
      peerWriteRaw(GLOBAL_KEY, JSON.stringify({ ...readGlobal(), pageWidth: peerWidth }));
    });
    expect(result.current.prefs.pageWidth).toBe(peerWidth);

    // This window then changes an unrelated GLOBAL pref. Its whole-blob write
    // must carry A's width, not the stale one it hydrated with.
    const left = result.current.prefs.editorLeftMargin === 150 ? 151 : 150;
    act(() => {
      result.current.setEditorLeftMargin(left);
    });
    expect(readGlobal().editorLeftMargin).toBe(left);
    expect(readGlobal().pageWidth).toBe(peerWidth);
  });

  it("a peer sync never becomes an outbound write (no ping-pong)", async () => {
    const { useViewPrefs } = await import("@/hooks/useViewPrefs");
    const { result } = renderHook(() => useViewPrefs());
    const peerWidth = result.current.prefs.pageWidth + 5;
    // The peer's own write lands BEFORE the spy, so the spy sees only this
    // window's reaction to the event.
    localStorage.setItem(GLOBAL_KEY, JSON.stringify({ ...readGlobal(), pageWidth: peerWidth }));
    const spy = vi.spyOn(localStorage, "setItem");
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: GLOBAL_KEY }));
    });
    expect(result.current.prefs.pageWidth).toBe(peerWidth);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("an unchanged persist writes nothing (idempotent whole-blob writes)", async () => {
    const { useViewPrefs } = await import("@/hooks/useViewPrefs");
    const { result } = renderHook(() => useViewPrefs());
    const width = result.current.prefs.pageWidth === 900 ? 901 : 900;
    act(() => { result.current.setPageWidth(width); });
    expect(readGlobal().pageWidth).toBe(width); // the first persist did write
    const spy = vi.spyOn(localStorage, "setItem");
    // Re-set the same value: `update` runs, `persist` runs, disk already holds it.
    act(() => { result.current.setPageWidth(width); });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

/* ── M2 · useHelperMode — module singleton ───────────────────────────── */

describe("useHelperMode", () => {
  const KEY = "virgil-helper-mode";

  it("follows a peer's toggle without a reload", async () => {
    const { useHelperMode } = await import("@/hooks/useHelperMode");
    const { result } = renderHook(() => useHelperMode());
    expect(result.current.on).toBe(false);
    act(() => peerWriteRaw(KEY, "true"));
    expect(result.current.on).toBe(true);
    act(() => peerWriteRaw(KEY, "false"));
    expect(result.current.on).toBe(false);
  });

  it("toggles from the peer's value, not the stale one", async () => {
    const { useHelperMode } = await import("@/hooks/useHelperMode");
    const { result } = renderHook(() => useHelperMode());
    act(() => peerWriteRaw(KEY, "true"));
    act(() => result.current.toggle());
    expect(localStorage.getItem(KEY)).toBe("false");
  });
});

/* ── M3 · BugReportWindow — the typed draft: see its own suite,
 *  `src/components/__tests__/BugReportWindow.test.tsx` ("cross-window draft"),
 *  which already carries the window's mock harness. ─────────────────────── */

/* ── M4 · useNotificationStream — the seen-at mark ───────────────────── */

vi.mock("@library/lib/library-storage", () => ({
  SUBDIRS: { notifications: "notifications" },
  readJsonFile: vi.fn(),
}));

describe("useNotificationStream", () => {
  const KEY = "virgil-notification-seen-at";

  it("does not re-surface a notification a peer window already marked seen", async () => {
    const storage = await import("@library/lib/library-storage");
    const readJsonFile = storage.readJsonFile as unknown as ReturnType<typeof vi.fn>;
    const inbox = { items: [{ at: "2026-01-01T00:00:00Z" }] };
    readJsonFile.mockResolvedValue({ items: [] });
    vi.useFakeTimers();
    try {
      const { useNotificationStream } = await import("@library/hooks/useNotificationStream");
      const { result } = renderHook(() =>
        useNotificationStream({} as FileSystemDirectoryHandle),
      );
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });

      // A peer window sees the new item first and advances the mark.
      act(() => peerWriteRaw(KEY, inbox.items[0].at));
      readJsonFile.mockResolvedValue(inbox);
      await act(async () => { await vi.advanceTimersByTimeAsync(6500); });
      expect(result.current).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });
});
