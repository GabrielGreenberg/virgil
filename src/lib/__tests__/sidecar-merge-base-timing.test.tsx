// @vitest-environment jsdom
/**
 * Task 849 — the three holes in how task 719's merge verdict was FED.
 *
 * 1. BASE TIMING. The base was read at SUBMIT time and advanced only after the
 *    write landed, so a second write queued behind a first still merged against
 *    the pre-first base: add-then-delete kept the deleted card on disk (read as
 *    an EXTERNAL INSERT), edit-then-revert lost the revert (read as
 *    "untouched"). The door now reads and advances a per-doc base CELL inside
 *    the lock. Pinned at the door (shared by all three persists) and through
 *    `usePersistentState`, over a disk whose `mutateSidecar` is SERIALIZED like
 *    the real one and whose first write is held in flight.
 * 2. MAP DELETE. A key an agent removed was re-added when local == base.
 * 3. DUPLICATE IDENTITY. Two local records under one id kept the FIRST (stale)
 *    one; a bib-review re-request beside its completed row was dropped.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor, cleanup } from "@testing-library/react";

// ── A serialized in-memory disk ─────────────────────────────────────────────
const disk = new Map<string, unknown>();
let queue: Promise<unknown> = Promise.resolve();
/** Gates the NEXT write(s) — each entry holds one write open until resolved. */
const gates: Array<Promise<void>> = [];
let failNext = false;

vi.mock("@/lib/storage", () => ({
  readSidecar: async (_d: string, f: string, dflt: unknown) =>
    disk.has(f) ? structuredClone(disk.get(f)) : dflt,
  readSidecarIfExists: async (_d: string, f: string) =>
    disk.has(f) ? structuredClone(disk.get(f)) : null,
  writeSidecar: async (_h: unknown, f: string, v: unknown) => {
    disk.set(f, structuredClone(v));
  },
  mutateSidecar: (
    _h: unknown,
    f: string,
    dflt: unknown,
    mutate: (cur: unknown) => unknown,
  ) => {
    const run = queue.then(async () => {
      const cur = disk.has(f) ? structuredClone(disk.get(f)) : dflt;
      const next = mutate(cur);
      if (next === null) return null;
      const gate = gates.shift();
      if (gate) await gate;
      if (failNext) {
        failNext = false;
        throw new Error("disk full");
      }
      disk.set(f, structuredClone(next));
      return next;
    });
    queue = run.catch(() => {});
    return run;
  },
}));

import {
  newMergeBase,
  writeSidecarMerged,
} from "../sidecar-merged-write";
import { mergeSidecarState } from "../sidecar-merge";
import { usePersistentState } from "@/hooks/usePersistentState";
import { oneRowPerIdentity, useBibReview } from "@/hooks/useBibReview";
import {
  beginDocPipeline,
  __resetForTests,
} from "@/lib/multi-window/doc-pipeline";
import { __resetForTests as resetFlushers } from "@/lib/multi-window/pending-saves";
import type { DocWriteHandle } from "@/lib/multi-window/doc-pipeline";
import type { BibReviewRequest } from "@/lib/types";

interface Card {
  id: string;
  body: string;
}
interface Reports {
  cards: Card[];
}
const FILE = "reports.json";
const H = { docId: "d" } as unknown as DocWriteHandle;
const c = (id: string, body = id): Card => ({ id, body });

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

beforeEach(() => {
  disk.clear();
  gates.length = 0;
  failNext = false;
  queue = Promise.resolve();
  __resetForTests();
  resetFlushers();
});
afterEach(() => cleanup());

describe("hole 1 — the base is read INSIDE the lock (the door)", () => {
  it("add-then-delete, the first write still in flight, leaves the card OFF disk", async () => {
    const b0: Reports = { cards: [c("a")] };
    disk.set(FILE, b0);
    const base = newMergeBase<Reports>();
    base.value = b0;
    const gate = deferred();
    gates.push(gate.promise);
    const w1 = writeSidecarMerged(H, FILE, base, { cards: [c("a"), c("y")] });
    const w2 = writeSidecarMerged(H, FILE, base, { cards: [c("a")] });
    gate.resolve();
    await Promise.all([w1, w2]);
    expect((disk.get(FILE) as Reports).cards.map((x) => x.id)).toEqual(["a"]);
  });

  it("edit-then-revert lands the REVERT", async () => {
    const b0: Reports = { cards: [c("a", "one")] };
    disk.set(FILE, b0);
    const base = newMergeBase<Reports>();
    base.value = b0;
    const gate = deferred();
    gates.push(gate.promise);
    const w1 = writeSidecarMerged(H, FILE, base, { cards: [c("a", "two")] });
    const w2 = writeSidecarMerged(H, FILE, base, { cards: [c("a", "one")] });
    gate.resolve();
    await Promise.all([w1, w2]);
    expect((disk.get(FILE) as Reports).cards).toEqual([c("a", "one")]);
  });

  it("an external insert still survives both queued writes", async () => {
    disk.set(FILE, { cards: [c("a"), c("agent")] });
    const base = newMergeBase<Reports>();
    base.value = { cards: [c("a")] };
    await Promise.all([
      writeSidecarMerged(H, FILE, base, { cards: [c("a"), c("y")] }),
      writeSidecarMerged(H, FILE, base, { cards: [c("a")] }),
    ]);
    expect((disk.get(FILE) as Reports).cards.map((x) => x.id)).toEqual([
      "a",
      "agent",
    ]);
  });

  it("a FAILED write rolls the base back to what disk still holds", async () => {
    const b0: Reports = { cards: [c("a"), c("z")] };
    disk.set(FILE, b0);
    const base = newMergeBase<Reports>();
    base.value = b0;
    failNext = true;
    await expect(
      writeSidecarMerged(H, FILE, base, { cards: [c("a")] }),
    ).rejects.toThrow("disk full");
    expect(base.value).toBe(b0);
    // …so the retry still reads z as the user's DELETE, not an external insert.
    await writeSidecarMerged(H, FILE, base, { cards: [c("a")] });
    expect((disk.get(FILE) as Reports).cards.map((x) => x.id)).toEqual(["a"]);
  });

  it("a landed write advances the base to the SUBMITTED payload, not the merged result", async () => {
    disk.set(FILE, { cards: [c("a"), c("agent")] });
    const base = newMergeBase<Reports>();
    base.value = { cards: [c("a")] };
    const next = { cards: [c("a"), c("y")] };
    await writeSidecarMerged(H, FILE, base, next);
    expect(base.value).toBe(next);
  });
});

