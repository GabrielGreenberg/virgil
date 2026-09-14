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
let sidecarWrites = 0;
/** Task 569: when set, the fake `writeSidecar` HOLDS its write open on this
 *  promise — the in-flight window a real FSA write spends in the per-file
 *  queue, the doc lock and the `createWritable` + rename. */
let writeGate: Promise<void> | null = null;

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
  /**
   * Virgil's OWN write, shaped like the real funnel (`writeTrackedText`): the
   * bytes land with a fresh mtime AND the disk ledger is re-baselined to them
   * (`stampLedger`) — which is exactly what makes a deferred external change
   * unrecoverable: the watcher's next poll compares disk against OUR
   * fingerprint and takes the cheap path. A fake that skipped the stamp would
   * re-emit on the next poll and pass the task-569 legs for the wrong reason.
   */
  writeSidecar: async (h: { docId: string }, filename: string, value: unknown) => {
    sidecarWrites++;
    if (writeGate) await writeGate;
    const text = JSON.stringify(value);
    const relPath = `virgil/${filename}`;
    clock += 1_000;
    const stat = { mtimeMs: clock, size: text.length };
    disk.set(key(h.docId, relPath), { text, stat });
    const { stampDiskFingerprint, fingerprintOf } = await import("@/lib/disk-ledger");
    stampDiskFingerprint(h.docId, relPath, fingerprintOf(stat, text));
  },
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
  sidecarWrites = 0;
  writeGate = null;
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

/**
 * Task 569 — what a DEFERRAL means, driven through the REAL watcher.
 *
 * The hook defers an external change while it holds a pending write. The task
 * that filed 569 asked that "the next poll re-emits once clean" be VERIFIED
 * with a leg rather than assumed. Verified: it does NOT. The watcher
 * re-baselines its ledger to the external bytes BEFORE it emits; our landed
 * whole-snapshot write then re-baselines it again to OURS; the next poll is a
 * cheap mtime/size match and emits nothing. A deferral is therefore LOCAL WINS
 * for that file — the external bytes are overwritten, which is the 220/558
 * two-writers class every non-merging sidecar still carries. These legs pin
 * that truth, and the in-flight one is the 569 defect end to end: pre-569 the
 * hook adopted the external bytes in memory while its own write landed the
 * local ones on disk.
 */
describe("a deferral is LOCAL WINS, and the watcher does not re-emit (task 569)", () => {
  const disktext = () => disk.get(key(DOC, REL))?.text ?? "";

  it("MID-DEBOUNCE: the external bytes are overwritten by the landed local write; no later poll re-reads", async () => {
    externalWrite(DOC, REL, JSON.stringify({ items: ["initial"] }));
    // 5 s debounce so the 3 s poll lands while the timer is still ARMED.
    const { result } = renderHook(
      () => usePersistentState<Shape>(DOC, FILE, EMPTY, { debounceMs: 5_000 }),
      { wrapper },
    );
    await pollOnce(); // prime
    expect(result.current.state.items).toEqual(["initial"]);
    const readsAfterMount = sidecarReads;

    act(() => {
      result.current.update((prev) => ({ items: [...prev.items, "local-edit"] }));
    });
    externalWrite(DOC, REL, JSON.stringify({ items: ["initial", "external-only"] }));
    await pollOnce(); // the watcher emits; the hook is dirty → defers
    expect(sidecarReads).toBe(readsAfterMount);
    expect(result.current.state.items).toEqual(["initial", "local-edit"]);

    // The debounce fires (t+5 s) and the local snapshot LANDS over the external bytes.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    await flush();
    expect(sidecarWrites).toBe(1);
    expect(disktext()).toContain("local-edit");
    expect(disktext()).not.toContain("external-only");

    // Two more polls: nothing re-reads, nothing re-emits. Memory = disk = local.
    await pollOnce();
    await pollOnce();
    expect(sidecarReads).toBe(readsAfterMount);
    expect(result.current.state.items).toEqual(["initial", "local-edit"]);
  });

  it("IN FLIGHT (the 569 defect): an external change polled while the write is held open is deferred — memory and disk agree on the LOCAL edit afterwards", async () => {
    externalWrite(DOC, REL, JSON.stringify({ items: ["initial"] }));
    const { result } = renderHook(
      () => usePersistentState<Shape>(DOC, FILE, EMPTY, { debounceMs: 1_000 }),
      { wrapper },
    );
    await pollOnce(); // prime
    expect(result.current.state.items).toEqual(["initial"]);
    const readsAfterMount = sidecarReads;

    let release!: () => void;
    writeGate = new Promise<void>((r) => {
      release = r;
    });
    act(() => {
      result.current.update((prev) => ({ items: [...prev.items, "local-edit"] }));
    });
    // The debounce fires: the timer handle is NULL and the write is IN FLIGHT.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(sidecarWrites).toBe(1);
    expect(disktext()).not.toContain("local-edit"); // not landed yet

    // An out-of-band writer lands inside the window; the watcher confirms it.
    externalWrite(DOC, REL, JSON.stringify({ items: ["initial", "external-only"] }));
    await pollOnce();
    // Pre-569: both guard reads passed, the hook adopted the external bytes.
    expect(sidecarReads, "the re-read was deferred").toBe(readsAfterMount);
    expect(result.current.state.items).toEqual(["initial", "local-edit"]);

    // Release the write; it lands the LOCAL snapshot over the external bytes.
    await act(async () => {
      release();
      await writeGate;
    });
    await flush();
    expect(disktext()).toContain("local-edit");
    expect(disktext()).not.toContain("external-only");

    // No re-emit, no re-read; memory and disk agree.
    await pollOnce();
    expect(sidecarReads).toBe(readsAfterMount);
    expect(result.current.state.items).toEqual(["initial", "local-edit"]);
  });

  it("CONTROL: a LATER external write, after the in-flight write has settled, still re-hydrates", async () => {
    externalWrite(DOC, REL, JSON.stringify({ items: ["initial"] }));
    const { result } = renderHook(
      () => usePersistentState<Shape>(DOC, FILE, EMPTY, { debounceMs: 1_000 }),
      { wrapper },
    );
    await pollOnce();
    let release!: () => void;
    writeGate = new Promise<void>((r) => {
      release = r;
    });
    act(() => {
      result.current.update((prev) => ({ items: [...prev.items, "local-edit"] }));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    await act(async () => {
      release();
      await writeGate;
    });
    writeGate = null;
    await flush();
    expect(disktext()).toContain("local-edit");

    externalWrite(DOC, REL, JSON.stringify({ items: ["initial", "local-edit", "later-external"] }));
    await pollOnce();
    expect(result.current.state.items).toEqual(["initial", "local-edit", "later-external"]);
  });
});
