// @vitest-environment jsdom
//
// W2a (T2 §3c) — the durable orphaned-footnotes sidecar.
//
// Pre-fix, orphaned-footnote state lived only in volatile EditorLayout shell
// `useState`, so it was lost on reload (FN-A2-01 DATA-LOSS) and bled across
// documents (FN-A2-03). `useOrphanedFootnotes(docId)` moves it to a per-doc
// sidecar (`orphaned-footnotes.json`, version 1) built on `usePersistentState`,
// inheriting load / debounced-persist / docId-reset / read-only-no-op /
// absent-file-migrate.
//
// These pins: (1) persist+reload round-trip survives; (2) a docId switch resets
// to empty (no bleed); (3) with no active write pipeline (Library Reader) a
// write is a no-op; (4) an absent file starts empty and a legacy version-less /
// bare-array shape migrates to { version: 1, orphans }.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

// Per-test on-disk fixture. `readSidecarIfExists` returns null when the file is
// absent (the migrate path); a value drives the reload / legacy-shape tests.
// Writes are captured so durability + read-only-no-op can be asserted.
let DISK: unknown = null;
const writes: Array<{ docId: string; filename: string; data: unknown }> = [];

vi.mock("@/lib/storage", () => ({
  readSidecar: vi.fn(async (_docId: string, _file: string, dflt: unknown) => dflt),
  readSidecarIfExists: vi.fn(async () => DISK),
  writeSidecar: vi.fn(async (h: { docId: string }, filename: string, data: unknown) => {
    writes.push({ docId: h.docId, filename, data });
  }),
}));

import { useOrphanedFootnotes } from "../useOrphanedFootnotes";
import { beginDocPipeline, endDocPipeline, __resetForTests } from "@/lib/multi-window/doc-pipeline";
import type { OrphanedFootnote, OrphanedFootnotesState } from "@/lib/types";

function orphan(id: string, text: string, extra?: Partial<OrphanedFootnote>): OrphanedFootnote {
  return {
    footnoteId: id,
    content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] },
    orphanedAt: "2026-06-17T00:00:00.000Z",
    ...extra,
  };
}

beforeEach(() => {
  __resetForTests();
  DISK = null;
  writes.length = 0;
});

