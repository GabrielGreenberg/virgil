// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * The Outline view prefs must survive BOTH reload and the docked↔popped-out
 * remount (OUT-#7). The store is the SSOT that makes both true: it persists to
 * localStorage (reload) and lives at module scope so every panel instance
 * reads the same live snapshot (pop-out). These tests pin both.
 *
 * Task 111 adds three more contracts:
 *  - FOLDS ARE PER-DOCUMENT: fold ids are 4-hex block uuids, unique only
 *    within one doc — buckets keyed by docId stop cross-paper bleed, and
 *    collapse/expand-all replace ONLY the current doc's bucket.
 *  - LEGACY MIGRATION: a pre-scoping blob's flat `collapsed` array serves as
 *    a read fallback for docs with no bucket, superseded per-doc on first
 *    bucket write.
 *  - CROSS-WINDOW RE-SYNC: a peer window's localStorage write re-hydrates
 *    this window's snapshot via the native `storage` event, so a stale
 *    module-eval snapshot can never whole-blob-clobber peer writes.
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

type Store = Awaited<ReturnType<typeof freshStore>>;

function collapsedFor(s: Store, docId: string): string[] {
  return [...s.getOutlineCollapsedForDoc(s.getOutlinePrefsSnapshot(), docId)];
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
    expect(snap.folds.size).toBe(0);
    expect(snap.legacyCollapsed).toBe(null);
    expect(collapsedFor(s, "doc_a")).toEqual([]);
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

  it("setOutlineCollapsedForDoc accepts a Set and an updater, and persists per doc", async () => {
    const s = await freshStore();
    s.setOutlineCollapsedForDoc("doc_a", new Set(["a", "b"]));
    expect(collapsedFor(s, "doc_a").sort()).toEqual(["a", "b"]);

    s.setOutlineCollapsedForDoc("doc_a", (prev) => {
      const next = new Set(prev);
      next.add("c");
      return next;
    });
    expect(collapsedFor(s, "doc_a").sort()).toEqual(["a", "b", "c"]);

    const raw = JSON.parse(localStorage.getItem(KEY)!);
    const bucket = raw.folds.find((e: [string, string[]]) => e[0] === "doc_a")!;
    expect(bucket[1].sort()).toEqual(["a", "b", "c"]);
  });

  it("scopes folds per document: writes to doc B never touch doc A (members 1+2)", async () => {
    const s = await freshStore();
    s.setOutlineCollapsedForDoc("doc_a", new Set(["a1", "a2"]));

    // Same uuid in another doc (the 4-hex collision case) — independent.
    s.setOutlineCollapsedForDoc("doc_b", new Set(["a1", "b9"]));
    expect(collapsedFor(s, "doc_a").sort()).toEqual(["a1", "a2"]);

    // "Expand all" in doc B = replace ITS bucket with empty — A survives.
    s.setOutlineCollapsedForDoc("doc_b", new Set());
    expect(collapsedFor(s, "doc_b")).toEqual([]);
    expect(collapsedFor(s, "doc_a").sort()).toEqual(["a1", "a2"]);

    // "Collapse all" in doc B = replace ITS bucket wholesale — A survives.
    s.setOutlineCollapsedForDoc("doc_b", new Set(["b1", "b2", "b3"]));
    expect(collapsedFor(s, "doc_a").sort()).toEqual(["a1", "a2"]);
  });

  it("migrates the legacy flat `collapsed` shape: fallback until a doc writes its bucket", async () => {
    // A pre-scoping session persisted one global fold set.
    localStorage.setItem(
      KEY,
      JSON.stringify({
        collapsed: ["sec-1", "sec-2"],
        showLabels: false,
        showTitles: true,
        showWordCount: true,
        showPosition: true,
        showNumbers: true,
      }),
    );
    const s = await freshStore();
    const snap = s.getOutlinePrefsSnapshot();
    // Flat prefs survive the migration untouched.
    expect(snap.showLabels).toBe(false);
    expect(snap.showNumbers).toBe(true);
    // Docs with no bucket read the legacy set (folds survive the upgrade)…
    expect(collapsedFor(s, "doc_a").sort()).toEqual(["sec-1", "sec-2"]);
    expect(collapsedFor(s, "doc_b").sort()).toEqual(["sec-1", "sec-2"]);

    // …until a doc writes its own bucket, which supersedes legacy FOR IT ONLY.
    s.setOutlineCollapsedForDoc("doc_a", new Set()); // expand-all in A
    expect(collapsedFor(s, "doc_a")).toEqual([]);
    expect(collapsedFor(s, "doc_b").sort()).toEqual(["sec-1", "sec-2"]);

    // The migrated shape round-trips: a reload keeps both bucket and legacy.
    const s2 = await freshStore();
    expect(collapsedFor(s2, "doc_a")).toEqual([]);
    expect(collapsedFor(s2, "doc_b").sort()).toEqual(["sec-1", "sec-2"]);
  });

  it("re-syncs from a peer window's write via the storage event (member 3)", async () => {
    const s = await freshStore();
    s.setOutlineCollapsedForDoc("doc_a", new Set(["a1"]));
    const cb = vi.fn();
    s.subscribeOutlinePrefs(cb);

    // Peer window writes the blob (storage events fire only in OTHER windows,
    // so we simulate: raw setItem + a dispatched StorageEvent).
    const peerBlob = JSON.parse(localStorage.getItem(KEY)!);
    peerBlob.folds = [["doc_a", ["a1", "peer-added"]]];
    peerBlob.showNumbers = true;
    localStorage.setItem(KEY, JSON.stringify(peerBlob));
    window.dispatchEvent(new StorageEvent("storage", { key: KEY }));

    // This window's snapshot refreshed — no permanently-stale module snapshot.
    expect(cb).toHaveBeenCalled();
    expect(collapsedFor(s, "doc_a").sort()).toEqual(["a1", "peer-added"]);
    expect(s.getOutlinePrefsSnapshot().showNumbers).toBe(true);

    // And this window's NEXT write starts from the refreshed state, so it
    // can no longer revert the peer's fold (the whole-blob clobber).
    s.setOutlineCollapsedForDoc("doc_b", new Set(["b1"]));
    const raw = JSON.parse(localStorage.getItem(KEY)!);
    const docA = raw.folds.find((e: [string, string[]]) => e[0] === "doc_a")!;
    expect(docA[1].sort()).toEqual(["a1", "peer-added"]);
  });

  it("ignores storage events for other keys and non-localStorage clears", async () => {
    const s = await freshStore();
    const before = s.getOutlinePrefsSnapshot();
    window.dispatchEvent(new StorageEvent("storage", { key: "some-other-key" }));
    expect(s.getOutlinePrefsSnapshot()).toBe(before);
    // key === null with storageArea ≠ localStorage (e.g. a peer's
    // sessionStorage.clear()) must not replace the snapshot.
    window.dispatchEvent(new StorageEvent("storage", { key: null }));
    expect(s.getOutlinePrefsSnapshot()).toBe(before);
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
    s.setOutlineCollapsedForDoc("doc_a", (prev) => prev);
    expect(s.getOutlinePrefsSnapshot()).toBe(before);

    // Equal-value rewrite of an EXISTING bucket bails too.
    s.setOutlineCollapsedForDoc("doc_a", new Set(["x"]));
    const after = s.getOutlinePrefsSnapshot();
    s.setOutlineCollapsedForDoc("doc_a", new Set(["x"]));
    expect(s.getOutlinePrefsSnapshot()).toBe(after);
  });

  it("keeps a doc's fold ARRAY referentially stable across unrelated writes", async () => {
    const s = await freshStore();
    s.setOutlineCollapsedForDoc("doc_a", new Set(["a1"]));
    const arrA = s.getOutlineCollapsedForDoc(s.getOutlinePrefsSnapshot(), "doc_a");

    s.setOutlinePrefs({ showNumbers: true });
    s.setOutlineCollapsedForDoc("doc_b", new Set(["b1"]));

    // Same array object → the panel's `new Set(arr)` memo doesn't churn.
    expect(s.getOutlineCollapsedForDoc(s.getOutlinePrefsSnapshot(), "doc_a")).toBe(arrA);
  });

  it("caps per-doc buckets (LRU): oldest evicted, most-recent retained", async () => {
    const s = await freshStore();
    for (let i = 0; i < 70; i++) {
      s.setOutlineCollapsedForDoc(`doc_${i}`, new Set([`id-${i}`]));
    }
    const snap = s.getOutlinePrefsSnapshot();
    expect(snap.folds.size).toBe(64);
    expect(snap.folds.has("doc_0")).toBe(false); // oldest evicted
    expect(collapsedFor(s, "doc_69")).toEqual(["id-69"]); // newest retained

    // Re-touching an old doc refreshes its recency.
    s.setOutlineCollapsedForDoc("doc_10", new Set(["refreshed"]));
    s.setOutlineCollapsedForDoc("doc_new", new Set(["n"]));
    expect(collapsedFor(s, "doc_10")).toEqual(["refreshed"]);
  });

  it("survives reload: a re-instantiated store hydrates from localStorage", async () => {
    // Simulate a prior session having saved prefs (current shape).
    localStorage.setItem(
      KEY,
      JSON.stringify({
        folds: [["doc_a", ["sec-1"]]],
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
    expect(collapsedFor(s, "doc_a")).toEqual(["sec-1"]);
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
