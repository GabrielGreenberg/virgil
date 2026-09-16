/**
 * Release ordering under a REAL Web Locks model (task 596).
 *
 * jsdom has no `navigator.locks`, so `withDocLock` degrades to a
 * passthrough and this whole class is structurally invisible to the rest
 * of the suite. These tests install a fake that implements the one rule
 * the bug turned on: a lock request is not grantable while an EARLIER
 * conflicting request is merely PENDING — so an `ifAvailable` claim fails
 * against a queued write, not only against a held lock.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const idb = new Map<string, unknown>();
vi.mock("idb-keyval", () => ({
  createStore: () => ({}),
  get: async (k: string) => idb.get(k),
  set: async (k: string, v: unknown) => void idb.set(k, v),
  del: async (k: string) => void idb.delete(k),
}));

let nextWindowId = 0;
vi.mock("../bus", () => ({
  publish: () => {},
  awaitRelease: async () => true,
  getWindowId: () => `win-${nextWindowId}`,
}));

/* ── The fake ───────────────────────────────────────────────────────── */

class FakeLockManager {
  private held = new Set<string>();
  private queues = new Map<string, Array<() => void>>();
  /** Every `request` that actually reached the manager. */
  requests = 0;

  async request(
    name: string,
    opts: { mode?: string; ifAvailable?: boolean },
    cb: (lock: unknown) => Promise<unknown>,
  ): Promise<unknown> {
    this.requests++;
    let q = this.queues.get(name);
    if (!q) {
      q = [];
      this.queues.set(name, q);
    }
    // Grantability: a held lock OR an earlier pending request blocks.
    const blocked = this.held.has(name) || q.length > 0;
    if (blocked && opts.ifAvailable) return cb(null);
    if (blocked) await new Promise<void>((r) => q.push(r));
    else this.held.add(name);
    try {
      return await cb({ name, mode: "exclusive" });
    } finally {
      const next = q.shift();
      // Hand the hold straight to the next waiter so no request can
      // slip in between; only an empty queue actually frees the name.
      if (next) next();
      else this.held.delete(name);
    }
  }
}

let locks: FakeLockManager;

type Ownership = typeof import("../doc-ownership");

/** A fresh module instance = a fresh WINDOW (the held-lock map is
 *  module state). Both instances share the one fake lock manager. */
async function newWindow(id: number): Promise<Ownership> {
  nextWindowId = id;
  vi.resetModules();
  return import("../doc-ownership");
}

beforeEach(() => {
  idb.clear();
  locks = new FakeLockManager();
  Object.defineProperty(globalThis.navigator, "locks", {
    value: locks,
    configurable: true,
  });
});

afterEach(() => {
  Reflect.deleteProperty(globalThis.navigator as object, "locks");
});

