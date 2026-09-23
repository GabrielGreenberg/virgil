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
  /**
   * The sidecar hook's write door since task 719: the read runs INSIDE the
   * write's critical section, so it sees whatever an out-of-band writer landed
   * while this write sat in the queue. `writeGate` is awaited BEFORE the read
   * for exactly that reason — the gate models the queued task being held, and
   * the read is the first thing the task does when it finally runs.
   */
  mutateSidecar: async (
    h: { docId: string },
    filename: string,
    defaultValue: unknown,
    mutate: (current: unknown) => unknown,
  ) => {
    sidecarWrites++;
    if (writeGate) await writeGate;
    const relPath = `virgil/${filename}`;
    const existing = disk.get(key(h.docId, relPath));
    const current = existing ? JSON.parse(existing.text) : defaultValue;
    const next = mutate(current);
    if (next === null) return null;
    const text = JSON.stringify(next);
    clock += 1_000;
    const stat = { mtimeMs: clock, size: text.length };
    disk.set(key(h.docId, relPath), { text, stat });
    const { stampDiskFingerprint, fingerprintOf } = await import("@/lib/disk-ledger");
    stampDiskFingerprint(h.docId, relPath, fingerprintOf(stat, text));
    return next;
  },
}));

import { DiskWatcherProvider } from "../disk-watcher";
import { usePersistentState } from "@/hooks/usePersistentState";
import { __resetDiskLedgerForTests } from "@/lib/disk-ledger";
import { beginDocPipeline, __resetForTests } from "@/lib/multi-window/doc-pipeline";
import { ALL_SIDECAR_FILENAMES } from "@/lib/sidecar-files";

interface Shape {
  words: string[];
}
const EMPTY: Shape = { words: [] };
const DOC = "doc-wired";
// A file whose record collection is DECLARED (`sidecar-merge.ts`: `words`, by
// value identity), so the legs below exercise the real task-719 merge rather
// than an undeclared array's scalar fallback.
const FILE = "dictionary.json";
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
    // A sanity pin for the leg below: the file is in the population the
    // provider hands the watcher, so a change to it is reachable.
    expect(ALL_SIDECAR_FILENAMES).toContain(FILE);
  });

  it("an external sidecar write re-hydrates the REAL usePersistentState on the next poll, with no reload and no hand-dispatched event", async () => {
    externalWrite(DOC, REL, JSON.stringify({ words: ["initial"] }));
    const { result } = renderHook(
      () => usePersistentState<Shape>(DOC, FILE, EMPTY),
      { wrapper },
    );
    // Mount: the hook's own load + the watcher's PRIME pass (baseline, no emit).
    await pollOnce();
    expect(result.current.state.words).toEqual(["initial"]);
    const readsAfterMount = sidecarReads;

    // A quiet poll re-reads nothing (the cheap mtime/size path).
    await pollOnce();
    expect(sidecarReads).toBe(readsAfterMount);
    expect(result.current.state.words).toEqual(["initial"]);

    // An /editor/* skill (or a sync daemon) writes the file out of process.
    externalWrite(DOC, REL, JSON.stringify({ words: ["initial", "ai-drafted"] }));
    await pollOnce();

    expect(result.current.state.words).toEqual(["initial", "ai-drafted"]);
    expect(sidecarReads).toBe(readsAfterMount + 1);
  });

  it("an external REMOVAL empties the panel to its default", async () => {
    externalWrite(DOC, REL, JSON.stringify({ words: ["gone-soon"] }));
    const { result } = renderHook(
      () => usePersistentState<Shape>(DOC, FILE, EMPTY),
      { wrapper },
    );
    await pollOnce();
    expect(result.current.state.words).toEqual(["gone-soon"]);

    disk.delete(key(DOC, REL));
    await pollOnce();

    expect(result.current.state.words).toEqual([]);
  });
});

/**
 * Task 569 → task 719 — what a DEFERRAL means, driven through the REAL watcher.
 *
 * 569 asked that "the next poll re-emits once clean" be VERIFIED rather than
 * assumed, and it does NOT: the watcher re-baselines its ledger to the external
 * bytes BEFORE it emits, our landed write re-baselines it again to OURS, and
 * the next poll is a cheap mtime/size match that emits nothing. So a deferral
 * had to be either a REPLAY or a discard — and it was a discard, with a
 * whole-snapshot write landing on top of the change it had declined to read.
 *
 * TASK 719 supplies both missing halves, and these legs now pin them: the write
 * is a serialized read-modify-MERGE, so what lands is the UNION rather than the
 * local snapshot; and the deferral is a DEBT, replayed once the write drains,
 * so memory converges without the watcher ever emitting again.
 */
