// @vitest-environment jsdom
//
// Task 603 — `pagehide` fires on every reload, so it may not delete what the
// reload reads; and on a back/forward-cache entry (`persisted`) the window
// must come back owning what it shows, or stop showing it.
//
// Legs:
//   1. RELOAD  — pagehide (persisted false) releases locks but leaves the tab
//                record; a fresh mount (the reload) restores the tabs.
//   2. BFCACHE — pagehide (persisted) then pageshow (persisted) re-claims
//                every shown paper, after the release has finished.
//   3. BFCACHE — a paper a peer took while frozen leaves this window, and
//                activity passes to its neighbour.
//   4. PLAIN   — a non-persisted pageshow (first load) claims nothing extra.
//   5. SWEEP   — mount marks the window alive and sweeps with the live set.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { FsaDocMeta, TabsState } from "@/lib/doc-index";

const meta = (id: string): FsaDocMeta =>
  ({ id, name: id, lastAccessedAt: "2026-01-01T00:00:00Z" }) as FsaDocMeta;

const h = vi.hoisted(() => ({
  docs: [] as unknown[],
  idb: new Map<string, unknown>(),
  owned: new Set<string>(),
  takenByPeer: new Set<string>(),
  log: [] as string[],
  releaseGate: null as Promise<void> | null,
  sweep: vi.fn(async (_o: unknown) => [] as string[]),
  hold: vi.fn(),
}));

// The REAL tab-record code runs, over an in-memory idb-keyval — so a
// pagehide-time deletion of `tabs/w1` would be visible to the reload.
vi.mock("idb-keyval", () => ({
  createStore: () => ({}),
  get: async (k: string) => structuredClone(h.idb.get(k)),
  set: async (k: string, v: unknown) => {
    h.idb.set(k, structuredClone(v));
  },
  del: async (k: string) => {
    h.idb.delete(k);
  },
  keys: async () => [...h.idb.keys()],
  update: async (k: string, fn: (v: unknown) => unknown) => {
    h.idb.set(k, structuredClone(fn(structuredClone(h.idb.get(k)))));
  },
}));
vi.mock("@/lib/storage-mode", () => ({ isDevStorage: false }));
vi.mock("@/lib/storage", () => ({
  listDocs: vi.fn(async () => h.docs),
  createDocFromPicker: vi.fn(),
  createDocInFolder: vi.fn(),
  drainDoc: vi.fn(async () => {}),
  pickProjectFolder: vi.fn(),
  registerDocInFolder: vi.fn(),
  renameDoc: vi.fn(),
  deleteDocFromIndex: vi.fn(async () => {}),
}));
vi.mock("@/lib/doc-index", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/doc-index")>()),
  getDocHandle: vi.fn(async () => undefined),
  sweepTabRecords: h.sweep,
  touchDocAccessed: vi.fn(async () => {}),
}));
vi.mock("@/lib/sync-conflict-scan", () => ({
  watchSyncConflicts: () => () => {},
}));
vi.mock("@library/lib/skill-sync", () => ({ syncSkillBundle: vi.fn() }));
vi.mock("@library/lib/library-folder", () => ({
  resolveLibraryRootPath: vi.fn(async () => null),
}));
vi.mock("@/lib/example-doc/example-seeder", () => ({
  EXAMPLE_DOC_ID: "__example__",
  ExampleUnavailableError: class extends Error {},
  ensureExampleSeeded: vi.fn(),
  resetExample: vi.fn(),
}));
vi.mock("@/lib/fsa-permissions", () => ({
  queryRW: vi.fn(async () => "granted"),
  ensureRW: vi.fn(async () => true),
}));
vi.mock("@/lib/multi-window/window-id", () => ({ getWindowId: () => "w1" }));
vi.mock("@/lib/multi-window/window-liveness", () => ({
  holdWindowLiveness: h.hold,
  liveWindowIds: vi.fn(async () => new Set(["w1", "peer"])),
}));
vi.mock("@/lib/multi-window/doc-ownership", () => ({
  claimDoc: vi.fn(async (id: string) => {
    h.log.push(`claim:${id}`);
    if (h.takenByPeer.has(id)) return { owned: false, currentOwner: "peer" };
    h.owned.add(id);
    return { owned: true };
  }),
  ownsDoc: (id: string) => h.owned.has(id),
  releaseAll: vi.fn(async () => {
    h.log.push("releaseAll:start");
    if (h.releaseGate) await h.releaseGate;
    h.owned.clear();
    h.log.push("releaseAll:done");
  }),
  releaseDoc: vi.fn(async (id: string) => {
    h.owned.delete(id);
  }),
}));
vi.mock("@/lib/multi-window/handoff", () => ({
  claimDocWithHandoff: vi.fn(async () => true),
}));
vi.mock("@/lib/multi-window/bus", () => ({ subscribe: () => () => {} }));
vi.mock("@/components/system-dialog-host", () => ({
  useSystemDialog: () => ({ confirm: vi.fn(), alert: vi.fn() }),
}));

