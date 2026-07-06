// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TexCacheDumpEntry } from "@/types/swiftlatex";

// ---------------------------------------------------------------------------
// In-memory idb-keyval mock. createStore returns a token; get/set/keys/del
// operate on a per-token Map so the tex-asset cache round-trips like real IDB.
// ---------------------------------------------------------------------------
const stores = new Map<symbol, Map<string, unknown>>();
function backing(token: symbol): Map<string, unknown> {
  let m = stores.get(token);
  if (!m) {
    m = new Map();
    stores.set(token, m);
  }
  return m;
}

vi.mock("idb-keyval", () => {
  return {
    createStore: (_db: string, _name: string) => Symbol("store"),
    get: async (key: string, token: symbol) => backing(token).get(key),
    set: async (key: string, value: unknown, token: symbol) => {
      backing(token).set(key, value);
    },
    del: async (key: string, token: symbol) => {
      backing(token).delete(key);
    },
    keys: async (token: symbol) => [...backing(token).keys()],
  };
});

// ---------------------------------------------------------------------------
// Manifest mock: a single non-placeholder core entry so provisionEngine's
// Tier-A branch is exercised (the real seed uses a placeholder that is skipped).
// ---------------------------------------------------------------------------
vi.mock("@/lib/tex-core-manifest", () => ({
  PLACEHOLDER_FMT_CACHEKEY: "__PLACEHOLDER_FMT_CACHEKEY__",
  CORE_FMT_PATH: "/swiftlatex/swiftlatexpdftex.fmt",
  CORE_MANIFEST: [
    // A real (non-placeholder) core entry — should be fetched + seeded.
    { cacheKey: "10/base.sty", fileid: "base-fileid", path: "/swiftlatex/texbundle/base-fileid" },
    // The placeholder .fmt — should be SKIPPED by provisionEngine.
    { cacheKey: "__PLACEHOLDER_FMT_CACHEKEY__", fileid: "swiftlatexpdftex.fmt", path: "/swiftlatex/swiftlatexpdftex.fmt" },
  ],
}));

import {
  provisionEngine,
  captureNewAssets,
  listCachedKeys,
  clearTexCache,
  type ProvisionableEngine,
  type TexAssetRecord,
} from "@/lib/tex-assets";

// A fake engine that records seedCache calls and returns canned dumps.
class FakeEngine implements ProvisionableEngine {
  seeded: Array<{ cacheKey: string; fileid: string; bytes: Uint8Array }> = [];
  offlineValue: boolean | null = null;
  private dumpQueue: TexCacheDumpEntry[][] = [];

  seedCache(cacheKey: string, fileid: string, src: Uint8Array | ArrayBuffer): void {
    const bytes = src instanceof Uint8Array ? src : new Uint8Array(src);
    this.seeded.push({ cacheKey, fileid, bytes });
  }
  async dumpNewCache(): Promise<TexCacheDumpEntry[]> {
    return this.dumpQueue.shift() ?? [];
  }
  setOffline(value: boolean): void {
    this.offlineValue = value;
  }
  queueDump(entries: TexCacheDumpEntry[]): void {
    this.dumpQueue.push(entries);
  }
}

function dumpEntry(cacheKey: string, fileid: string, bytes: number[]): TexCacheDumpEntry {
  return { cacheKey, fileid, bytes: new Uint8Array(bytes).buffer };
}

const originalFetch = globalThis.fetch;

