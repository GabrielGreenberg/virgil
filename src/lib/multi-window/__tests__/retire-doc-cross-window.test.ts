/**
 * Retiring a doc's identity never runs under a PEER window's live editor
 * (task 1105).
 *
 * "Remove from Recents" (and "Reset example") purge a doc's folder handle,
 * emergency mirror and local sidecars. Run in window A while window B has
 * the paper open, that left B's next save with no folder and no crash net.
 * The door is `withDocIfUnclaimed` (doc-ownership) + its user-facing face
 * `retireDocUnlessOpenElsewhere` (handoff). Two windows are simulated the
 * way `doc-ownership-release-ordering.test.ts` does it: one fresh module
 * instance per window over ONE fake Web Lock manager.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { walkFiles, codeOnly } from "../../__tests__/_source-scan";

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

/** The same grantability rule as the release-ordering fake: a held lock OR
 *  an earlier pending request blocks; `ifAvailable` then gets `null`. */
class FakeLockManager {
  private held = new Set<string>();
  private queues = new Map<string, Array<() => void>>();
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
    const blocked = this.held.has(name) || q.length > 0;
    if (blocked && opts.ifAvailable) return cb(null);
    if (blocked) await new Promise<void>((r) => q.push(r));
    else this.held.add(name);
    try {
      return await cb({ name, mode: "exclusive" });
    } finally {
      const next = q.shift();
      if (next) next();
      else this.held.delete(name);
    }
  }
}

let locks: FakeLockManager;

type Ownership = typeof import("../doc-ownership");
type Handoff = typeof import("../handoff");

/** A fresh module graph = a fresh WINDOW. */
async function newWindow(id: number): Promise<{ own: Ownership; handoff: Handoff }> {
  nextWindowId = id;
  vi.resetModules();
  const own = await import("../doc-ownership");
  const handoff = await import("../handoff");
  return { own, handoff };
}

function makeDialog() {
  return {
    confirm: vi.fn(async () => true),
    alert: vi.fn(async (_opts: { title: string; message: string }) => {}),
  };
}

beforeEach(() => {
  idb.clear();
  locks = new FakeLockManager();
  Object.defineProperty(globalThis.navigator, "locks", { value: locks, configurable: true });
});

afterEach(() => {
  Reflect.deleteProperty(globalThis.navigator as object, "locks");
});

describe("withDocIfUnclaimed", () => {
  it("REFUSES while a peer window holds the doc — fn never runs", async () => {
    const B = await newWindow(2);
    expect(await B.own.claimDoc("x")).toEqual({ owned: true });
    const A = await newWindow(1);
    const fn = vi.fn(async () => "purged");
    expect(await A.own.withDocIfUnclaimed("x", fn)).toEqual({ ran: false });
    expect(fn).not.toHaveBeenCalled();
  });

  it("runs when nobody holds the doc, and no peer can claim it mid-run", async () => {
    const A = await newWindow(1);
    const B = await newWindow(2);
    let peerClaim: unknown;
    const out = await A.own.withDocIfUnclaimed("x", async () => {
      peerClaim = await B.own.claimDoc("x");
      return 7;
    });
    expect(out).toEqual({ ran: true, value: 7 });
    expect(peerClaim).toMatchObject({ owned: false });
    // The section ends with fn: the doc is claimable again.
    expect(await B.own.claimDoc("x")).toEqual({ owned: true });
  });

  it("a write inside the section short-circuits instead of deadlocking behind it", async () => {
    const A = await newWindow(1);
    const seen: string[] = [];
    await A.own.withDocIfUnclaimed("x", async () => {
      await A.own.withDocLock("x", async () => void seen.push("write"));
    });
    expect(seen).toEqual(["write"]);
  });

  it("this window OWNS the doc: fn runs directly, no lock request", async () => {
    const A = await newWindow(1);
    await A.own.claimDoc("x");
    const before = locks.requests;
    expect(await A.own.withDocIfUnclaimed("x", async () => 1)).toEqual({ ran: true, value: 1 });
    expect(locks.requests).toBe(before);
  });

  it("our OWN release still in flight is not mistaken for a peer", async () => {
    const A = await newWindow(1);
    await A.own.claimDoc("x");
    const releasing = A.own.releaseDoc("x"); // not awaited — closeTab's shape
    const fn = vi.fn(async () => "ok");
    expect(await A.own.withDocIfUnclaimed("x", fn)).toEqual({ ran: true, value: "ok" });
    await releasing;
  });

  it("a crashed peer's hold is gone with its lock — the stale owner record does not refuse", async () => {
    // B claimed, then its page died: the browser dropped the lock but the
    // `doc-owner/` cache row survives. The lock, not the cache, decides.
    const B = await newWindow(2);
    await B.own.claimDoc("x");
    await B.own.releaseDoc("x");
    idb.set("doc-owner/x", { windowId: "win-2", acquiredAt: 1 });
    const A = await newWindow(1);
    expect(await A.own.withDocIfUnclaimed("x", async () => 1)).toEqual({ ran: true, value: 1 });
  });
});

