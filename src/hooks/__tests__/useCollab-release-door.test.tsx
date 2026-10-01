// @vitest-environment jsdom
//
// Task 872 — collab.json has more than one writer (this window, a peer window,
// the collaborator via sync), so every write is a mutator applied to a FRESH
// in-queue read, never the last-polled snapshot. The legs below put a partner's
// write on "disk" AFTER this window's last poll and ask whether leaving the
// paper (pagehide) — or any action — erases it.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, cleanup, waitFor } from "@testing-library/react";
import type { CollabSidecar } from "@/lib/collab";

const disk = vi.hoisted(() => ({ value: null as unknown, writes: 0 }));

vi.mock("@/lib/storage", () => ({
  readSidecar: async (_docId: string, _f: string, fallback: unknown) =>
    structuredClone(disk.value ?? fallback),
  readTextFile: async () => null,
  // The door: the read happens inside the call, right before the write.
  mutateSidecar: async (
    _h: unknown,
    _f: string,
    fallback: unknown,
    fn: (cur: unknown) => unknown,
  ) => {
    const next = fn(structuredClone(disk.value ?? fallback));
    if (next === null) return null;
    disk.value = structuredClone(next);
    disk.writes++;
    return next;
  },
}));

import { useCollab } from "../useCollab";
import { saveIdentity } from "@/lib/collab";

const T0 = "2026-10-01T10:00:00.000Z";
const T1 = "2026-10-01T10:00:30.000Z";

function presence(at: string) {
  return { lastHeartbeat: at, focusedCard: null, selectedCards: [], cursorParagraphId: null };
}

/** Ada (this window) holds the pen and is present; Bob is absent. */
function adaHolds(): CollabSidecar {
  return {
    enabled: true,
    participants: [
      { name: "Ada", color: "#112233", firstSeen: T0 },
      { name: "Bob", color: "#445566", firstSeen: T0 },
    ],
    pen: { holder: "Ada", since: T0, lastHeartbeat: T0, lastActivity: T0, requestedBy: [] },
    presence: { Ada: presence(T0) },
  };
}

/** Bob, via sync, after Ada's last poll: joined presence + requested the pen. */
function bobArrives() {
  const v = structuredClone(disk.value) as CollabSidecar;
  v.presence.Bob = presence(T1);
  v.pen.requestedBy = [{ name: "Bob", requestedAt: T1 }];
  disk.value = v;
}

async function mountPolled() {
  const hook = renderHook(() => useCollab("doc-1"));
  await waitFor(() => expect(hook.result.current.iHavePen).toBe(true));
  return hook;
}

describe("useCollab — collab.json writes go through the mutate door (task 872)", () => {
  beforeEach(() => {
    localStorage.clear();
    saveIdentity({ name: "Ada", color: "#112233" });
    disk.value = adaHolds();
    disk.writes = 0;
  });
  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it("pagehide releases ONLY my pen + presence; a partner's newer request survives", async () => {
    await mountPolled();
    bobArrives();
    act(() => {
      window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: false }));
    });
    await waitFor(() => expect(disk.writes).toBe(1));
    const v = disk.value as CollabSidecar;
    expect(v.pen.holder).toBeNull();
    expect(v.presence.Ada).toBeUndefined();
    expect(v.presence.Bob).toEqual(presence(T1));
    expect(v.pen.requestedBy).toEqual([{ name: "Bob", requestedAt: T1 }]);
  });

  it("beforeunload alone no longer writes (pagehide is the release event)", async () => {
    await mountPolled();
    act(() => {
      window.dispatchEvent(new Event("beforeunload"));
    });
    await Promise.resolve();
    expect(disk.writes).toBe(0);
  });

  it("pageshow{persisted} re-joins presence after a bfcache release", async () => {
    await mountPolled();
    act(() => {
      window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true }));
    });
    await waitFor(() => expect((disk.value as CollabSidecar).presence.Ada).toBeUndefined());
    act(() => {
      window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
    });
    await waitFor(() => expect((disk.value as CollabSidecar).presence.Ada).toBeDefined());
    // Re-joining is presence only — the pen stays released.
    expect((disk.value as CollabSidecar).pen.holder).toBeNull();
  });

  it("a non-persisted pageshow (fresh load) writes nothing", async () => {
    await mountPolled();
    act(() => {
      window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: false }));
    });
    await Promise.resolve();
    expect(disk.writes).toBe(0);
  });

  it("an action mutates the fresh disk value, not the polled snapshot", async () => {
    const { result } = await mountPolled();
    bobArrives();
    await act(async () => {
      await result.current.passPen();
    });
    const v = disk.value as CollabSidecar;
    expect(v.pen.holder).toBeNull();
    expect(v.presence.Bob).toEqual(presence(T1));
    // And the hook adopts the authoritative post-write sidecar.
    expect(result.current.sidecar.presence.Bob).toEqual(presence(T1));
  });
});
