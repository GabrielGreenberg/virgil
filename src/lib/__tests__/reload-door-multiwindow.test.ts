/**
 * Task 610 — the reload door across windows.
 *
 * The unsaved-work channel is per window; the reload `SKIP_WAITING` causes is
 * app-wide. These legs simulate two windows with a pair of in-memory
 * transports (the real one is the BroadcastChannel bus + Web Locks) and pin:
 * A's update click SEES B's blocked work, an unanswered window is a block and
 * not "clean", and a controllerchange B did not ask for does not reload B
 * while B holds work.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

import {
  installReloadReadinessResponder,
  prepareAllWindowsForReload,
  reloadIfClean,
  type ReadinessTransport,
  type ReloadReadiness,
} from "@/lib/reload-door";
import type { BusEvent } from "@/lib/multi-window/bus";
import {
  clearUnsavedWork,
  noteSaveBlocked,
  noteUnsavedEdit,
} from "@/lib/unsaved-work";
import { __resetTickersForTests } from "@/lib/emergency-mirror";
import { __resetForTests as resetFlushers } from "@/lib/multi-window/pending-saves";
import {
  __resetUpdateStateForTests,
  applyUpdate,
  consumeSelfInitiatedUpdate,
  setActivatedElsewhere,
  setUpdateAvailable,
} from "@/hooks/useUpdateAvailable";

beforeEach(() => {
  clearUnsavedWork();
  __resetTickersForTests();
  resetFlushers();
  __resetUpdateStateForTests();
});

/** A BroadcastChannel-shaped network: a publish reaches every OTHER window. */
function network(live: string[] | null) {
  const handlers = new Map<string, Set<(e: BusEvent) => void>>();
  const sent: BusEvent[] = [];
  const transport = (selfId: string): ReadinessTransport => {
    handlers.set(selfId, new Set());
    return {
      selfId,
      publish: (e) => {
        sent.push(e);
        for (const [id, set] of handlers) {
          if (id === selfId) continue;
          // Async, like a real channel.
          queueMicrotask(() => set.forEach((fn) => fn(e)));
        }
      },
      subscribe: (fn) => {
        handlers.get(selfId)!.add(fn);
        return () => handlers.get(selfId)!.delete(fn);
      },
      liveIds: async () => (live ? new Set(live) : null),
    };
  };
  return { transport, sent };
}

const B_BLOCKED: ReloadReadiness = {
  unlanded: [{ docId: "paper-B", reason: "conflict", ageMs: 70 * 60_000 }],
  mirrored: true,
};