describe("retireDocUnlessOpenElsewhere", () => {
  it("peer-held: the purge never runs and the user is TOLD", async () => {
    const B = await newWindow(2);
    await B.own.claimDoc("x");
    const A = await newWindow(1);
    const dialog = makeDialog();
    const purge = vi.fn(async () => {});
    const ok = await A.handoff.retireDocUnlessOpenElsewhere(
      { id: "x", name: "My Paper" },
      dialog,
      purge,
    );
    expect(ok).toBe(false);
    expect(purge).not.toHaveBeenCalled();
    expect(dialog.alert).toHaveBeenCalledTimes(1);
    const opts = dialog.alert.mock.calls[0][0];
    expect(opts.message).toContain("My Paper");
    expect(opts.message).toMatch(/another Virgil window/);
    // B's ownership is untouched.
    expect(B.own.ownsDoc("x")).toBe(true);
  });

  it("owner-less and self-owned forgets still purge, silently", async () => {
    const A = await newWindow(1);
    const dialog = makeDialog();
    const purge = vi.fn(async () => {});
    expect(await A.handoff.retireDocUnlessOpenElsewhere({ id: "x" }, dialog, purge)).toBe(true);
    await A.own.claimDoc("y");
    expect(await A.handoff.retireDocUnlessOpenElsewhere({ id: "y" }, dialog, purge)).toBe(true);
    expect(purge).toHaveBeenCalledTimes(2);
    expect(dialog.alert).not.toHaveBeenCalled();
  });
});

describe("CENSUS: every identity-retiring call goes through the door", () => {
  // The purging doors a UI gesture reaches. Their definitions (the storage
  // backends, the seeder) and storage.ts's re-export are not callers.
  const DOORS = ["deleteDocFromIndex", "resetExample"];
  const DEFINERS = new Set([
    join("lib", "storage-fsa.ts"),
    join("lib", "storage-dev.ts"),
    join("lib", "storage.ts"),
    join("lib", "example-doc", "example-seeder.ts"),
  ]);

  it("each call sits inside a retireDocUnlessOpenElsewhere(...) callback", () => {
    const root = join(process.cwd(), "src");
    const calls: string[] = [];
    for (const p of walkFiles(root, { skipDirs: ["__tests__"] })) {
      if (!/\.(ts|tsx)$/.test(p)) continue;
      const rel = p.slice(root.length + 1);
      if (DEFINERS.has(rel)) continue;
      const code = codeOnly(readFileSync(p, "utf8"));
      for (const door of DOORS) {
        const re = new RegExp(`\\b${door}\\s*\\(`, "g");
        for (let m = re.exec(code); m; m = re.exec(code)) {
          const window = code.slice(Math.max(0, m.index - 400), m.index);
          const gated = window.lastIndexOf("retireDocUnlessOpenElsewhere(") >= 0;
          calls.push(`${rel}:${door}:${gated ? "gated" : "UNGATED"}`);
        }
      }
    }
    expect(calls.length).toBeGreaterThanOrEqual(2);
    expect(calls.filter((c) => c.endsWith("UNGATED"))).toEqual([]);
  });
});
