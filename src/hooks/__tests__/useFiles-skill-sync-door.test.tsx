// @vitest-environment jsdom
//
// Task 602 — opening a paper was five hand-written sequences and only the
// folder picker's (`activateDoc`) wrote the skill bundle, so a paper reopened
// from Recents, restored on launch, or newly created kept stale cowork skills.
// The sync is now keyed on `currentDocId` (the chokepoint every open funnels
// through) and gated on a LIVE readwrite grant, re-run by the permission gate.
//
// Legs:
//   1. DOORS     — restore, Recents (`openFile`), `createFile` and the picker
//                  each sync the bundle exactly once.
//   2. DEDUP     — re-activating a doc in the same session does not re-sync.
//   3. GRANT     — an ungranted folder is skipped (no prompt, no banner) and
//                  synced once the gate reports the grant.
//   4. NO HANDLE — the dev backend (no directory handle) syncs nothing.
//   5. LEAVE     — close, forget (delete) and a peer's handoff all hand the
//                  active doc to its neighbour — one answer, not two.
//   6. AWAIT     — `selectFileInFolder` awaits activation: a claim failure
//                  rejects the call instead of escaping as an unhandled
//                  rejection, and the pending pick survives it.
//   7. CENSUS    — the auto-sync has ONE caller (the effect), not a per-door copy.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import fs from "node:fs";
import path from "node:path";
import type { FsaDocMeta } from "@/lib/doc-index";
import type { BusEvent } from "@/lib/multi-window/bus";

const meta = (id: string): FsaDocMeta =>
  ({ id, name: id, lastAccessedAt: "2026-01-01T00:00:00Z" }) as FsaDocMeta;

const h = vi.hoisted(() => ({
  docs: [] as unknown[],
  tabs: {} as Record<string, unknown>,
  handles: new Map<string, object>(),
  perm: "granted" as "granted" | "prompt" | "denied",
  claimOk: true as boolean | "throw",
  owned: new Set<string>(),
  busHandlers: [] as Array<(e: unknown) => void>,
  pick: null as unknown,
  syncSkillBundle: vi.fn(),
  releaseDoc: vi.fn(),
}));

vi.mock("@/lib/storage", () => ({
  listDocs: vi.fn(async () => h.docs),
  createDocFromPicker: vi.fn(async (name: string) => ({
    id: name,
    name,
    lastAccessedAt: "2026-01-01T00:00:00Z",
  })),
  createDocInFolder: vi.fn(),
  drainDoc: vi.fn(async () => {}),
  pickProjectFolder: vi.fn(async () => h.pick),
  registerDocInFolder: vi.fn(async (_h: unknown, tex: string) => ({
    id: tex,
    name: tex,
    lastAccessedAt: "2026-01-01T00:00:00Z",
  })),
  renameDoc: vi.fn(),
  deleteDocFromIndex: vi.fn(async () => {}),
}));
vi.mock("@/lib/doc-index", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/doc-index")>()),
  getDocHandle: vi.fn(async (id: string) => h.handles.get(id)),
  readTabs: vi.fn(async () => h.tabs),
  touchDocAccessed: vi.fn(async () => {}),
  sweepTabRecords: vi.fn(async () => []),
  writeTabs: vi.fn(async () => {}),
}));
vi.mock("@/lib/sync-conflict-scan", () => ({
  watchSyncConflicts: () => () => {},
}));
vi.mock("@library/lib/skill-sync", () => ({
  syncSkillBundle: h.syncSkillBundle,
}));
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
  queryRW: vi.fn(async () => h.perm),
  ensureRW: vi.fn(async () => true),
}));
vi.mock("@/lib/multi-window/window-id", () => ({ getWindowId: () => "w1" }));
vi.mock("@/lib/multi-window/doc-ownership", () => ({
  claimDoc: vi.fn(async (id: string) => {
    h.owned.add(id);
    return { owned: true };
  }),
  ownsDoc: (id: string) => h.owned.has(id),
  releaseAll: vi.fn(async () => {}),
  releaseDoc: h.releaseDoc,
}));
vi.mock("@/lib/multi-window/handoff", () => ({
  claimDocWithHandoff: vi.fn(async (t: { id: string }) => {
    if (h.claimOk === "throw") throw new Error("handoff failed");
    if (h.claimOk) h.owned.add(t.id);
    return h.claimOk;
  }),
}));
vi.mock("@/lib/multi-window/bus", () => ({
  subscribe: (fn: (e: unknown) => void) => {
    h.busHandlers.push(fn);
    return () => {
      h.busHandlers = h.busHandlers.filter((x) => x !== fn);
    };
  },
}));
const dialog = { confirm: vi.fn(), alert: vi.fn() };
vi.mock("@/components/system-dialog-host", () => ({
  useSystemDialog: () => dialog,
}));

