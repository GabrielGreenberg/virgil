// @vitest-environment jsdom
//
// Multi-doc keep-alive: the DiskWatcherProvider sits ONCE above N mounted
// useDocument instances (1 active + warm). Two properties under test:
//  (A2) dirty-getter / reload registrations are keyed per-docId so the active
//       watcher reads the ACTIVE doc's entry (not last-writer-wins);
//  (F2) a doc's watcher is WARM-STABLE — created once, kept running, and reused
//       across an A→B→A round-trip (never re-primed) — and disposed (stop +
//       clear ledger) ONLY when the doc leaves the keep-alive set.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, act } from "@testing-library/react";
import React from "react";

interface FakeWatcher {
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  clearChanges: ReturnType<typeof vi.fn>;
  hasUnsavedEdits: () => boolean;
}
const createCalls = new Map<string, number>();
const watchers = new Map<string, FakeWatcher>();
const clearLedgerCalls: string[] = [];

vi.mock("@/lib/disk-watcher", () => ({
  createDiskWatcher: (cfg: { docId: string; hasUnsavedEdits: () => boolean }) => {
    createCalls.set(cfg.docId, (createCalls.get(cfg.docId) ?? 0) + 1);
    const w: FakeWatcher & Record<string, unknown> = {
      store: { subscribe: () => () => {}, getSnapshot: () => ({}) },
      start: vi.fn(),
      stop: vi.fn(),
      pollNow: async () => {},
      acknowledge: async () => {},
      clearChanges: vi.fn(),
      hasUnresolvedChange: () => false,
      hasUnsavedEdits: cfg.hasUnsavedEdits,
    };
    watchers.set(cfg.docId, w as unknown as FakeWatcher);
    return w;
  },
}));
vi.mock("@/lib/disk-ledger", () => ({
  clearDiskLedger: (id: string) => clearLedgerCalls.push(id),
}));
vi.mock("@/lib/storage", () => ({
  statFiles: async () => [],
  readTextFile: async () => "",
  getTexFilename: () => "main.tex",
  getBibFilename: () => null,
}));

import {
  DiskWatcherProvider,
  useDiskWatcher,
  type DiskWatcherContextValue,
} from "../disk-watcher";

let ctx: DiskWatcherContextValue | null = null;
function Capture() {
  ctx = useDiskWatcher();
  return null;
}
function Harness({ docId, liveDocIds }: { docId: string; liveDocIds: string[] }) {
  return React.createElement(DiskWatcherProvider, {
    docId,
    liveDocIds,
    children: React.createElement(Capture),
  });
}

beforeEach(() => {
  createCalls.clear();
  watchers.clear();
  clearLedgerCalls.length = 0;
  ctx = null;
});

describe("DiskWatcherProvider per-doc registration (A2)", () => {
  it("the active watcher reads the ACTIVE doc's dirty-getter, NOT the last registered", () => {
    render(React.createElement(Harness, { docId: "A", liveDocIds: ["A"] }));
    expect(ctx!.activeDocId).toBe("A");
    act(() => {
      ctx!.registerUnsavedGetter("A", () => true);
      ctx!.registerUnsavedGetter("B", () => false); // registered LAST
    });
    expect(watchers.get("A")!.hasUnsavedEdits()).toBe(true);
  });

  it("reloadFromDisk drives ONLY the active doc's refetch", async () => {
    render(React.createElement(Harness, { docId: "A", liveDocIds: ["A"] }));
    const reloadA = vi.fn();
    const reloadB = vi.fn();
    act(() => {
      ctx!.registerReload("A", reloadA);
      ctx!.registerReload("B", reloadB);
    });
    await act(async () => {
      await ctx!.reloadFromDisk();
    });
    expect(reloadA).toHaveBeenCalledTimes(1);
    expect(reloadB).not.toHaveBeenCalled();
  });

  it("unregistering a doc's getter does not clobber another doc's registration", () => {
    render(React.createElement(Harness, { docId: "A", liveDocIds: ["A"] }));
    let unregisterB: () => void = () => {};
    act(() => {
      ctx!.registerUnsavedGetter("A", () => true);
      unregisterB = ctx!.registerUnsavedGetter("B", () => false);
    });
    act(() => unregisterB());
    expect(watchers.get("A")!.hasUnsavedEdits()).toBe(true);
  });
});

describe("DiskWatcherProvider warm-stable watcher lifecycle (F2)", () => {
  it("reuses (never re-creates or re-starts) a doc's watcher across an A→B→A round-trip while it stays warm", () => {
    const { rerender } = render(
      React.createElement(Harness, { docId: "A", liveDocIds: ["A"] }),
    );
    expect(createCalls.get("A")).toBe(1);
    expect(watchers.get("A")!.start).toHaveBeenCalledTimes(1);

    // Switch A→B; A stays in the keep-alive set (warm).
    rerender(React.createElement(Harness, { docId: "B", liveDocIds: ["B", "A"] }));
    expect(createCalls.get("B")).toBe(1);
    expect(watchers.get("B")!.start).toHaveBeenCalledTimes(1);
    expect(watchers.get("A")!.stop).not.toHaveBeenCalled(); // A keeps running

    // Switch B→A: A's watcher is REUSED — not re-created (so its conflict store
    // survives) and not re-started (so it never re-primes away the badge).
    rerender(React.createElement(Harness, { docId: "A", liveDocIds: ["A", "B"] }));
    expect(createCalls.get("A")).toBe(1); // still 1 — reused
    expect(watchers.get("A")!.start).toHaveBeenCalledTimes(1); // not re-started
    expect(clearLedgerCalls).not.toContain("A"); // ledger never cleared
  });

  it("disposes (stop + clear ledger) a doc's watcher only when it LEAVES the keep-alive set", () => {
    const { rerender } = render(
      React.createElement(Harness, { docId: "A", liveDocIds: ["A"] }),
    );
    rerender(React.createElement(Harness, { docId: "B", liveDocIds: ["B", "A"] }));
    expect(watchers.get("A")!.stop).not.toHaveBeenCalled();

    // A is evicted from the set (4th doc opened / tab closed).
    rerender(React.createElement(Harness, { docId: "B", liveDocIds: ["B"] }));
    expect(watchers.get("A")!.stop).toHaveBeenCalledTimes(1);
    expect(clearLedgerCalls).toContain("A");
    expect(watchers.get("B")!.stop).not.toHaveBeenCalled(); // B (active) untouched
  });
});
