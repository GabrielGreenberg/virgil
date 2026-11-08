// @vitest-environment jsdom
//
// **The bib-review MOUNT LOAD is a read like any other** — task 1520.
//
// `useBibReview` loaded `bib-review-requests.json` through a private
// `readSidecar → setState` beside the shared re-read door: no dirty guard, no
// stale-read mark, and nothing gated a request on it. Three legs:
//
//   1. a request sent while the first read is in flight survives the read
//      resolving with pre-write disk — in memory AND on disk;
//   2. a load that throws is SAID (`unreadable` on the sidecar-refusal channel),
//      not swallowed;
//   3. (identity cascade ON) the uid re-stamp that runs when the bib entries
//      arrive after the load moves the merge BASE with memory, so a skill's
//      on-disk completion is shown on re-read and survives the next write.
//   + a rename that fires before the load re-keys the on-disk rows once they land.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import type { BibEntry, BibReviewState } from "@/lib/types";

const FILE = "bib-review-requests.json";
const disk = new Map<string, unknown>();
/** When armed, the next read snapshots disk NOW but resolves on release. */
let armGate = false;
let gate: { release: () => void } | null = null;
let throwNextRead: Error | null = null;

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule({
    readSidecar: async (_d: string, f: string, dflt: unknown) =>
      disk.has(f) ? structuredClone(disk.get(f)) : dflt,
    readSidecarIfExists: async (_d: string, f: string) => {
      if (throwNextRead) {
        const e = throwNextRead;
        throwNextRead = null;
        throw e;
      }
      const v = disk.has(f) ? structuredClone(disk.get(f)) : null;
      if (armGate) {
        armGate = false;
        await new Promise<void>((resolve) => {
          gate = { release: resolve };
        });
      }
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

import { useBibReview } from "../useBibReview";
import { dispatchSidecarChanged } from "@/lib/sidecar-watcher";
import { beginDocPipeline, __resetForTests } from "@/lib/multi-window/doc-pipeline";
import { getSidecarRefusal, resetSidecarRefusals } from "@/lib/sidecar-refusal";
import { setIdentityCascadeFlag } from "@/lib/identity/identity-flag";

const DOC = "doc-1520";
const settle = (ms = 20) =>
  act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
const onDisk = () => (disk.get(FILE) as BibReviewState | undefined)?.requests ?? [];

beforeEach(() => {
  disk.clear();
  armGate = false;
  gate = null;
  throwNextRead = null;
  __resetForTests();
  beginDocPipeline(DOC);
  resetSidecarRefusals();
});
afterEach(() => {
  setIdentityCascadeFlag(undefined);
});

describe("useBibReview's mount load goes through the shared door (task 1520)", () => {
  it("a request sent while the first read is in flight survives the read", async () => {
    disk.set(FILE, {
      requests: [
        { bibKey: "old", type: "fields", requestedAt: "t0", status: "complete" },
      ],
    });
    armGate = true;
    const { result } = renderHook(() => useBibReview(DOC));
    await waitFor(() => expect(gate).not.toBeNull());

    // The user sends a request before the load has landed.
    let verdict: unknown;
    await act(async () => {
      verdict = await result.current.requestReview("smith2020", "fields");
    });
    expect(verdict).toEqual({ ok: true });
    expect(onDisk().map((r) => r.bibKey).sort()).toEqual(["old", "smith2020"]);

    // The stale read (pre-write disk) now resolves.
    await act(async () => {
      gate!.release();
    });
    await settle();

    expect(result.current.getRequestStatus("smith2020", "fields")).toBe("pending");
    expect(result.current.getRequestStatus("old", "fields")).toBe("complete");
    expect(onDisk().map((r) => r.bibKey).sort()).toEqual(["old", "smith2020"]);
  });

  it("a load that THROWS records an `unreadable` sidecar refusal", async () => {
    throwNextRead = new Error("Unexpected end of JSON input");
    renderHook(() => useBibReview(DOC));
    await settle();
    const refusal = getSidecarRefusal(DOC);
    expect(refusal?.reason).toBe("unreadable");
    expect(refusal?.what).toBe("bibliography review");
    expect(refusal?.detail).toBe("Unexpected end of JSON input");
  });

  it("a rename fired before the load re-keys the on-disk rows once they land", async () => {
    disk.set(FILE, {
      requests: [{ bibKey: "old", type: "notes", requestedAt: "t0", status: "pending" }],
    });
    armGate = true;
    const { result } = renderHook(() => useBibReview(DOC));
    await waitFor(() => expect(gate).not.toBeNull());
    act(() => {
      result.current.renameBibKey("old", "new");
    });
    await act(async () => {
      gate!.release();
    });
    await settle();
    expect(result.current.requests.map((r) => r.bibKey)).toEqual(["new"]);
    expect(onDisk().map((r) => r.bibKey)).toEqual(["new"]);
  });

  it("(cascade ON) the uid re-stamp moves the base: a skill's completion is shown and survives the next write", async () => {
    setIdentityCascadeFlag(true);
    disk.set(FILE, {
      requests: [{ bibKey: "smith", type: "fields", requestedAt: "t0", status: "pending" }],
    });
    const entry = { key: "smith", uid: "uid-smith", type: "article", fields: {} } as unknown as BibEntry;
    const other = { key: "jones", uid: "uid-jones", type: "article", fields: {} } as unknown as BibEntry;
    let entries: BibEntry[] = [];
    const getBibEntry = (k: string) => entries.find((e) => e.key === k);
    const { result, rerender } = renderHook(() => useBibReview(DOC, getBibEntry, entries));
    await settle();
    expect(result.current.getRequestStatus("smith", "fields")).toBe("pending");

    // The .bib parse lands AFTER the sidecar load → the re-stamp effect runs.
    entries = [entry, other];
    rerender();
    await settle();
    expect(result.current.requests[0].entryUid).toBe("uid-smith");

    // The skill completes the review on disk; the watcher signals it.
    disk.set(FILE, {
      requests: [{ bibKey: "smith", type: "fields", requestedAt: "t0", status: "complete" }],
    });
    act(() => {
      dispatchSidecarChanged({ docId: DOC, filename: FILE });
    });
    await settle();
    expect(result.current.getRequestStatus("smith", "fields")).toBe("complete");

    // The user's next write must not revert it to pending.
    await act(async () => {
      await result.current.requestReview("jones", "notes");
    });
    await settle();
    const smith = onDisk().find((r) => r.bibKey === "smith");
    expect(smith?.status).toBe("complete");
    expect(result.current.getRequestStatus("smith", "fields")).toBe("complete");
  });
});