describe("useOrphanedFootnotes — durable per-doc sidecar (FN-A2-01, FN-A2-03)", () => {
  it("persists an orphan and survives a reload round-trip (FN-A2-01)", async () => {
    beginDocPipeline("doc-fn");
    const { result, unmount } = renderHook(() => useOrphanedFootnotes("doc-fn"));
    await waitFor(() => expect(result.current.loaded).toBe(true));

    act(() => {
      result.current.upsertOrphan(orphan("f007", "methodology note", { title: "Method", thanks: true }));
    });
    expect(result.current.orphans).toHaveLength(1);

    // The debounced write (300ms idle) eventually lands the durable record.
    await waitFor(() => {
      const w = writes.find((w) => w.docId === "doc-fn");
      expect(w).toBeTruthy();
      expect((w!.data as OrphanedFootnotesState).orphans).toHaveLength(1);
    });
    const lastWrite = writes.at(-1)!;
    expect(lastWrite.filename).toBe("orphaned-footnotes.json");
    expect((lastWrite.data as OrphanedFootnotesState).version).toBe(1);
    expect((lastWrite.data as OrphanedFootnotesState).orphans[0].thanks).toBe(true);

    unmount();

    // Simulate a reload: the sidecar now holds the persisted state. A fresh
    // hook reads it back.
    DISK = lastWrite.data;
    const { result: reloaded } = renderHook(() => useOrphanedFootnotes("doc-fn"));
    await waitFor(() => {
      expect(reloaded.current.orphans).toHaveLength(1);
    });
    expect(reloaded.current.orphans[0].footnoteId).toBe("f007");
    expect(reloaded.current.orphans[0].title).toBe("Method");
    expect(reloaded.current.orphans[0].thanks).toBe(true);
  });

  it("resets to empty on a docId switch — no cross-doc bleed (FN-A2-03)", async () => {
    beginDocPipeline("doc-A");
    beginDocPipeline("doc-B");

    const { result, rerender } = renderHook(
      ({ id }: { id: string }) => useOrphanedFootnotes(id),
      { initialProps: { id: "doc-A" } },
    );
    await waitFor(() => expect(result.current.loaded).toBe(true));

    act(() => {
      result.current.upsertOrphan(orphan("f1", "doc-A note"));
    });
    expect(result.current.orphans).toHaveLength(1);

    // Switch documents. doc-B has no sidecar (DISK stays null) → empty.
    rerender({ id: "doc-B" });
    await waitFor(() => {
      expect(result.current.loaded).toBe(true);
      expect(result.current.orphans).toHaveLength(0);
    });

    // doc-A's orphan was NOT written into doc-B's sidecar.
    const bWrites = writes.filter((w) => w.docId === "doc-B");
    for (const w of bWrites) {
      expect((w.data as OrphanedFootnotesState).orphans).toHaveLength(0);
    }
  });

  it("resets to empty when docId becomes null without writing", async () => {
    beginDocPipeline("doc-null");
    const { result, rerender } = renderHook(
      ({ id }: { id: string | null }) => useOrphanedFootnotes(id),
      { initialProps: { id: "doc-null" as string | null } },
    );
    await waitFor(() => expect(result.current.loaded).toBe(true));
    act(() => {
      result.current.upsertOrphan(orphan("fx", "x"));
    });
    rerender({ id: null });
    await waitFor(() => {
      expect(result.current.orphans).toHaveLength(0);
    });
  });

  it("is a no-op write under a read-only doc (no active pipeline / Library Reader)", async () => {
    // No beginDocPipeline → getActiveHandle returns null → persist no-ops.
    const { result } = renderHook(() => useOrphanedFootnotes("doc-readonly"));
    await waitFor(() => expect(result.current.loaded).toBe(true));

    act(() => {
      result.current.upsertOrphan(orphan("f1", "should not persist"));
    });
    // State updates in-React (the panel can still show it this session)...
    expect(result.current.orphans).toHaveLength(1);

    // ...but nothing is written to disk (no active write handle).
    await new Promise((r) => setTimeout(r, 400));
    expect(writes.filter((w) => w.docId === "doc-readonly")).toHaveLength(0);
  });

  it("starts empty when the sidecar file is absent (absent-file migrate)", async () => {
    DISK = null; // file does not exist
    beginDocPipeline("doc-absent");
    const { result } = renderHook(() => useOrphanedFootnotes("doc-absent"));
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.orphans).toEqual([]);
    // An absent file must NOT trigger a migration write-back (readSidecarIfExists
    // returned null → usePersistentState skips setState + the migration persist).
    await new Promise((r) => setTimeout(r, 400));
    expect(writes.filter((w) => w.docId === "doc-absent")).toHaveLength(0);
  });

  it("migrates a legacy bare-array shape to { version: 1, orphans }", async () => {
    // Legacy on-disk shape: a bare array (pre-versioned). It should load and
    // self-stamp version 1 on the migration write-back.
    DISK = [
      { footnoteId: "fa", content: "<p>legacy html body</p>", orphanedAt: "2026-01-01T00:00:00.000Z" },
    ];
    beginDocPipeline("doc-legacy-arr");
    const { result } = renderHook(() => useOrphanedFootnotes("doc-legacy-arr"));
    await waitFor(() => {
      expect(result.current.orphans).toHaveLength(1);
    });
    expect(result.current.orphans[0].footnoteId).toBe("fa");
    // The legacy HTML-string body upgraded to TipTap JSON (a doc node).
    expect((result.current.orphans[0].content as { type?: string }).type).toBe("doc");

    // persistMigrationOnLoad stamped version 1 on disk.
    await waitFor(() => {
      const w = writes.find((w) => w.docId === "doc-legacy-arr");
      expect(w).toBeTruthy();
      expect((w!.data as OrphanedFootnotesState).version).toBe(1);
      expect((w!.data as OrphanedFootnotesState).orphans).toHaveLength(1);
    });
  });

  it("migrates a legacy version-less { orphans } object to version 1", async () => {
    DISK = { orphans: [orphan("fb", "no version field")] };
    beginDocPipeline("doc-legacy-obj");
    const { result } = renderHook(() => useOrphanedFootnotes("doc-legacy-obj"));
    await waitFor(() => {
      expect(result.current.orphans).toHaveLength(1);
    });
    expect(result.current.orphans[0].footnoteId).toBe("fb");
  });

  it("upsert is idempotent — re-upserting an id replaces in place (no duplicate key)", async () => {
    beginDocPipeline("doc-upsert");
    const { result } = renderHook(() => useOrphanedFootnotes("doc-upsert"));
    await waitFor(() => expect(result.current.loaded).toBe(true));
    act(() => {
      result.current.upsertOrphan(orphan("f007", "first"));
    });
    act(() => {
      result.current.upsertOrphan(orphan("f007", "second"));
    });
    expect(result.current.orphans).toHaveLength(1);
    expect((result.current.orphans[0].content as { content: { content: { text: string }[] }[] }).content[0].content[0].text)
      .toBe("second");
  });

  it("clearOrphan / editOrphanContent / editOrphanTitle mutate the right record", async () => {
    beginDocPipeline("doc-edit");
    const { result } = renderHook(() => useOrphanedFootnotes("doc-edit"));
    await waitFor(() => expect(result.current.loaded).toBe(true));
    act(() => {
      result.current.upsertOrphan(orphan("f1", "one"));
    });
    act(() => {
      result.current.upsertOrphan(orphan("f2", "two"));
    });
    act(() => {
      result.current.editOrphanTitle("f1", "Edited title");
    });
    act(() => {
      result.current.editOrphanContent("f2", { type: "doc", content: [] });
    });
    act(() => {
      result.current.clearOrphan("f1");
    });
    // f1 title edit then clear → gone; f2 content edited → present.
    expect(result.current.orphans.map((o) => o.footnoteId)).toEqual(["f2"]);
    expect((result.current.orphans[0].content as { content: unknown[] }).content).toEqual([]);
  });

  it("the array-shaped setOrphanedFootnotes setter is a drop-in for the legacy consumers", async () => {
    beginDocPipeline("doc-setter");
    const { result } = renderHook(() => useOrphanedFootnotes("doc-setter"));
    await waitFor(() => expect(result.current.loaded).toBe(true));
    // Functional updater form (what useFootnoteSyncBridges / useOrphanActions use).
    act(() => {
      result.current.setOrphanedFootnotes((prev) => [...prev, orphan("fz", "z")]);
    });
    expect(result.current.orphans).toHaveLength(1);
    act(() => {
      result.current.setOrphanedFootnotes((prev) => prev.filter((o) => o.footnoteId !== "fz"));
    });
    expect(result.current.orphans).toHaveLength(0);
  });
});

// Quiet the unused import lint if endDocPipeline isn't referenced in a path
// above (kept available for symmetry with the pipeline lifecycle).
void endDocPipeline;
