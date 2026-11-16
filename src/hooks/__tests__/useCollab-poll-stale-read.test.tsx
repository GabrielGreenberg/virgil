// @vitest-environment jsdom
//
// Task 1646 — the collab.json 5 s poll is a sidecar RE-read into memory, so it
// asks the ONE stale-read guard (`markReadStart`, task 1504). A poll read holds
// the disk as it was when the read STARTED; if a pen/presence write started
// since — whether it has landed (overtaken) or is still in flight — applying
// that read would paint the pre-write pen until the next poll.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import type { CollabSidecar } from "@/lib/collab";

const disk = vi.hoisted(() => ({
  value: null as unknown,
  /** When set, the next read snapshots disk NOW but resolves only on release. */
  holdNextRead: false,
  heldRead: null as null | (() => void),
  /** When set, the next mutate blocks (before reading) until released. */
  holdNextMutate: false,
  heldMutate: null as null | (() => void),
}));

vi.mock("@/lib/storage", () => ({
  readSidecar: (_docId: string, _f: string, fallback: unknown) => {
    const snap = structuredClone(disk.value ?? fallback);
    if (!disk.holdNextRead) return Promise.resolve(snap);
    disk.holdNextRead = false;
    return new Promise((resolve) => {
      disk.heldRead = () => resolve(snap);
    });
  },
  readTextFile: async () => null,
  mutateSidecar: async (
    _h: unknown,
    _f: string,
    fallback: unknown,
    fn: (cur: unknown) => unknown,
  ) => {
    if (disk.holdNextMutate) {
      disk.holdNextMutate = false;
      await new Promise<void>((resolve) => {
        disk.heldMutate = resolve;
      });
    }
    const next = fn(structuredClone(disk.value ?? fallback));
    if (next === null) return null;
    disk.value = structuredClone(next);
    return next;
  },
}));

import { useCollab } from "../useCollab";
import { COLLAB_TIMINGS, saveIdentity } from "@/lib/collab";

const T0 = "2026-10-01T10:00:00.000Z";

/** Cowork on, Ada (this window) a participant, nobody holds the pen. */
function penFree(): CollabSidecar {
  return {
    enabled: true,
    participants: [{ name: "Ada", color: "#112233", firstSeen: T0 }],
    pen: { holder: null, since: T0, lastHeartbeat: T0, lastActivity: T0, requestedBy: [] },
    presence: {},
  };
}

const flush = () => act(async () => { await vi.advanceTimersByTimeAsync(0); });

describe("useCollab — the poll asks the stale-read guard (task 1646)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    saveIdentity({ name: "Ada", color: "#112233" });
    disk.value = penFree();
    disk.holdNextRead = false;
    disk.heldRead = null;
    disk.holdNextMutate = false;
    disk.heldMutate = null;
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    localStorage.clear();
  });

  it("a read a pen write OVERTOOK (started before, resolved after it landed) is re-issued, not applied", async () => {
    disk.holdNextRead = true; // the mount read: snapshots pen-free disk
    const hook = renderHook(() => useCollab("doc-1"));
    await flush();
    expect(disk.heldRead).not.toBeNull();

    await act(async () => { await hook.result.current.takePen(); });
    expect(hook.result.current.iHavePen).toBe(true);
    expect((disk.value as CollabSidecar).pen.holder).toBe("Ada");

    // The pre-write read resolves now — it must not roll the pen back.
    await act(async () => { disk.heldRead!(); });
    await flush();
    expect(hook.result.current.iHavePen).toBe(true);
  });

  it("a read that resolves while a pen write is IN FLIGHT is held back, then replayed when it drains", async () => {
    const hook = renderHook(() => useCollab("doc-1"));
    await flush();
    expect(hook.result.current.sidecar.pen.holder).toBeNull();

    // A poll read snapshots pen-free disk…
    disk.holdNextRead = true;
    await act(async () => { await vi.advanceTimersByTimeAsync(COLLAB_TIMINGS.pollMs); });
    expect(disk.heldRead).not.toBeNull();

    // …then a take starts (optimistic pill flip) and blocks in the queue…
    disk.holdNextMutate = true;
    let taken!: Promise<void>;
    act(() => { taken = hook.result.current.takePen(); });
    await flush();
    expect(hook.result.current.iHavePen).toBe(true);

    // …and the pre-write read resolves while the write is in flight.
    await act(async () => { disk.heldRead!(); });
    await flush();
    expect(hook.result.current.iHavePen).toBe(true);

    // The write lands; the held-back read is replayed against post-write disk.
    await act(async () => { disk.heldMutate!(); await taken; });
    await flush();
    expect(hook.result.current.iHavePen).toBe(true);
    expect((disk.value as CollabSidecar).pen.holder).toBe("Ada");
  });
});
