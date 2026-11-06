// @vitest-environment jsdom
//
// Task 1460 — the paper index is shared by every window, but each window
// rendered it from the snapshot it read at mount. IndexedDB raises no
// `storage` event, so a paper removed, created or renamed in window B stayed
// stale in window A until reload, and opening a removed one claimed its id
// and admitted the stale meta.
//
// Legs:
//   1. DOOR   — `mutateIndex` announces a change it committed, and only one.
//   2. PEER   — a peer's announcement re-reads the index: rows removed,
//               added and renamed in storage show up in `docs`.
//   3. OWN    — this window's own announcement is not re-read.
//   4. OPEN   — a row that vanished while its paper is open here retires the
//               tab (and its claim) rather than leaving it admitted.
//   5. STALE  — opening a Recents row a peer already forgot (no announcement
//               received) claims nothing and drops the row.
//   6. RETURN — the tab-return edge re-reads (announcements missed while
//               frozen/throttled).
//   7. RACE   — a local door that edits `docs` mid-read forces a re-read, so
//               a snapshot older than this window's own write never lands.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { FsaDocMeta } from "@/lib/doc-index";

const meta = (id: string, name = id): FsaDocMeta =>
  ({ id, name, lastAccessedAt: "2026-01-01T00:00:00Z" }) as FsaDocMeta;

const h = vi.hoisted(() => ({
  docs: [] as unknown[],
  listGate: null as Promise<void> | null,
  idb: new Map<string, unknown>(),
  owned: new Set<string>(),
  claims: [] as string[],
  handlers: new Set<(e: unknown) => void>(),
  published: [] as unknown[],
  returnFns: new Set<() => void>(),
}));

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
  listDocs: vi.fn(async () => {
    const snapshot = structuredClone(h.docs);
    if (h.listGate) await h.listGate;
    return snapshot;
  }),
  createDocFromPicker: vi.fn(),
  createDocInFolder: vi.fn(),
  drainDoc: vi.fn(async () => {}),
  pickProjectFolder: vi.fn(),
  registerDocInFolder: vi.fn(),
  renameDoc: vi.fn(async (id: string, name: string) => {
    h.docs = (h.docs as FsaDocMeta[]).map((d) => (d.id === id ? { ...d, name } : d));
  }),
  deleteDocFromIndex: vi.fn(async () => {}),
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
  settleWindowStartup: vi.fn(async () => ({
    identity: { id: "w1", inheritedId: "w1" },
    live: new Set(["w1"]),
  })),
}));
vi.mock("@/lib/multi-window/doc-ownership", () => ({
  claimDoc: vi.fn(async (id: string) => {
    h.claims.push(id);
    h.owned.add(id);
    return { owned: true };
  }),
  ownsDoc: (id: string) => h.owned.has(id),
  releaseAll: vi.fn(async () => h.owned.clear()),
  releaseDoc: vi.fn(async (id: string) => {
    h.owned.delete(id);
  }),
}));
vi.mock("@/lib/multi-window/handoff", () => ({
  claimDocWithHandoff: vi.fn(async (t: { id: string }) => {
    h.claims.push(t.id);
    h.owned.add(t.id);
    return true;
  }),
}));
vi.mock("@/lib/multi-window/bus", () => ({
  subscribe: (fn: (e: unknown) => void) => {
    h.handlers.add(fn);
    return () => h.handlers.delete(fn);
  },
  publish: (e: unknown) => {
    h.published.push(e);
  },
}));
vi.mock("@/lib/tab-hidden", () => ({
  onTabReturn: (fn: () => void) => {
    h.returnFns.add(fn);
    return () => h.returnFns.delete(fn);
  },
}));
vi.mock("@/components/system-dialog-host", () => ({
  useSystemDialog: () => ({ confirm: vi.fn(), alert: vi.fn() }),
}));

import { useFiles } from "@/hooks/useFiles";
import { mutateIndex } from "@/lib/doc-index";
import * as storage from "@/lib/storage";

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
async function announce(windowId: string) {
  act(() => {
    for (const fn of h.handlers) fn({ type: "doc-index-changed", windowId });
  });
  await settle();
}
const ids = (ds: { id: string }[]) => ds.map((d) => d.id);