describe("releaseDoc ordering", () => {
  it("drains BEFORE dropping the hold — the drain's writes still take the owner short-circuit", async () => {
    const A = await newWindow(1);
    expect(await A.claimDoc("d1")).toEqual({ owned: true });

    const seen: string[] = [];
    const requestsAfterClaim = locks.requests;
    A.registerDocDrain(async (docId) => {
      // Mid-drain, this window must still own the doc...
      seen.push(`owns:${A.ownsDoc(docId)}`);
      // ...so a drain write takes the short-circuit rather than
      // queueing a real request that would disqualify a peer's claim.
      await A.withDocLock(docId, async () => {
        seen.push("write");
      });
      seen.push(`requests:${locks.requests - requestsAfterClaim}`);
    });

    await A.releaseDoc("d1");
    expect(seen).toEqual(["owns:true", "write", "requests:0"]);
    expect(A.ownsDoc("d1")).toBe(false);
  });

  it("a drain that throws does not strand the hold", async () => {
    const A = await newWindow(1);
    await A.claimDoc("d1");
    A.registerDocDrain(async () => {
      throw new Error("disk went away");
    });
    await A.releaseDoc("d1");
    expect(A.ownsDoc("d1")).toBe(false);
  });

  it("releaseDoc with no registered drain is a correct no-op drain", async () => {
    const A = await newWindow(1);
    await A.claimDoc("d1");
    await A.releaseDoc("d1");
    expect(A.ownsDoc("d1")).toBe(false);
  });

  it("a handoff of a doc with an unsaved edit succeeds on the FIRST claim", async () => {
    const A = await newWindow(1);
    const B = await newWindow(2);
    expect(await A.claimDoc("d1")).toEqual({ owned: true });
    // B can't have it yet.
    expect(await B.claimDoc("d1")).toMatchObject({ owned: false });

    const order: string[] = [];
    A.registerDocDrain(async (docId) => {
      // A pending write that takes a few ticks to settle — exactly the
      // case the bug's barrier failed on (an idle doc drains to a no-op,
      // so the broken ordering was invisible until there was unsaved work).
      await A.withDocLock(docId, async () => {
        await new Promise((r) => setTimeout(r, 20));
        order.push("A-write");
      });
    });

    // This is the peer-handoff sequence: the owner releases, the claimant
    // claims once. No retry. B learns of the release over BroadcastChannel,
    // so one macrotask separates them — far LESS than the 20 ms write, which
    // is the point: without the drain ordering that write is still pending
    // here, and a pending exclusive request refuses B's ifAvailable claim.
    await A.releaseDoc("d1");
    order.push("A-released");
    await new Promise((r) => setTimeout(r, 0));
    const claimed = await B.claimDoc("d1");
    order.push(`B-owned:${"owned" in claimed && claimed.owned}`);

    expect(claimed).toEqual({ owned: true });
    // The write landed while A still owned the doc — it cannot arrive
    // late and clobber what B writes next.
    expect(order).toEqual(["A-write", "A-released", "B-owned:true"]);
  });

  it("without a drain, the same unsaved write would queue a real request that disqualifies the peer", async () => {
    // The refutation leg: it pins that the fake really does model the
    // grantability rule the bug turned on. Here the write is issued by a
    // window that does NOT hold the doc (what dropping the hold first
    // makes every drain write look like), and B's ifAvailable claim fails.
    const A = await newWindow(1);
    const B = await newWindow(2);
    let finishWrite!: () => void;
    const writeDone = new Promise<void>((r) => {
      finishWrite = r;
    });
    void A.withDocLock("d1", async () => {
      await writeDone;
    });
    await Promise.resolve();
    // A pending exclusive request is enough: B is refused.
    expect(await B.claimDoc("d1")).toMatchObject({ owned: false });
    finishWrite();
  });

  it("releaseAll drains every held doc", async () => {
    const A = await newWindow(1);
    await A.claimDoc("d1");
    await A.claimDoc("d2");
    const drained: string[] = [];
    A.registerDocDrain(async (id) => {
      drained.push(id);
    });
    await A.releaseAll();
    expect(drained.sort()).toEqual(["d1", "d2"]);
    expect(A.ownsDoc("d1")).toBe(false);
    expect(A.ownsDoc("d2")).toBe(false);
  });
});

describe("the drain hook has a registrant", () => {
  it("@/lib/storage is the ONE registrant, and it registers drainDoc", async () => {
    const { readFileSync, readdirSync, statSync } = await import("node:fs");
    const { join } = await import("node:path");
    const root = join(process.cwd(), "src");
    const hits: string[] = [];
    // A commented-out registration registers nothing, so the census must
    // not count one — the needle is CODE, not text (cf. task 600).
    const code = (src: string) =>
      src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
    const walk = (dir: string) => {
      for (const e of readdirSync(dir)) {
        const p = join(dir, e);
        if (statSync(p).isDirectory()) {
          if (e === "node_modules" || e === "__tests__") continue;
          walk(p);
          continue;
        }
        if (!/\.(ts|tsx)$/.test(e)) continue;
        const src = readFileSync(p, "utf8");
        if (/\bregisterDocDrain\s*\(/.test(code(src))) hits.push(p.slice(root.length + 1));
      }
    };
    walk(root);
    // doc-ownership.ts DECLARES it; storage.ts CALLS it. A registry
    // nothing calls drains nothing, silently — which is the same bug
    // wearing a different hat.
    expect(hits.sort()).toEqual([
      join("lib", "multi-window", "doc-ownership.ts"),
      join("lib", "storage.ts"),
    ]);
    const storage = code(readFileSync(join(root, "lib", "storage.ts"), "utf8"));
    expect(storage).toMatch(/registerDocDrain\(drainDoc\)/);
  });
});
