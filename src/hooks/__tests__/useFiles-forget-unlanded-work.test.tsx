// @vitest-environment jsdom
//
// Task 1616 — forgetting a paper ("Remove from Recents": the start-screen X,
// the + menu, the unreachable-paper gate) ends in `purgeDoc`, which deletes
// the paper's emergency mirror and its unanswered recovery offers: the only
// copy of work that never reached its folder. By task 851's doctrine those
// end only by the user's ANSWER, so the ONE retirement door now asks first.
//
// Legs (real `useFiles.deleteFile` → real handoff door → real emergency
// mirror → real `purgeDoc`, over one in-memory IndexedDB):
//   1. LIVE   — a live mirror slot + Cancel keeps the slot AND the index row.
//   2. LIVE   — the same + confirm deletes both.
//   3. OFFER  — a promoted offer slot, both answers.
//   4. CLEAN  — no mirror, no offer: no dialog, forget stays one click.
//   5. UNREADABLE — a slot that fails validation still counts (fail safe).
//   6. COPY   — the confirm names what is lost and points at Locate folder….
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { FsaDocMeta } from "@/lib/doc-index";

const meta = (id: string, name = id): FsaDocMeta =>
  ({ id, name, lastAccessedAt: "2026-01-01T00:00:00Z" }) as FsaDocMeta;

const h = vi.hoisted(() => ({
  idb: new Map<string, unknown>(),
  answer: false,
  confirms: [] as { title: string; message: string; tone?: string }[],
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
vi.mock("@/lib/storage", async () => {
  const { mutateIndex, purgeDoc } = await import("@/lib/doc-index");
  return {
    listDocs: vi.fn(async () => {
      const idx = h.idb.get("index") as { docs: FsaDocMeta[] } | undefined;
      return structuredClone(idx?.docs ?? []);
    }),
    createDocFromPicker: vi.fn(),
    createDocInFolder: vi.fn(),
    drainDoc: vi.fn(async () => {}),
    pickProjectFolder: vi.fn(),
    registerDocInFolder: vi.fn(),
    renameDoc: vi.fn(),
    // The FSA backend's door, verbatim: drop the row, then purge the id.
    deleteDocFromIndex: vi.fn(async (id: string) => {
      await mutateIndex((idx) => {
        idx.docs = idx.docs.filter((d) => d.id !== id);
      });
      await purgeDoc(id);
    }),
  };
});
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
// No peer holds anything: the door's first refusal never fires, so every
// question asked here is the second one.
vi.mock("@/lib/multi-window/doc-ownership", () => ({
  claimDoc: vi.fn(async () => ({ owned: true })),
  ownsDoc: () => true,
  releaseAll: vi.fn(async () => {}),
  releaseDoc: vi.fn(async () => {}),
  requestHandoff: vi.fn(async () => true),
  withDocIfUnclaimed: async <T,>(_id: string, fn: () => Promise<T>) => ({
    ran: true as const,
    value: await fn(),
  }),
}));
vi.mock("@/lib/multi-window/bus", () => ({
  subscribe: () => () => {},
  publish: () => {},
}));
vi.mock("@/lib/tab-hidden", () => ({ onTabReturn: () => () => {} }));
vi.mock("@/components/system-dialog-host", () => {
  const api = {
    confirm: async (opts: { title: string; message: string; tone?: string }) => {
      h.confirms.push(opts);
      return h.answer;
    },
    alert: async () => {},
  };
  return { useSystemDialog: () => api };
});

import { useFiles } from "@/hooks/useFiles";
import {
  readMirror,
  writeMirror,
  openMirrorRecovery,
  readNextMirrorOffer,
  type EmergencyMirrorEntry,
} from "@/lib/emergency-mirror";

const entry = (docId: string, hash = "h-unlanded"): EmergencyMirrorEntry => ({
  docId,
  content: { type: "doc", content: [] },
  savedAt: Date.now(),
  lastLandedAt: null,
  reason: null,
  windowId: "w1",
  hash,
});

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
async function forget(r: Awaited<ReturnType<typeof mount>>, id: string) {
  let out = false;
  await act(async () => {
    out = await r.result.current.deleteFile(id);
  });
  return out;
}
const indexIds = () =>
  ((h.idb.get("index") as { docs: FsaDocMeta[] }).docs ?? []).map((d) => d.id);

beforeEach(() => {
  h.idb = new Map<string, unknown>([
    ["index", { docs: [meta("x", "Paper X"), meta("y")] }],
    ["tabs/w1", { openTabIds: [], currentDocId: null }],
  ]);
  h.answer = false;
  h.confirms = [];
});

describe("forgetting a paper asks before deleting unlanded work (task 1616)", () => {
  it("LIVE — Cancel keeps the mirror and the paper", async () => {
    await writeMirror(entry("x"));
    const r = await mount();
    h.answer = false;
    expect(await forget(r, "x")).toBe(false);
    expect(h.confirms).toHaveLength(1);
    expect(await readMirror("x")).not.toBeNull();
    expect(indexIds()).toContain("x");
    expect(r.result.current.docs.map((d) => d.id)).toContain("x");
    r.unmount();
  });

  it("LIVE — confirming deletes the mirror and forgets the paper", async () => {
    await writeMirror(entry("x"));
    const r = await mount();
    h.answer = true;
    expect(await forget(r, "x")).toBe(true);
    expect(await readMirror("x")).toBeNull();
    expect(indexIds()).not.toContain("x");
    r.unmount();
  });

  it("OFFER — a promoted, unanswered offer is guarded the same way", async () => {
    await writeMirror(entry("x"));
    // The open path promotes the live slot to an offer (task 851).
    expect(await openMirrorRecovery("x", "h-loaded")).not.toBeNull();
    expect(await readMirror("x")).toBeNull();
    const r = await mount();
    h.answer = false;
    expect(await forget(r, "x")).toBe(false);
    expect(await readNextMirrorOffer("x")).not.toBeNull();
    expect(indexIds()).toContain("x");
    h.answer = true;
    expect(await forget(r, "x")).toBe(true);
    expect(await readNextMirrorOffer("x")).toBeNull();
    expect(indexIds()).not.toContain("x");
    r.unmount();
  });

  it("CLEAN — nothing unlanded: no dialog, one click forgets", async () => {
    await writeMirror(entry("y")); // another paper's work is not this one's
    const r = await mount();
    expect(await forget(r, "x")).toBe(true);
    expect(h.confirms).toHaveLength(0);
    expect(indexIds()).not.toContain("x");
    expect(await readMirror("y")).not.toBeNull();
    r.unmount();
  });

  it("UNREADABLE — a slot that fails validation still counts as unlanded work", async () => {
    h.idb.set("emergency-mirror/x", { garbage: true });
    const r = await mount();
    expect(await forget(r, "x")).toBe(false);
    expect(h.confirms).toHaveLength(1);
    expect(h.idb.has("emergency-mirror/x")).toBe(true);
    r.unmount();
  });

  it("COPY — the confirm is danger-toned, names the loss and the way to keep it", async () => {
    await writeMirror(entry("x"));
    const r = await mount();
    await forget(r, "x");
    const c = h.confirms[0];
    expect(c.tone).toBe("danger");
    expect(c.message).toContain("Paper X");
    expect(c.message).toMatch(/unsaved changes/);
    expect(c.message).toMatch(/Locate folder…/);
    r.unmount();
  });
});