beforeEach(() => {
  h.docs = [meta("a"), meta("b"), meta("c")];
  h.listGate = null;
  h.idb = new Map<string, unknown>([
    ["tabs/w1", { openTabIds: ["a", "b"], currentDocId: "b" }],
  ]);
  h.owned = new Set();
  h.claims = [];
  h.handlers = new Set();
  h.published = [];
  h.returnFns = new Set();
  vi.mocked(storage.listDocs).mockClear();
});

describe("the index door announces what it committed (task 1460)", () => {
  it("DOOR — a real change publishes doc-index-changed once; a no-op publishes nothing", async () => {
    h.idb.set("index", { docs: [meta("a")] });
    await mutateIndex((idx) => {
      idx.docs.push(meta("z"));
    });
    expect(h.published).toEqual([{ type: "doc-index-changed", windowId: "w1" }]);
    h.published = [];
    await mutateIndex((idx) => {
      const gone = idx.docs.find((d) => d.id === "nope");
      if (gone) gone.name = "x";
    });
    expect(h.published).toEqual([]);
  });
});

describe("a peer's index change reaches this window (task 1460)", () => {
  it("PEER — removed, added and renamed rows all land in docs", async () => {
    const r = await mount();
    expect(ids(r.result.current.docs)).toEqual(["a", "b", "c"]);
    h.docs = [meta("a", "A renamed"), meta("b"), meta("d")];
    await announce("peer");
    expect(ids(r.result.current.docs)).toEqual(["a", "b", "d"]);
    expect(r.result.current.docs[0].name).toBe("A renamed");
    r.unmount();
  });

  it("OWN — this window's own announcement is not re-read", async () => {
    const r = await mount();
    vi.mocked(storage.listDocs).mockClear();
    await announce("w1");
    expect(storage.listDocs).not.toHaveBeenCalled();
    r.unmount();
  });

  it("OPEN — a vanished row open here retires its tab and passes activity on", async () => {
    const r = await mount();
    expect(ids(r.result.current.openTabs)).toEqual(["a", "b"]);
    expect(r.result.current.currentDocId).toBe("b");
    h.docs = [meta("a"), meta("c")];
    await announce("peer");
    expect(ids(r.result.current.openTabs)).toEqual(["a"]);
    expect(r.result.current.currentDocId).toBe("a");
    expect(r.result.current.outerOrder).not.toContain("b");
    expect(h.owned.has("b")).toBe(false);
    r.unmount();
  });

  it("STALE — opening a row a peer already forgot claims nothing and drops it", async () => {
    const r = await mount();
    h.docs = [meta("a"), meta("b")]; // "c" forgotten; announcement missed
    h.claims = [];
    await act(async () => {
      await r.result.current.openFile("c");
    });
    await settle();
    expect(h.claims).toEqual([]);
    expect(ids(r.result.current.docs)).toEqual(["a", "b"]);
    expect(r.result.current.currentDocId).toBe("b");
    r.unmount();
  });

  it("RETURN — the tab-return edge re-reads the index", async () => {
    const r = await mount();
    h.docs = [meta("a"), meta("b"), meta("c"), meta("e")];
    act(() => {
      for (const fn of h.returnFns) fn();
    });
    await settle();
    expect(ids(r.result.current.docs)).toEqual(["a", "b", "c", "e"]);
    r.unmount();
  });

  it("RACE — a local rename mid-read forces a re-read; the stale snapshot never lands", async () => {
    const r = await mount();
    let open!: () => void;
    h.listGate = new Promise<void>((res) => {
      open = res;
    });
    // Peer announcement: the read snapshots the OLD name, then stalls.
    await announce("peer");
    // This window renames "a" meanwhile (storage + local docs).
    await act(async () => {
      void r.result.current.renameFile("a", "Mine");
      for (let i = 0; i < 5; i++) await Promise.resolve();
    });
    h.listGate = null;
    open();
    await settle();
    expect(r.result.current.docs.find((d) => d.id === "a")?.name).toBe("Mine");
    r.unmount();
  });
});
