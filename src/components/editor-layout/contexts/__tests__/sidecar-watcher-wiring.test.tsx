// @vitest-environment jsdom
/**
 * The SIDECAR WATCHER IS MOUNTED — end to end (task 432).
 *
 * Every prior suite drove ONE piece: `sidecar-watcher.test.ts` the poller
 * alone, `usePersistentState.test.tsx` the consumer on a HAND-DISPATCHED
 * event, and `disk-watcher-multidoc.test.tsx` the provider with the sidecar
 * watcher MOCKED OUT. So "an external edit to `virgil/*.json` re-hydrates the
 * panel" was pinned by no leg at all — which is what let task 415's worker
 * file "built, tested, and MOUNTED NOWHERE" about a watcher the provider had
 * mounted since 2026-06-30 (its file was binary to grep; see
 * `source-text-hygiene.test.ts`), and what let that filing turn into a
 * decision Gabriel was asked to make.
 *
 * This leg is the chain: REAL `DiskWatcherProvider` → REAL
 * `createSidecarWatcher` (real disk ledger, fake timers) → REAL
 * `usePersistentState`, over an in-memory fake of `@/lib/storage`. An
 * out-of-band writer changes the bytes; the next poll must re-hydrate.
 *
 * Deliberately NOT a test of the poller's classifier (prime / create /
 * remove / false-positive — those live in `sidecar-watcher.test.ts`); this
 * asks only whether the pieces are WIRED.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React, { type ReactNode } from "react";
import { renderHook, act, cleanup } from "@testing-library/react";

// ── In-memory disk ─────────────────────────────────────────────────────────
type Stat = { mtimeMs: number; size: number };
const disk = new Map<string, { text: string; stat: Stat }>();
let clock = 1_000;
function key(docId: string, relPath: string) {
  return `${docId}/${relPath}`;
}
/** An OUT-OF-BAND writer: bumps mtime + size like a real filesystem. */
function externalWrite(docId: string, relPath: string, text: string) {
  clock += 1_000;
  disk.set(key(docId, relPath), { text, stat: { mtimeMs: clock, size: text.length } });
}
let sidecarReads = 0;

vi.mock("@/lib/storage", () => ({
  statFiles: async (docId: string, relPaths: string[]) => {
    const out: Record<string, Stat | null> = {};
    for (const r of relPaths) out[r] = disk.get(key(docId, r))?.stat ?? null;
    return out;
  },
  readTextFile: async (docId: string, relPath: string) =>
    disk.get(key(docId, relPath))?.text ?? null,
  getTexFilename: () => "main.tex",
  getBibFilename: async () => "references.bib",
  invalidateSidecarBundle: () => {},
  readSidecarIfExists: async (docId: string, filename: string) => {
    sidecarReads++;
    const e = disk.get(key(docId, `virgil/${filename}`));
    return e ? JSON.parse(e.text) : null;
  },
  readSidecar: async (docId: string, filename: string) => {
    const e = disk.get(key(docId, `virgil/${filename}`));
    return e ? JSON.parse(e.text) : null;
  },
  writeSidecar: async () => {},
}));

import { DiskWatcherProvider } from "../disk-watcher";
import { usePersistentState } from "@/hooks/usePersistentState";
import { __resetDiskLedgerForTests } from "@/lib/disk-ledger";
import { beginDocPipeline, __resetForTests } from "@/lib/multi-window/doc-pipeline";
import { ALL_SIDECAR_FILENAMES } from "@/lib/sidecar-files";

interface Shape {
  items: string[];
}
const EMPTY: Shape = { items: [] };
const DOC = "doc-wired";
const FILE = "notes.json";
const REL = `virgil/${FILE}`;

function wrapper({ children }: { children: ReactNode }) {
  return React.createElement(DiskWatcherProvider, { docId: DOC, children });
}

/** One watcher poll = the 3 s cadence plus the awaited stat/read microtasks. */
async function pollOnce() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(3_000);
  });
  await flush();
}
/** Drain the async read → setState chain (RTL's waitFor and vitest's fake
 *  timers do not cooperate, so the settle is explicit). */
async function flush() {
  for (let i = 0; i < 8; i++) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  disk.clear();
  clock = 1_000;
  sidecarReads = 0;
  __resetDiskLedgerForTests();
  __resetForTests();
  beginDocPipeline(DOC);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("DiskWatcherProvider mounts the sidecar watcher (task 432)", () => {
  it("the watched set is every sidecar Virgil reads at mount", () => {
    // A sanity pin for the leg below: notes.json is in the population the
    // provider hands the watcher, so a change to it is reachable.
    expect(ALL_SIDECAR_FILENAMES).toContain(FILE);
  });

  it("an external sidecar write re-hydrates the REAL usePersistentState on the next poll, with no reload and no hand-dispatched event", async () => {
    externalWrite(DOC, REL, JSON.stringify({ items: ["initial"] }));
    const { result } = renderHook(
      () => usePersistentState<Shape>(DOC, FILE, EMPTY),
      { wrapper },
    );
    // Mount: the hook's own load + the watcher's PRIME pass (baseline, no emit).
    await pollOnce();
    expect(result.current.state.items).toEqual(["initial"]);
    const readsAfterMount = sidecarReads;

    // A quiet poll re-reads nothing (the cheap mtime/size path).
    await pollOnce();
    expect(sidecarReads).toBe(readsAfterMount);
    expect(result.current.state.items).toEqual(["initial"]);

    // An /editor/* skill (or a sync daemon) writes the file out of process.
    externalWrite(DOC, REL, JSON.stringify({ items: ["initial", "ai-drafted"] }));
    await pollOnce();

    expect(result.current.state.items).toEqual(["initial", "ai-drafted"]);
    expect(sidecarReads).toBe(readsAfterMount + 1);
  });

  it("an external REMOVAL empties the panel to its default", async () => {
    externalWrite(DOC, REL, JSON.stringify({ items: ["gone-soon"] }));
    const { result } = renderHook(
      () => usePersistentState<Shape>(DOC, FILE, EMPTY),
      { wrapper },
    );
    await pollOnce();
    expect(result.current.state.items).toEqual(["gone-soon"]);

    disk.delete(key(DOC, REL));
    await pollOnce();

    expect(result.current.state.items).toEqual([]);
  });
});