import { useFiles } from "@/hooks/useFiles";
import { OUTER_LIBRARY_ROOT_ID } from "@/lib/doc-index";

async function settle() {
  await act(async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
  });
}
function syncedIds(): string[] {
  return h.syncSkillBundle.mock.calls.map(
    (c) => (c[0] as { docId: string }).docId,
  );
}
async function mount() {
  const r = renderHook(() => useFiles());
  await settle();
  return r;
}

beforeEach(() => {
  h.docs = [meta("a"), meta("b"), meta("c")];
  h.tabs = { openTabIds: [], currentDocId: null };
  h.handles = new Map(
    ["a", "b", "c", "new", "x.tex", "y.tex"].map((id) => [id, { docId: id }]),
  );
  h.perm = "granted";
  h.claimOk = true;
  h.owned = new Set();
  h.busHandlers = [];
  h.pick = null;
  h.syncSkillBundle.mockReset();
  h.syncSkillBundle.mockResolvedValue({
    synced: false,
    filesWritten: 0,
    version: "1",
  });
  h.releaseDoc.mockReset();
  h.releaseDoc.mockResolvedValue(undefined);
});

describe("skill-bundle sync rides the current-doc edge (task 602)", () => {
  it("DOORS — session restore syncs the restored paper", async () => {
    h.tabs = { openTabIds: ["a"], currentDocId: "a" };
    const { result } = await mount();
    expect(result.current.currentDocId).toBe("a");
    expect(syncedIds()).toEqual(["a"]);
  });

  it("DOORS — a paper reopened from Recents (openFile) syncs", async () => {
    const { result } = await mount();
    await act(() => result.current.openFile("b"));
    await settle();
    expect(result.current.currentDocId).toBe("b");
    expect(syncedIds()).toEqual(["b"]);
  });

  it("DOORS — a brand-new paper (createFile) syncs", async () => {
    const { result } = await mount();
    await act(async () => {
      await result.current.createFile("new");
    });
    await settle();
    expect(result.current.currentDocId).toBe("new");
    expect(syncedIds()).toEqual(["new"]);
  });

  it("DOORS — the folder picker still syncs", async () => {
    h.pick = { handle: {}, texFiles: ["x.tex"] };
    const { result } = await mount();
    await act(async () => {
      await result.current.openExistingFile();
    });
    await settle();
    expect(syncedIds()).toEqual(["x.tex"]);
  });

  it("DEDUP — switching away and back does not re-sync", async () => {
    h.tabs = { openTabIds: ["a"], currentDocId: "a" };
    const { result } = await mount();
    await act(() => result.current.openFile("b"));
    await settle();
    await act(() => result.current.openFile("a"));
    await settle();
    act(() => result.current.activateDocPane("b"));
    await settle();
    expect(result.current.currentDocId).toBe("b");
    expect(syncedIds()).toEqual(["a", "b"]);
  });

  it("GRANT — an ungranted folder is skipped, then synced when the gate grants", async () => {
    h.perm = "prompt";
    h.tabs = { openTabIds: ["a"], currentDocId: "a" };
    const { result } = await mount();
    expect(syncedIds()).toEqual([]);
    expect(result.current.skillSyncError).toBeNull();

    h.perm = "granted";
    act(() => result.current.noteDocAccessGranted());
    await settle();
    expect(syncedIds()).toEqual(["a"]);

    // A second grant signal for an already-synced doc is a no-op.
    act(() => result.current.noteDocAccessGranted());
    await settle();
    expect(syncedIds()).toEqual(["a"]);
  });

  it("NO HANDLE — the dev backend syncs nothing", async () => {
    h.handles = new Map();
    h.tabs = { openTabIds: ["a"], currentDocId: "a" };
    await mount();
    expect(h.syncSkillBundle).not.toHaveBeenCalled();
  });
});

