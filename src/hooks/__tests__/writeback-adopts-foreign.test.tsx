// @vitest-environment jsdom
//
// Task 979 (companion) — the open-time write-back SHOWS what it wrote.
//
// `persistMigrationOnLoad` re-derives its write-back from the in-lock disk read
// (task 719), so a skill commit landing between the mount read and the
// write-back is preserved on disk. But the panel's state stayed at the mount
// read's value, and both I/Os stamp the disk ledger, so the SidecarWatcher never
// reports the change: the agent's card was on disk and invisible until reopen.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";

interface Card {
  id: string;
}
interface Reports {
  cards: Card[];
}
const FILE = "reports.json";
const DOC = "doc-wb";

const disk = new Map<string, unknown>();
/** Runs once, after the mount read resolves and before the write-back's read. */
let betweenReadAndWriteBack: (() => void) | null = null;

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule({
    readSidecar: async (_d: string, f: string, dflt: unknown) =>
      disk.has(f) ? structuredClone(disk.get(f)) : dflt,
    readSidecarIfExists: async (_d: string, f: string) => {
      const v = disk.has(f) ? structuredClone(disk.get(f)) : null;
      const hook = betweenReadAndWriteBack;
      betweenReadAndWriteBack = null;
      // The skill's commit lands AFTER this read returned its snapshot.
      if (hook) queueMicrotask(hook);
      return v;
    },
    writeSidecar: async (_h: unknown, f: string, v: unknown) => {
      disk.set(f, structuredClone(v));
    },
    mutateSidecar: async (
      _h: unknown,
      f: string,
      dflt: unknown,
      mutate: (cur: unknown) => unknown,
    ) => {
      await new Promise((r) => setTimeout(r, 0));
      const cur = disk.has(f) ? structuredClone(disk.get(f)) : dflt;
      const next = mutate(cur);
      if (next === null) return null;
      disk.set(f, structuredClone(next));
      return next;
    },
  }),
);

import { usePersistentState } from "../usePersistentState";
import { beginDocPipeline, __resetForTests } from "@/lib/multi-window/doc-pipeline";

/** A migrator that NORMALIZES (so the write-back has something to write). */
const migrate = (raw: unknown): Reports => {
  const r = raw as { cards?: Card[] };
  return { cards: (r.cards ?? []).map((c) => ({ id: c.id })) };
};

beforeEach(() => {
  disk.clear();
  betweenReadAndWriteBack = null;
  __resetForTests();
});

describe("persistMigrationOnLoad write-back adopts a foreign write", () => {
  it("a card a skill committed between the mount read and the write-back is SHOWN", async () => {
    disk.set(FILE, { cards: [{ id: "a", stray: 1 }] });
    betweenReadAndWriteBack = () => {
      disk.set(FILE, { cards: [{ id: "a", stray: 1 }, { id: "agent" }] });
    };
    beginDocPipeline(DOC);
    const { result } = renderHook(() =>
      usePersistentState<Reports>(DOC, FILE, { cards: [] }, {
        migrate,
        persistMigrationOnLoad: true,
        debounceMs: 0,
      }),
    );
    await waitFor(() =>
      expect(result.current.state.cards.map((c) => c.id)).toEqual(["a", "agent"]),
    );
    expect((disk.get(FILE) as Reports).cards).toEqual([{ id: "a" }, { id: "agent" }]);
  });

  it("the clean path is unchanged: no foreign write → state stays the migration", async () => {
    disk.set(FILE, { cards: [{ id: "a", stray: 1 }] });
    beginDocPipeline(DOC);
    const { result } = renderHook(() =>
      usePersistentState<Reports>(DOC, FILE, { cards: [] }, {
        migrate,
        persistMigrationOnLoad: true,
        debounceMs: 0,
      }),
    );
    await waitFor(() => expect(disk.get(FILE)).toEqual({ cards: [{ id: "a" }] }));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(result.current.state).toEqual({ cards: [{ id: "a" }] });
  });
});
