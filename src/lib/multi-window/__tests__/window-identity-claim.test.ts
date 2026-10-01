// @vitest-environment jsdom
/**
 * Task 871 — a browser-duplicated tab inherits sessionStorage, and so its
 * source window's id. The identity claim makes uniqueness a CHECKED fact at
 * the liveness lock: a stored id already held by a live twin is re-minted;
 * a free one (a plain reload — task 603's contract) is kept.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import type { BusEvent } from "@/lib/multi-window/bus";
import type { ReadinessTransport } from "@/lib/reload-door";
import { clearUnsavedWork } from "@/lib/unsaved-work";

const KEY = "virgil-window-id";

/** A LockManager shared by every "window" in the test: names held for the
 *  page's life, `ifAvailable` answering `null` when already held. */
function fakeLocks() {
  const held = new Set<string>();
  return {
    held,
    request: vi.fn(
      async (
        name: string,
        optsOrCb: unknown,
        maybeCb?: (lock: { name: string } | null) => unknown,
      ) => {
        const cb = (maybeCb ?? optsOrCb) as (l: { name: string } | null) => unknown;
        const ifAvailable =
          typeof optsOrCb === "object" &&
          (optsOrCb as { ifAvailable?: boolean }).ifAvailable;
        if (held.has(name)) {
          if (ifAvailable) return cb(null);
          return new Promise(() => {});
        }
        held.add(name);
        return cb({ name });
      },
    ),
    query: vi.fn(async () => ({
      held: [...held].map((name) => ({ name })),
      pending: [],
    })),
  };
}

/** One "window": a fresh module instance (its own cached id + claim) over
 *  the SHARED sessionStorage + LockManager — exactly a duplicated tab. */
async function openWindow() {
  vi.resetModules();
  const idMod = await import("@/lib/multi-window/window-id");
  const live = await import("@/lib/multi-window/window-liveness");
  const identity = await live.claimWindowIdentity();
  return { identity, getWindowId: idMod.getWindowId };
}

let locks: ReturnType<typeof fakeLocks>;

beforeEach(() => {
  sessionStorage.clear();
  locks = fakeLocks();
  vi.stubGlobal("navigator", { ...navigator, locks });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("claimWindowIdentity", () => {
  it("FREE — a stored id nobody holds is kept (reload keeps its id)", async () => {
    sessionStorage.setItem(KEY, "stored");
    const w = await openWindow();
    expect(w.identity).toEqual({ id: "stored", inheritedId: "stored" });
    expect(w.getWindowId()).toBe("stored");
    expect(sessionStorage.getItem(KEY)).toBe("stored");
    expect(locks.held.has("virgil-window/stored")).toBe(true);
  });

  it("TWIN — a stored id a live window holds is re-minted and stored", async () => {
    const a = await openWindow();
    // Duplicate tab: B starts with A's sessionStorage.
    const b = await openWindow();
    expect(b.identity.inheritedId).toBe(a.identity.id);
    expect(b.identity.id).not.toBe(a.identity.id);
    expect(b.getWindowId()).toBe(b.identity.id);
    expect(sessionStorage.getItem(KEY)).toBe(b.identity.id);
    expect(locks.held.has("virgil-window/" + b.identity.id)).toBe(true);
    // A is untouched.
    expect(a.getWindowId()).toBe(a.identity.id);
  });

  it("IDEMPOTENT — one claim per page", async () => {
    vi.resetModules();
    const live = await import("@/lib/multi-window/window-liveness");
    const [x, y] = await Promise.all([
      live.claimWindowIdentity(),
      live.claimWindowIdentity(),
    ]);
    expect(x).toBe(y);
    expect(locks.request).toHaveBeenCalledTimes(1);
  });

  it("LIVE SET — liveWindowIds names the re-minted id, not the inherited one", async () => {
    const a = await openWindow();
    vi.resetModules();
    const live = await import("@/lib/multi-window/window-liveness");
    const ids = await live.liveWindowIds();
    expect(ids.size).toBe(2);
    expect(ids.has(a.identity.id)).toBe(true);
  });
});

describe("reload door across a duplicated tab", () => {
  it("the twin's unlanded work is reported to the asker, not skipped as self", async () => {
    clearUnsavedWork();
    const a = await openWindow();
    const b = await openWindow();
    const { installReloadReadinessResponder, prepareAllWindowsForReload } =
      await import("@/lib/reload-door");

    const handlers = new Map<string, (e: BusEvent) => void>();
    const transport = (selfId: string): ReadinessTransport => ({
      selfId,
      publish: (e) => {
        for (const [id, fn] of handlers) {
          if (id !== selfId) queueMicrotask(() => fn(e));
        }
      },
      subscribe: (fn) => {
        handlers.set(selfId, fn);
        return () => handlers.delete(selfId);
      },
      liveIds: async () => new Set([a.identity.id, b.identity.id]),
    });

    const stop = installReloadReadinessResponder({
      transport: transport(b.identity.id),
      prepare: async () => ({
        unlanded: [{ docId: "twin-doc", reason: "conflict", ageMs: 1000 }],
        mirrored: true,
      }),
    });
    try {
      const r = await prepareAllWindowsForReload({
        transport: transport(a.identity.id),
        timeoutMs: 500,
      });
      expect(r.unlanded.map((d) => [d.docId, d.windowId])).toEqual([
        ["twin-doc", b.identity.id],
      ]);
    } finally {
      stop();
    }
  });
});