describe("a deferral is a DEBT, not a discard — the watcher never re-emits (tasks 569 + 719)", () => {
  const disktext = () => disk.get(key(DOC, REL))?.text ?? "";

  it("MID-DEBOUNCE: the landed write MERGES the external bytes in, and the deferred read is replayed", async () => {
    externalWrite(DOC, REL, JSON.stringify({ words: ["initial"] }));
    // 5 s debounce so the 3 s poll lands while the timer is still ARMED.
    const { result } = renderHook(
      () => usePersistentState<Shape>(DOC, FILE, EMPTY, { debounceMs: 5_000 }),
      { wrapper },
    );
    await pollOnce(); // prime
    expect(result.current.state.words).toEqual(["initial"]);
    const readsAfterMount = sidecarReads;

    act(() => {
      result.current.update((prev) => ({ words: [...prev.words, "local-edit"] }));
    });
    externalWrite(DOC, REL, JSON.stringify({ words: ["initial", "external-only"] }));
    await pollOnce(); // the watcher emits; the hook is dirty → defers
    expect(sidecarReads).toBe(readsAfterMount);
    expect(result.current.state.words).toEqual(["initial", "local-edit"]);

    // The debounce fires (t+5 s). PRE-719 the local snapshot landed OVER the
    // external bytes and "external-only" was gone for good. Now the write reads
    // disk inside its own critical section and lands the UNION.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    await flush();
    expect(sidecarWrites).toBe(1);
    expect(disktext()).toContain("local-edit");
    expect(disktext()).toContain("external-only");

    // …and the deferral was a DEBT: draining the write replayed the re-read, so
    // memory converged too — without the watcher emitting again.
    expect(sidecarReads, "the deferred read is replayed on the drain").toBe(
      readsAfterMount + 1,
    );
    expect(result.current.state.words).toEqual([
      "initial",
      "local-edit",
      "external-only",
    ]);

    // Two more polls: nothing re-emits. Memory = disk.
    await pollOnce();
    await pollOnce();
    expect(sidecarReads).toBe(readsAfterMount + 1);
    expect(result.current.state.words).toEqual([
      "initial",
      "local-edit",
      "external-only",
    ]);
  });

  it("IN FLIGHT (the 569 defect): an external change polled while the write is held open is deferred — and the drain merges it in", async () => {
    externalWrite(DOC, REL, JSON.stringify({ words: ["initial"] }));
    const { result } = renderHook(
      () => usePersistentState<Shape>(DOC, FILE, EMPTY, { debounceMs: 1_000 }),
      { wrapper },
    );
    await pollOnce(); // prime
    expect(result.current.state.words).toEqual(["initial"]);
    const readsAfterMount = sidecarReads;

    let release!: () => void;
    writeGate = new Promise<void>((r) => {
      release = r;
    });
    act(() => {
      result.current.update((prev) => ({ words: [...prev.words, "local-edit"] }));
    });
    // The debounce fires: the timer handle is NULL and the write is IN FLIGHT.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(sidecarWrites).toBe(1);
    expect(disktext()).not.toContain("local-edit"); // not landed yet

    // An out-of-band writer lands inside the window; the watcher confirms it.
    externalWrite(DOC, REL, JSON.stringify({ words: ["initial", "external-only"] }));
    await pollOnce();
    // Pre-569: both guard reads passed, the hook adopted the external bytes.
    expect(sidecarReads, "the re-read was deferred").toBe(readsAfterMount);
    expect(result.current.state.words).toEqual(["initial", "local-edit"]);

    // Release the write. Its in-lock read now sees the external bytes, so the
    // UNION lands — and the drain replays the deferred read, so memory follows.
    await act(async () => {
      release();
      await writeGate;
    });
    writeGate = null;
    await flush();
    expect(disktext()).toContain("local-edit");
    expect(disktext()).toContain("external-only");

    expect(sidecarReads, "the deferred read is replayed on the drain").toBe(
      readsAfterMount + 1,
    );
    expect(result.current.state.words).toEqual([
      "initial",
      "local-edit",
      "external-only",
    ]);

    // No further emit: memory and disk already agree.
    await pollOnce();
    expect(sidecarReads).toBe(readsAfterMount + 1);
  });

  it("CONTROL: a LATER external write, after the in-flight write has settled, still re-hydrates", async () => {
    externalWrite(DOC, REL, JSON.stringify({ words: ["initial"] }));
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
      result.current.update((prev) => ({ words: [...prev.words, "local-edit"] }));
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

    externalWrite(DOC, REL, JSON.stringify({ words: ["initial", "local-edit", "later-external"] }));
    await pollOnce();
    expect(result.current.state.words).toEqual(["initial", "local-edit", "later-external"]);
  });
});