describe("hole 1 — through usePersistentState", () => {
  it("add-then-delete across two overlapping persists leaves the card OFF disk", async () => {
    const DOC = "doc-849";
    beginDocPipeline(DOC);
    disk.set(FILE, { cards: [c("a")] });
    const { result } = renderHook(() =>
      usePersistentState<Reports>(DOC, FILE, { cards: [] }, { debounceMs: 0 }),
    );
    await waitFor(() => expect(result.current.state.cards).toHaveLength(1));
    const gate = deferred();
    gates.push(gate.promise);
    let p1!: Promise<void>;
    let p2!: Promise<void>;
    act(() => {
      p1 = result.current.persist({ cards: [c("a"), c("y")] });
      p2 = result.current.persist({ cards: [c("a")] });
    });
    await act(async () => {
      gate.resolve();
      await Promise.all([p1, p2]);
    });
    expect((disk.get(FILE) as Reports).cards.map((x) => x.id)).toEqual(["a"]);
  });
});

describe("hole 2 — a map key deleted externally stays deleted", () => {
  const ann = (m: Record<string, string>) => ({ ...m });
  it("honoured when local == base", () => {
    const out = mergeSidecarState(
      "annotations.json",
      ann({ u1: "x", u2: "y" }),
      ann({ u1: "x" }),
      ann({ u1: "x", u2: "y" }),
    );
    expect(out).toEqual({ u1: "x" });
  });
  it("…but an unsaved local edit outlives the remote delete", () => {
    const out = mergeSidecarState(
      "annotations.json",
      ann({ u1: "x", u2: "y" }),
      ann({ u1: "x" }),
      ann({ u1: "x", u2: "edited" }),
    );
    expect(out).toEqual({ u1: "x", u2: "edited" });
  });
  it("…and a local insert (no base entry) is kept", () => {
    const out = mergeSidecarState(
      "document-settings.json",
      { styleId: "a" },
      { styleId: "a" },
      { styleId: "a", fresh: 1 },
    );
    expect(out).toEqual({ styleId: "a", fresh: 1 });
  });
});

describe("hole 3 — duplicate composite identity", () => {
  const req = (
    status: "pending" | "complete",
    at: string,
  ): BibReviewRequest =>
    ({ bibKey: "k", type: "fields", status, requestedAt: at }) as BibReviewRequest;

  it("a duplicate-id LOCAL list keeps the NEWEST record", () => {
    const done = req("complete", "t0");
    const again = req("pending", "t1");
    const out = mergeSidecarState(
      "bib-review-requests.json",
      { requests: [done] },
      { requests: [done] },
      { requests: [done, again] },
    ) as { requests: BibReviewRequest[] };
    expect(out.requests).toEqual([again]);
  });

  it("oneRowPerIdentity: pending beats finished, else the newest", () => {
    const done = req("complete", "t0");
    const pend = req("pending", "t1");
    expect(oneRowPerIdentity([pend, done])).toEqual([pend]);
    expect(oneRowPerIdentity([done, pend])).toEqual([pend]);
    const done2 = req("complete", "t2");
    expect(oneRowPerIdentity([done, done2])).toEqual([done2]);
  });

  it("useBibReview: re-requesting over a COMPLETE row leaves ONE pending row on disk", async () => {
    const DOC = "doc-849-bib";
    beginDocPipeline(DOC);
    const BIB = "bib-review-requests.json";
    disk.set(BIB, { requests: [req("complete", "t0")] });
    const { result } = renderHook(() => useBibReview(DOC));
    await waitFor(() => expect(result.current.requests).toHaveLength(1));
    act(() => result.current.requestReview("k", "fields"));
    await waitFor(() => {
      const rows = (disk.get(BIB) as { requests: BibReviewRequest[] }).requests;
      expect(rows.map((r) => r.status)).toEqual(["pending"]);
    });
    expect(result.current.requests.map((r) => r.status)).toEqual(["pending"]);
  });
});
