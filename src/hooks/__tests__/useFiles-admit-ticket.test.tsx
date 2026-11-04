// @vitest-environment jsdom
//
// Task 1463 — an open door claims the paper, then `admitDoc` awaits the
// OUTGOING doc's drain before showing it. In that gap the paper can leave this
// window: a peer's confirmed "Move it here" (`doc-handoff-request`) retires it
// and releases the lock. Admitting afterwards made the paper current in a
// window that no longer held it. Every retirement now bumps the paper's
// epoch; the door's ticket, taken before the claim, is re-validated after the
// drain, and a retirement since wins.
//
// Legs:
//   1. HANDOFF — a handoff request mid-drain: the paper is not admitted.
//   2. CLOSE   — closing the opening paper mid-drain: same door, same answer.
//   3. CONTROL — no retirement: the paper is admitted as before.
//   4. REOPEN  — a ticket taken AFTER a retirement is valid (a reopen after a
//                close still opens).
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

const tabIds = (r: { result: { current: { openTabs: { id: string }[] } } }) =>
  r.result.current.openTabs.map((d) => d.id);

let releaseDrain: () => void = () => {};
function holdDrainOf(id: string) {
  const gate = new Promise<void>((r) => (releaseDrain = r));
  vi.mocked(storage.drainDoc).mockImplementation(async (d: string) => {
    if (d === id) await gate;
  });
}
async function handoffRequest(docId: string) {
  act(() => {
    for (const fn of h.handlers) {
      fn({ type: "doc-handoff-request", docId, toWindowId: "w1", fromWindowId: "peer" });
    }
  });
  await settle();
}

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
  vi.mocked(storage.drainDoc).mockReset();
  vi.mocked(storage.drainDoc).mockImplementation(async () => {});
});

describe("a paper retired between claim and admit is not admitted (task 1463)", () => {
  it("HANDOFF — a peer's handoff request during the outgoing drain wins", async () => {
    const r = await mount();
    expect(r.result.current.currentDocId).toBe("b");
    holdDrainOf("b");
    let opening!: Promise<void>;
    act(() => {
      opening = r.result.current.openFile("c");
    });
    await settle();
    expect(h.owned.has("c")).toBe(true);
    await handoffRequest("c");
    expect(h.owned.has("c")).toBe(false);
    await act(async () => {
      releaseDrain();
      await opening;
    });
    await settle();
    expect(tabIds(r)).not.toContain("c");
    expect(r.result.current.currentDocId).toBe("b");
    r.unmount();
  });

  it("CLOSE — closing the opening paper during the drain wins the same way", async () => {
    const r = await mount();
    holdDrainOf("b");
    let opening!: Promise<void>;
    act(() => {
      opening = r.result.current.openFile("c");
    });
    await settle();
    act(() => r.result.current.closeTab("c"));
    await act(async () => {
      releaseDrain();
      await opening;
    });
    await settle();
    expect(tabIds(r)).not.toContain("c");
    expect(r.result.current.currentDocId).toBe("b");
    expect(h.owned.has("c")).toBe(false);
    r.unmount();
  });

  it("CONTROL — with no retirement the paper is admitted", async () => {
    const r = await mount();
    holdDrainOf("b");
    let opening!: Promise<void>;
    act(() => {
      opening = r.result.current.openFile("c");
    });
    await settle();
    await act(async () => {
      releaseDrain();
      await opening;
    });
    await settle();
    expect(tabIds(r)).toContain("c");
    expect(r.result.current.currentDocId).toBe("c");
    expect(h.owned.has("c")).toBe(true);
    r.unmount();
  });

  it("REOPEN — a ticket taken after a retirement is valid", async () => {
    const r = await mount();
    act(() => r.result.current.closeTab("a"));
    await settle();
    expect(tabIds(r)).not.toContain("a");
    await act(async () => {
      await r.result.current.openFile("a");
    });
    await settle();
    expect(tabIds(r)).toContain("a");
    expect(r.result.current.currentDocId).toBe("a");
    r.unmount();
  });
});