/**
 * TASK 719 — the traced sequence, end to end, on the file it was found in.
 *
 * 1. The user has an unsaved edit in `reports.json` (one keystroke in any
 *    report card arms the debounce).
 * 2. A skill answers a report request: `create_card.py` APPENDS the AI's card
 *    to the same file.
 * 3. The watcher sees it and emits; the hook is dirty, so it defers.
 * 4. The debounced write lands.
 *
 * Before 719 step 4 wrote the local whole snapshot — which does not contain the
 * agent's card — over the file, and re-baselined the ledger to our bytes so the
 * watcher never mentioned it again. The AI's report was deleted from disk, the
 * `ai-requests.json` row still read `complete`, and the work was unrepeatable.
 *
 * The assertion is on the BYTES, not on state: state agreeing is necessary but
 * it is not what the user lost.
 */
describe("task 719 — a skill's append survives the user's unsaved edit", () => {
  interface Card {
    id: string;
    body: string;
  }
  interface ReportsShape {
    cards: Card[];
  }
  const REPORTS = "reports.json";
  const REPORTS_REL = `virgil/${REPORTS}`;
  const EMPTY_REPORTS: ReportsShape = { cards: [] };
  const onDisk = (): ReportsShape =>
    JSON.parse(disk.get(key(DOC, REPORTS_REL))?.text ?? "null");

  it("BOTH the agent's card and the user's unsaved edit are on disk afterwards", async () => {
    externalWrite(
      DOC,
      REPORTS_REL,
      JSON.stringify({ cards: [{ id: "u1", body: "the user's report" }] }),
    );
    const { result } = renderHook(
      () =>
        usePersistentState<ReportsShape>(DOC, REPORTS, EMPTY_REPORTS, {
          debounceMs: 5_000,
        }),
      { wrapper },
    );
    await pollOnce(); // load + prime
    expect(result.current.state.cards).toHaveLength(1);

    // (1) One keystroke in the user's own card: the debounce is armed, so this
    //     instance is DIRTY for the next five seconds.
    act(() => {
      result.current.update((prev) => ({
        cards: prev.cards.map((c) =>
          c.id === "u1" ? { ...c, body: "the user's report, edited" } : c,
        ),
      }));
    });

    // (2) The skill appends its answer straight to disk, out of process.
    externalWrite(
      DOC,
      REPORTS_REL,
      JSON.stringify({
        cards: [
          { id: "u1", body: "the user's report" },
          { id: "a1", body: "the AI's answer" },
        ],
      }),
    );

    // (3) The watcher emits; the hook is dirty and defers.
    await pollOnce();
    expect(result.current.state.cards.map((c) => c.id)).toEqual(["u1"]);

    // (4) The debounce fires and the write lands.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    await flush();

    // THE ASSERTION ON THE BYTES: both records, neither writer's content lost.
    expect(onDisk().cards.map((c) => c.id).sort()).toEqual(["a1", "u1"]);
    expect(onDisk().cards.find((c) => c.id === "u1")!.body).toBe(
      "the user's report, edited",
    );
    expect(onDisk().cards.find((c) => c.id === "a1")!.body).toBe(
      "the AI's answer",
    );

    // …and the replayed read brought the agent's card into the panel too.
    expect(result.current.state.cards.map((c) => c.id).sort()).toEqual([
      "a1",
      "u1",
    ]);
  });

  it("a card the USER deleted is not resurrected by the merge (the base is what makes deletion derivable)", async () => {
    externalWrite(
      DOC,
      REPORTS_REL,
      JSON.stringify({
        cards: [
          { id: "u1", body: "keep me" },
          { id: "u2", body: "delete me" },
        ],
      }),
    );
    const { result } = renderHook(
      () =>
        usePersistentState<ReportsShape>(DOC, REPORTS, EMPTY_REPORTS, {
          debounceMs: 1_000,
        }),
      { wrapper },
    );
    await pollOnce();
    expect(result.current.state.cards).toHaveLength(2);

    act(() => {
      result.current.update((prev) => ({
        cards: prev.cards.filter((c) => c.id !== "u2"),
      }));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    await flush();

    // A plain UNION would have read "on disk, absent from memory" as an
    // external insert and put `u2` back. The base says the user removed it.
    expect(onDisk().cards.map((c) => c.id)).toEqual(["u1"]);
    expect(result.current.state.cards.map((c) => c.id)).toEqual(["u1"]);
  });
});
