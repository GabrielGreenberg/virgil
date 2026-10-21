// @vitest-environment jsdom
//
// Task 1213 — the hook half of session ownership: a hidden keep-alive pane
// writes no heartbeat (its pen goes stale honestly, so the partner is offered
// "Take over"); closing the holding pane releases the pen; a sibling pane of
// the same name neither holds nor releases it.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, cleanup, waitFor } from "@testing-library/react";
import { COLLAB_TIMINGS, derivePen, type CollabSidecar } from "@/lib/collab";

const disk = vi.hoisted(() => ({ value: null as unknown, writes: 0 }));

vi.mock("@/lib/storage", () => ({
  readSidecar: async (_docId: string, _f: string, fallback: unknown) =>
    structuredClone(disk.value ?? fallback),
  readTextFile: async () => null,
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

function freePen(): CollabSidecar {
  const t = new Date().toISOString();
  return {
    enabled: true,
    participants: [{ name: "Ada", color: "#112233", firstSeen: t }],
    pen: { holder: null, since: null, lastHeartbeat: null, lastActivity: null, requestedBy: [] },
    presence: {},
  };
}

const onDisk = () => disk.value as CollabSidecar;

describe("useCollab — pen ownership per holding session (task 1213)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    localStorage.clear();
    saveIdentity({ name: "Ada", color: "#112233" });
    disk.value = freePen();
    disk.writes = 0;
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    localStorage.clear();
  });

  it("a HIDDEN pane writes no pen heartbeat, so the pen goes stale and is takable", async () => {
    const hook = renderHook(({ visible }) => useCollab("doc-1", { visible }), {
      initialProps: { visible: true },
    });
    await waitFor(() => expect(hook.result.current.sidecar.enabled).toBe(true));
    await act(async () => {
      await hook.result.current.takePen();
    });
    expect(hook.result.current.iHavePen).toBe(true);

    // Visible: the heartbeat keeps the pen fresh.
    const took = onDisk().pen.lastHeartbeat;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(COLLAB_TIMINGS.cardHeartbeatMs + 10);
    });
    expect(onDisk().pen.lastHeartbeat).not.toBe(took);

    // Parked display:none by keep-alive: no more pen heartbeats.
    hook.rerender({ visible: false });
    const parkedAt = onDisk().pen.lastHeartbeat;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(COLLAB_TIMINGS.penStaleMs + 1000);
    });
    expect(onDisk().pen.lastHeartbeat).toBe(parkedAt);
    expect(derivePen(onDisk().pen).status).toBe("stale");
  });

  it("unmounting the holding pane releases the pen", async () => {
    const hook = renderHook(() => useCollab("doc-1"));
    await waitFor(() => expect(hook.result.current.sidecar.enabled).toBe(true));
    await act(async () => {
      await hook.result.current.takePen();
    });
    expect(onDisk().pen.holder).toBe("Ada");
    hook.unmount();
    await waitFor(() => expect(onDisk().pen.holder).toBeNull());
    expect(onDisk().presence.Ada).toBeUndefined();
  });

  it("a sibling session of the same name neither holds nor releases the pen", async () => {
    const a = renderHook(() => useCollab("doc-1"));
    const b = renderHook(() => useCollab("doc-1"));
    await waitFor(() => expect(b.result.current.sidecar.enabled).toBe(true));
    await act(async () => {
      await a.result.current.takePen();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(COLLAB_TIMINGS.pollMs + 10);
    });
    expect(a.result.current.iHavePen).toBe(true);
    expect(b.result.current.iHavePen).toBe(false);
    expect(b.result.current.penHeldElsewhere).toBe(true);
    expect(b.result.current.canEditMainText).toBe(false);

    // Closing the sibling leaves A's pen.
    b.unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(onDisk().pen.holder).toBe("Ada");
    expect(a.result.current.iHavePen).toBe(true);
  });

  it("Take in a sibling session moves the pen there", async () => {
    const a = renderHook(() => useCollab("doc-1"));
    const b = renderHook(() => useCollab("doc-1"));
    await waitFor(() => expect(b.result.current.sidecar.enabled).toBe(true));
    await act(async () => {
      await a.result.current.takePen();
    });
    await act(async () => {
      await b.result.current.takePen();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(COLLAB_TIMINGS.pollMs + 10);
    });
    expect(b.result.current.iHavePen).toBe(true);
    expect(a.result.current.iHavePen).toBe(false);
    expect(a.result.current.penHeldElsewhere).toBe(true);
  });
});
