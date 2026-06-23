// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * The Outline view prefs must survive BOTH reload and the docked↔popped-out
 * remount (OUT-#7). The store is the SSOT that makes both true: it persists to
 * localStorage (reload) and lives at module scope so every panel instance
 * reads the same live snapshot (pop-out). These tests pin both.
 */

const KEY = "virgil-outline-prefs";

// Install a deterministic in-memory localStorage. The ambient one in this
// runner is Node's experimental Web Storage (the `--localstorage-file` warning)
// and lacks a usable `clear`, so we control it explicitly.
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
    value: ls,
    configurable: true,
    writable: true,
  });
}

async function freshStore() {
  vi.resetModules();
  return import("../outline-prefs-store");
}

describe("outline-prefs-store", () => {
  beforeEach(() => {
    installLocalStorage();
  });

  it("returns shipped defaults when nothing is persisted", async () => {
    const s = await freshStore();
    const snap = s.getOutlinePrefsSnapshot();
    expect(snap.showLabels).toBe(true);
    expect(snap.showTitles).toBe(true);
    expect(snap.showWordCount).toBe(true);
    expect(snap.showPosition).toBe(true);
    expect(snap.showNumbers).toBe(false);
    expect([...snap.collapsed]).toEqual([]);
  });

  it("setOutlinePrefs persists, updates the snapshot, and notifies subscribers", async () => {
    const s = await freshStore();
    const cb = vi.fn();
    const unsub = s.subscribeOutlinePrefs(cb);

    s.setOutlinePrefs({ showNumbers: true, showLabels: false });

    expect(cb).toHaveBeenCalledTimes(1);
    const snap = s.getOutlinePrefsSnapshot();
    expect(snap.showNumbers).toBe(true);
    expect(snap.showLabels).toBe(false);

    const raw = JSON.parse(localStorage.getItem(KEY)!);
    expect(raw.showNumbers).toBe(true);
    expect(raw.showLabels).toBe(false);
    unsub();
  });

  it("setOutlineCollapsed accepts a Set and an updater, and persists as an array", async () => {
    const s = await freshStore();
    s.setOutlineCollapsed(new Set(["a", "b"]));
    expect([...s.getOutlinePrefsSnapshot().collapsed].sort()).toEqual(["a", "b"]);

    s.setOutlineCollapsed((prev) => {
      const next = new Set(prev);
      next.add("c");
      return next;
    });
    expect([...s.getOutlinePrefsSnapshot().collapsed].sort()).toEqual(["a", "b", "c"]);

    const raw = JSON.parse(localStorage.getItem(KEY)!);
    expect(raw.collapsed.sort()).toEqual(["a", "b", "c"]);
  });

  it("getSnapshot is referentially stable until a real change (useSyncExternalStore contract)", async () => {
    const s = await freshStore();
    const a = s.getOutlinePrefsSnapshot();
    const b = s.getOutlinePrefsSnapshot();
    expect(a).toBe(b); // no spurious new objects → no React loop

    s.setOutlinePrefs({ showNumbers: true });
    const c = s.getOutlinePrefsSnapshot();
    expect(c).not.toBe(a); // changed → new identity

    // No-op collapsed update keeps identity stable.
    const before = s.getOutlinePrefsSnapshot();
    s.setOutlineCollapsed((prev) => prev);
    expect(s.getOutlinePrefsSnapshot()).toBe(before);
  });

  it("survives reload: a re-instantiated store hydrates from localStorage", async () => {
    // Simulate a prior session having saved prefs.
    localStorage.setItem(
      KEY,
      JSON.stringify({
        collapsed: ["sec-1"],
        showLabels: false,
        showTitles: false,
        showWordCount: false,
        showPosition: false,
        showNumbers: true,
      }),
    );
    const s = await freshStore(); // fresh module = a reload
    const snap = s.getOutlinePrefsSnapshot();
    expect(snap.showNumbers).toBe(true);
    expect(snap.showLabels).toBe(false);
    expect([...snap.collapsed]).toEqual(["sec-1"]);
  });

  it("survives pop-out: every reader shares one live snapshot (no per-instance state)", async () => {
    const s = await freshStore();
    // "Docked" instance toggles a pref.
    s.setOutlinePrefs({ showNumbers: true });
    // "Popped-out" instance mounts later and reads the SAME store — the value
    // is present, not reset to defaults (the bug this store fixes).
    expect(s.getOutlinePrefsSnapshot().showNumbers).toBe(true);
  });
});