describe("prepareAllWindowsForReload", () => {
  it("surfaces ANOTHER window's blocked work — A itself is clean", async () => {
    const net = network(["A", "B"]);
    const stopB = installReloadReadinessResponder({
      transport: net.transport("B"),
      prepare: async () => B_BLOCKED,
    });
    const r = await prepareAllWindowsForReload({ transport: net.transport("A") });
    stopB();
    expect(r.unresponsive).toEqual([]);
    expect(r.unlanded).toEqual([{ ...B_BLOCKED.unlanded[0], windowId: "B" }]);
    expect(r.mirrored).toBe(true);
  });

  it("merges this window's own unlanded work, tagged as local", async () => {
    noteUnsavedEdit("paper-A");
    noteSaveBlocked("paper-A", "conflict");
    const net = network(["A", "B"]);
    const stopB = installReloadReadinessResponder({
      transport: net.transport("B"),
      prepare: async () => ({ unlanded: [], mirrored: true }),
    });
    const r = await prepareAllWindowsForReload({ transport: net.transport("A") });
    stopB();
    expect(r.unlanded.map((d) => [d.docId, d.windowId])).toEqual([["paper-A", null]]);
  });

  it("a live window that does not answer is UNKNOWN — never clean", async () => {
    vi.useFakeTimers();
    try {
      const net = network(["A", "B"]); // B is live but has no responder
      const p = prepareAllWindowsForReload({
        transport: net.transport("A"),
        timeoutMs: 100,
      });
      await vi.advanceTimersByTimeAsync(150);
      const r = await p;
      expect(r.unlanded).toEqual([]);
      expect(r.unresponsive).toEqual(["B"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a window whose preparation THROWS does not answer, so it too is unknown", async () => {
    vi.useFakeTimers();
    try {
      const net = network(["A", "B"]);
      const stopB = installReloadReadinessResponder({
        transport: net.transport("B"),
        prepare: async () => {
          throw new Error("flush exploded");
        },
      });
      const p = prepareAllWindowsForReload({
        transport: net.transport("A"),
        timeoutMs: 100,
      });
      await vi.advanceTimersByTimeAsync(150);
      const r = await p;
      stopB();
      expect(r.unresponsive).toEqual(["B"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not wait out the timeout once every live window has answered", async () => {
    const net = network(["A", "B"]);
    const stopB = installReloadReadinessResponder({
      transport: net.transport("B"),
      prepare: async () => ({ unlanded: [], mirrored: true }),
    });
    const t0 = Date.now();
    const r = await prepareAllWindowsForReload({
      transport: net.transport("A"),
      timeoutMs: 10_000,
    });
    stopB();
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(r).toEqual({ unlanded: [], mirrored: true, unresponsive: [] });
  });

  it("without Web Locks, collects whoever answers inside the blind window", async () => {
    const net = network(null);
    const stopB = installReloadReadinessResponder({
      transport: net.transport("B"),
      prepare: async () => B_BLOCKED,
    });
    const r = await prepareAllWindowsForReload({
      transport: net.transport("A"),
      blindWaitMs: 20,
    });
    stopB();
    expect(r.unlanded.map((d) => d.windowId)).toEqual(["B"]);
  });

  it("an unmirrored peer makes the whole answer unmirrored", async () => {
    const net = network(["A", "B"]);
    const stopB = installReloadReadinessResponder({
      transport: net.transport("B"),
      prepare: async () => ({ ...B_BLOCKED, mirrored: false }),
    });
    const r = await prepareAllWindowsForReload({ transport: net.transport("A") });
    stopB();
    expect(r.mirrored).toBe(false);
  });

  it("a responder ignores its own window's request", async () => {
    const net = network(["A"]);
    const prepare = vi.fn(async () => B_BLOCKED);
    const stop = installReloadReadinessResponder({ transport: net.transport("A"), prepare });
    await prepareAllWindowsForReload({ transport: net.transport("A") });
    stop();
    expect(prepare).not.toHaveBeenCalled();
  });
});

describe("a reload this window did not ask for", () => {
  it("reloadIfClean does NOT reload while this window holds unlanded work", async () => {
    noteUnsavedEdit("paper-B");
    noteSaveBlocked("paper-B", "conflict");
    const reload = vi.fn();
    expect(await reloadIfClean(reload)).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });

  it("reloadIfClean reloads a clean window", async () => {
    const reload = vi.fn();
    expect(await reloadIfClean(reload)).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("the update store remembers who posted SKIP_WAITING, once", () => {
    const post = vi.fn();
    setUpdateAvailable({ waiting: { postMessage: post } } as unknown as ServiceWorkerRegistration);
    expect(consumeSelfInitiatedUpdate()).toBe(false);
    applyUpdate();
    expect(post).toHaveBeenCalledWith({ type: "SKIP_WAITING" });
    expect(consumeSelfInitiatedUpdate()).toBe(true);
    expect(consumeSelfInitiatedUpdate()).toBe(false);
  });

  it("in the deferred state the click reloads THIS window and posts nothing", () => {
    const post = vi.fn();
    setUpdateAvailable({ waiting: { postMessage: post } } as unknown as ServiceWorkerRegistration);
    const reload = vi.fn();
    setActivatedElsewhere(reload);
    applyUpdate();
    expect(reload).toHaveBeenCalledTimes(1);
    expect(post).not.toHaveBeenCalled();
    expect(consumeSelfInitiatedUpdate()).toBe(false);
  });
});