describe("the active doc leaves: one answer (task 602)", () => {
  async function threeOpen() {
    h.tabs = { openTabIds: ["a", "b", "c"], currentDocId: "b" };
    const r = await mount();
    expect(r.result.current.currentDocId).toBe("b");
    return r;
  }

  it("close hands activity to the neighbour", async () => {
    const { result } = await threeOpen();
    act(() => result.current.closeTab("b"));
    expect(result.current.currentDocId).toBe("c");
    expect(result.current.openTabs.map((d) => d.id)).toEqual(["a", "c"]);
    expect(result.current.outerOrder).not.toContain("b");
    expect(h.releaseDoc).toHaveBeenCalledWith("b");
  });

  it("forgetting (delete) the active paper hands activity to the neighbour, not to nothing", async () => {
    const { result } = await threeOpen();
    await act(() => result.current.deleteFile("b"));
    expect(result.current.currentDocId).toBe("c");
    expect(result.current.openTabs.map((d) => d.id)).toEqual(["a", "c"]);
    expect(result.current.outerOrder).not.toContain("b");
    expect(h.releaseDoc).toHaveBeenCalledWith("b");
  });

  it("a peer's handoff hands activity to the neighbour", async () => {
    const { result } = await threeOpen();
    const ev = {
      type: "doc-handoff-request",
      toWindowId: "w1",
      docId: "c",
    } as unknown as BusEvent;
    act(() => result.current.activateDocPane("c"));
    act(() => h.busHandlers.forEach((fn) => fn(ev)));
    expect(result.current.currentDocId).toBe("b");
    expect(result.current.openTabs.map((d) => d.id)).toEqual(["a", "b"]);
    expect(result.current.outerOrder).not.toContain("c");
    expect(result.current.outerOrder[0]).toBe(OUTER_LIBRARY_ROOT_ID);
    expect(h.releaseDoc).toHaveBeenCalledWith("c");
  });

  it("closing a background tab leaves the active doc alone", async () => {
    const { result } = await threeOpen();
    act(() => result.current.closeTab("a"));
    expect(result.current.currentDocId).toBe("b");
  });
});

describe("selectFileInFolder awaits activation (task 602)", () => {
  it("a claim failure rejects the call and keeps the pending pick", async () => {
    h.pick = { handle: {}, texFiles: ["x.tex", "y.tex"] };
    const { result } = await mount();
    await act(async () => {
      await result.current.openExistingFile();
    });
    expect(result.current.pendingFolderPick).not.toBeNull();
    h.claimOk = "throw";
    await act(async () => {
      await expect(
        result.current.selectFileInFolder("y.tex"),
      ).rejects.toThrow("handoff failed");
    });
    expect(result.current.pendingFolderPick).not.toBeNull();
  });
});

describe("census (task 602)", () => {
  it("the auto-sync has one caller — the current-doc effect — plus the manual Re-sync", () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, "../useFiles.ts"),
      "utf8",
    );
    const calls = src.match(/\brunSkillSync\(/g) ?? [];
    expect(calls).toHaveLength(2);
    expect(src).toContain("await runSkillSync(docId);");
    expect(src).toContain("await runSkillSync(docId, { regrant: true });");
    // Every post-claim open goes through admitDoc; no door sets the current
    // doc by hand any more.
    expect(src.match(/\bawait admitDoc\(/g) ?? []).toHaveLength(3);
  });
});