import { useFiles } from "@/hooks/useFiles";
import * as docIndex from "@/lib/doc-index";

async function settle() {
  await act(async () => {
    for (let i = 0; i < 30; i++) await Promise.resolve();
  });
}
async function mount() {
  const r = renderHook(() => useFiles());
  await settle();
  return r;
}
function fire(type: "pagehide" | "pageshow", persisted: boolean) {
  act(() => {
    window.dispatchEvent(new PageTransitionEvent(type, { persisted }));
  });
}

beforeEach(() => {
  h.docs = [meta("a"), meta("b"), meta("c")];
  h.idb = new Map<string, unknown>([
    ["tabs/w1", { openTabIds: ["a", "b", "c"], currentDocId: "b" }],
  ]);
  h.owned = new Set();
  h.takenByPeer = new Set();
  h.log = [];
  h.releaseGate = null;
  h.sweep.mockClear();
  h.hold.mockClear();
});

describe("page lifecycle keeps the window's workspace (task 603)", () => {
  it("RELOAD — pagehide releases locks, keeps the tab record, and the reload restores the tabs", async () => {
    const first = await mount();
    expect(first.result.current.openTabs.map((d) => d.id)).toEqual(["a", "b", "c"]);

    fire("pagehide", false);
    await settle();
    expect(h.log).toContain("releaseAll:done");
    const record = h.idb.get("tabs/w1") as TabsState | undefined;
    expect(record?.openTabIds).toEqual(["a", "b", "c"]);
    expect(record?.currentDocId).toBe("b");
    first.unmount();

    const reloaded = await mount();
    expect(reloaded.result.current.openTabs.map((d) => d.id)).toEqual(["a", "b", "c"]);
    expect(reloaded.result.current.currentDocId).toBe("b");
    reloaded.unmount();
  });

  it("BFCACHE — pageshow(persisted) re-claims every shown paper after the release finishes", async () => {
    const r = await mount();
    let open!: () => void;
    h.releaseGate = new Promise<void>((res) => {
      open = res;
    });
    h.log = [];
    fire("pagehide", true);
    fire("pageshow", true);
    await settle();
    // The re-claim waits for the in-flight release.
    expect(h.log).toEqual(["releaseAll:start"]);
    open();
    await settle();
    expect(h.log).toEqual([
      "releaseAll:start",
      "releaseAll:done",
      "claim:a",
      "claim:b",
      "claim:c",
    ]);
    expect([...h.owned].sort()).toEqual(["a", "b", "c"]);
    expect(r.result.current.openTabs.map((d) => d.id)).toEqual(["a", "b", "c"]);
    expect(r.result.current.currentDocId).toBe("b");
    r.unmount();
  });

  it("BFCACHE — a paper a peer took while frozen leaves, and activity passes on", async () => {
    const r = await mount();
    fire("pagehide", true);
    await settle();
    h.takenByPeer.add("b");
    fire("pageshow", true);
    await settle();
    expect(r.result.current.openTabs.map((d) => d.id)).toEqual(["a", "c"]);
    expect(r.result.current.currentDocId).toBe("c");
    expect(r.result.current.outerOrder).not.toContain("b");
    r.unmount();
  });

  it("PLAIN — a non-persisted pageshow claims nothing", async () => {
    const r = await mount();
    h.log = [];
    fire("pageshow", false);
    await settle();
    expect(h.log).toEqual([]);
    r.unmount();
  });

  it("SWEEP — mount holds the liveness lock and sweeps with the live set", async () => {
    const r = await mount();
    expect(h.hold).toHaveBeenCalledTimes(1);
    expect(h.sweep).toHaveBeenCalledTimes(1);
    expect(h.sweep.mock.calls[0][0]).toEqual({
      liveWindowIds: new Set(["w1", "peer"]),
    });
    expect(docIndex.sweepTabRecords).toBe(h.sweep);
    r.unmount();
  });
});