beforeEach(() => {
  stores.clear();
  // Default: online.
  Object.defineProperty(globalThis.navigator ?? (globalThis as unknown as { navigator: object }).navigator ?? {}, "onLine", { value: true, configurable: true });
  if (typeof globalThis.navigator === "undefined") {
    // node env has no navigator — define a minimal one.
    Object.defineProperty(globalThis, "navigator", {
      value: { onLine: true },
      configurable: true,
      writable: true,
    });
  }
  // Mock fetch for bundled-asset fetches.
  globalThis.fetch = vi.fn(async (url: string | URL) => {
    const u = String(url);
    if (u.endsWith("/swiftlatex/texbundle/base-fileid")) {
      return new Response(new Uint8Array([1, 2, 3, 4]).buffer, { status: 200 });
    }
    return new Response(null, { status: 404 });
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("provisionEngine", () => {
  it("seeds the (non-placeholder) manifest entry with its captured cacheKey, skipping the placeholder", async () => {
    const engine = new FakeEngine();
    await provisionEngine(engine);

    const manifestSeed = engine.seeded.find((s) => s.cacheKey === "10/base.sty");
    expect(manifestSeed).toBeDefined();
    expect(manifestSeed!.fileid).toBe("base-fileid");
    expect([...manifestSeed!.bytes]).toEqual([1, 2, 3, 4]);

    // The placeholder .fmt must NOT be seeded (deliberately wrong key).
    expect(
      engine.seeded.some((s) => s.cacheKey === "__PLACEHOLDER_FMT_CACHEKEY__"),
    ).toBe(false);
  });

  it("seeds all persisted IndexedDB tex-asset entries", async () => {
    // Pre-populate the store as if a prior session cached two assets.
    const engine0 = new FakeEngine();
    engine0.queueDump([
      dumpEntry("26/expex.sty", "exp-1", [9, 9, 9]),
      dumpEntry("26/natbib.sty", "nat-1", [7, 7]),
    ]);
    await captureNewAssets(engine0);

    // A fresh engine boot must replay both persisted assets.
    const engine = new FakeEngine();
    await provisionEngine(engine);

    const exp = engine.seeded.find((s) => s.cacheKey === "26/expex.sty");
    const nat = engine.seeded.find((s) => s.cacheKey === "26/natbib.sty");
    expect(exp).toBeDefined();
    expect([...exp!.bytes]).toEqual([9, 9, 9]);
    expect(nat).toBeDefined();
    expect([...nat!.bytes]).toEqual([7, 7]);
  });

  it("pushes navigator.onLine into the worker (setOffline(false) when online)", async () => {
    const engine = new FakeEngine();
    await provisionEngine(engine);
    expect(engine.offlineValue).toBe(false);
  });

  it("sets offline=true when navigator reports offline", async () => {
    Object.defineProperty(globalThis.navigator, "onLine", { value: false, configurable: true });
    const engine = new FakeEngine();
    await provisionEngine(engine);
    expect(engine.offlineValue).toBe(true);
  });

  it("tolerates an empty manifest + empty store (no throw, still sets offline)", async () => {
    // Fetch always 404 (nothing bundled), store empty.
    globalThis.fetch = vi.fn(async () => new Response(null, { status: 404 })) as typeof fetch;
    const engine = new FakeEngine();
    await expect(provisionEngine(engine)).resolves.toBeUndefined();
    expect(engine.offlineValue).toBe(false);
    // No manifest entry could be fetched → no seeds from Tier A.
    expect(engine.seeded.some((s) => s.cacheKey === "10/base.sty")).toBe(false);
  });
});

describe("captureNewAssets", () => {
  it("round-trips dumpNewCache entries into the store and back byte-equal", async () => {
    const engine = new FakeEngine();
    engine.queueDump([
      dumpEntry("30/xcolor.sty", "xc-1", [10, 20, 30, 40]),
    ]);
    await captureNewAssets(engine);

    // Stored?
    const keys = await listCachedKeys();
    expect(keys).toContain("30/xcolor.sty");

    // Byte-equal on replay via provisionEngine.
    const engine2 = new FakeEngine();
    await provisionEngine(engine2);
    const replayed = engine2.seeded.find((s) => s.cacheKey === "30/xcolor.sty");
    expect(replayed).toBeDefined();
    expect([...replayed!.bytes]).toEqual([10, 20, 30, 40]);
    expect(replayed!.fileid).toBe("xc-1");
  });

  it("dedups: an already-stored asset with identical bytes is not re-written", async () => {
    const engine = new FakeEngine();
    engine.queueDump([dumpEntry("30/xcolor.sty", "xc-1", [1, 2, 3])]);
    await captureNewAssets(engine);

    // Second dump with the SAME bytes → dedup (fetchedAt should not change).
    const first = (await listCachedKeys()).length;
    engine.queueDump([dumpEntry("30/xcolor.sty", "xc-1", [1, 2, 3])]);
    await captureNewAssets(engine);
    const second = (await listCachedKeys()).length;
    expect(second).toBe(first); // no duplicate key growth
  });

  it("no-ops cleanly on an empty dump", async () => {
    const engine = new FakeEngine();
    engine.queueDump([]);
    await expect(captureNewAssets(engine)).resolves.toBeUndefined();
    expect(await listCachedKeys()).toHaveLength(0);
  });
});

describe("size cap", () => {
  it("drops + logs assets past the total-size cap", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const engine = new FakeEngine();
    // Two ~40MB assets: the first fits (< 64MB cap), the second overflows.
    const big = new Uint8Array(40 * 1024 * 1024).fill(1);
    engine.queueDump([
      { cacheKey: "40/big-a.sty", fileid: "big-a", bytes: big.slice().buffer },
      { cacheKey: "40/big-b.sty", fileid: "big-b", bytes: big.slice().buffer },
    ]);
    await captureNewAssets(engine);

    const keys = await listCachedKeys();
    expect(keys).toContain("40/big-a.sty");
    expect(keys).not.toContain("40/big-b.sty");
    expect(warn).toHaveBeenCalled();
    const warnMsg = warn.mock.calls.map((c) => String(c[0])).join("\n");
    expect(warnMsg).toMatch(/size cap/i);
    expect(warnMsg).toMatch(/big-b/);
  });
});

describe("dev tools", () => {
  it("clearTexCache wipes all persisted entries", async () => {
    const engine = new FakeEngine();
    engine.queueDump([
      dumpEntry("1/a.sty", "a", [1]),
      dumpEntry("1/b.sty", "b", [2]),
    ]);
    await captureNewAssets(engine);
    expect(await listCachedKeys()).toHaveLength(2);
    await clearTexCache();
    expect(await listCachedKeys()).toHaveLength(0);
  });

  it("stored records carry a hash + fetchedAt", async () => {
    const engine = new FakeEngine();
    engine.queueDump([dumpEntry("1/a.sty", "a", [1, 2, 3])]);
    await captureNewAssets(engine);
    // Reach into the mocked store to assert the record shape.
    const token = [...stores.keys()][0];
    const rec = stores.get(token)!.get("tex-asset/1/a.sty") as TexAssetRecord;
    expect(rec.cacheKey).toBe("1/a.sty");
    expect(rec.fileid).toBe("a");
    expect(typeof rec.hash).toBe("string");
    expect(rec.hash.length).toBeGreaterThan(0);
    expect(typeof rec.fetchedAt).toBe("number");
    expect([...rec.bytes]).toEqual([1, 2, 3]);
  });
});
