// @vitest-environment node
/**
 * Task 757 — stored state is untrusted input with a size bound.
 *
 * A machine's persisted state crashed the renderer ~5 s after EVERY paper
 * opened, and only "remove site data" cured it. The legs here drive each
 * store that is read or written in that window with a corrupt / oversized
 * slot and assert the paper's open path answers ABSENT, reports the slot,
 * clears it, and does not pay for it again on the next open.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const backing = new Map<string, unknown>();
const reads = { get: 0 };
let failNextGet: Error | null = null;

vi.mock("idb-keyval", () => ({
  createStore: () => Symbol("store"),
  get: async (key: string) => {
    reads.get++;
    if (failNextGet) {
      const e = failNextGet;
      failNextGet = null;
      throw e;
    }
    return backing.get(key);
  },
  set: async (key: string, value: unknown) => {
    backing.set(key, value);
  },
  del: async (key: string) => {
    backing.delete(key);
  },
  keys: async () => [...backing.keys()],
}));

import {
  STORED_STATE_REGISTRY,
  __resetStoredStateRefusalsForTests,
  estimateStoredBytes,
  familyOf,
  getStoredStateRefusals,
  readStoredValue,
} from "@/lib/stored-state";
import {
  MIRROR_MAX_CHARS,
  MIRROR_MAX_SLOTS,
  __resetMirrorPruneForTests,
  createMirrorTicker,
  pruneExpiredMirrors,
  readMirror,
  type EmergencyMirrorEntry,
} from "@/lib/emergency-mirror";

const STORE = Symbol("s") as never;

function mirror(docId: string, savedAt: number): EmergencyMirrorEntry {
  return {
    docId,
    content: { type: "doc", content: [{ type: "paragraph" }] },
    savedAt,
    lastLandedAt: null,
    reason: "preservation",
    windowId: "w",
    hash: "h",
  };
}

beforeEach(() => {
  backing.clear();
  reads.get = 0;
  failNextGet = null;
  __resetStoredStateRefusalsForTests();
  __resetMirrorPruneForTests();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("the door — readStoredValue", () => {
  const isObj = (v: unknown) =>
    typeof v === "object" && v !== null ? (true as const) : { why: "invalid" as const, detail: "x" };

  it("a missing slot is ABSENT and reports nothing", async () => {
    expect(await readStoredValue("k", { store: STORE, validate: isObj })).toBeNull();
    expect(getStoredStateRefusals()).toHaveLength(0);
  });

  it("a read that THROWS is ABSENT, reported, and not cleared", async () => {
    backing.set("k", { a: 1 });
    failNextGet = new Error("DataCloneError");
    expect(await readStoredValue("k", { store: STORE, validate: isObj })).toBeNull();
    expect(getStoredStateRefusals()[0]).toMatchObject({ key: "k", why: "read-failed", cleared: false });
    expect(backing.has("k")).toBe(true);
  });

  it("an invalid slot is ABSENT, reported and CLEARED — so the next open does not pay for it again", async () => {
    backing.set("k", "garbage");
    expect(await readStoredValue("k", { store: STORE, validate: isObj })).toBeNull();
    expect(backing.has("k")).toBe(false);
    expect(getStoredStateRefusals()[0]).toMatchObject({ why: "invalid", cleared: true });
    // Second read: nothing there, nothing reported again.
    expect(await readStoredValue("k", { store: STORE, validate: isObj })).toBeNull();
    expect(getStoredStateRefusals()).toHaveLength(1);
  });

  it("a validator that throws is a refusal, not a throw", async () => {
    backing.set("k", { a: 1 });
    const v = await readStoredValue("k", {
      store: STORE,
      validate: () => {
        throw new Error("boom");
      },
    });
    expect(v).toBeNull();
  });

  it("clearOnRefusal:false keeps the bytes", async () => {
    backing.set("k", "garbage");
    await readStoredValue("k", { store: STORE, validate: isObj, clearOnRefusal: false });
    expect(backing.has("k")).toBe(true);
  });
});

describe("the emergency mirror — the store written on the 5 s clock after open", () => {
  it("a corrupt slot is ABSENT at open and cleared (no write → crash → reopen → read loop)", async () => {
    backing.set("emergency-mirror/a", { docId: "a", savedAt: Date.now(), hash: "h", content: "not a model" });
    expect(await readMirror("a")).toBeNull();
    expect(backing.has("emergency-mirror/a")).toBe(false);
  });

  it("a slot holding ANOTHER paper's model is refused", async () => {
    backing.set("emergency-mirror/a", mirror("b", Date.now()));
    expect(await readMirror("a")).toBeNull();
  });

  it("a well-formed slot still reads back", async () => {
    backing.set("emergency-mirror/a", mirror("a", Date.now()));
    expect((await readMirror("a"))?.docId).toBe("a");
  });

  it("the ticker declines to write a model over MIRROR_MAX_CHARS, and does not re-serialize it every tick", async () => {
    const write = vi.fn(async () => {});
    const huge = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "x".repeat(MIRROR_MAX_CHARS) }] }],
    };
    const stringify = vi.spyOn(JSON, "stringify");
    const t = createMirrorTicker({
      docId: "a",
      getModel: () => huge,
      windowId: "w",
      write,
      readState: () => ({ dirtySince: 0, reason: "preservation", lastLandedAt: null }) as never,
    });
    expect(await t.tick()).toBe("oversized");
    const calls = stringify.mock.calls.length;
    expect(await t.tick()).toBe("unchanged");
    expect(stringify.mock.calls.length).toBe(calls);
    expect(write).not.toHaveBeenCalled();
    stringify.mockRestore();
  });

  it("the sweep runs ONCE per session, drops malformed slots, and keeps only the newest MIRROR_MAX_SLOTS", async () => {
    const now = Date.now();
    for (let i = 0; i < MIRROR_MAX_SLOTS + 5; i++) {
      backing.set(`emergency-mirror/d${i}`, mirror(`d${i}`, now - i * 1000));
    }
    backing.set("emergency-mirror/bad", 42);
    backing.set("tex-asset/x", { unrelated: true });

    const dropped = await pruneExpiredMirrors(now);
    expect(dropped).toBe(6);
    const left = [...backing.keys()].filter((k) => k.startsWith("emergency-mirror/"));
    expect(left).toHaveLength(MIRROR_MAX_SLOTS);
    expect(left).toContain("emergency-mirror/d0");
    expect(left).not.toContain(`emergency-mirror/d${MIRROR_MAX_SLOTS + 4}`);
    expect(backing.has("tex-asset/x")).toBe(true);

    // Second open in the same session: no second full read of every slot.
    reads.get = 0;
    await pruneExpiredMirrors(now);
    expect(reads.get).toBe(0);
  });
});

describe("the size estimate never becomes the allocation", () => {
  it("sizes byte arrays by length and stops at the limit", () => {
    expect(estimateStoredBytes({ bytes: new Uint8Array(1000) })).toBeGreaterThanOrEqual(1000);
    expect(estimateStoredBytes("x".repeat(100), 10)).toBe(Infinity);
  });
});

// ── The census: every module opening the shared kv store is declared ──

const SRC = join(__dirname, "..", "..");
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "__tests__" || name === "node_modules") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

describe("census — the shared virgil/kv store has no undeclared owner or slot", () => {
  const repo = join(SRC, "..");
  const owners = walk(SRC).filter((f) =>
    !f.endsWith("stored-state.ts") &&
    /createStore\(\s*["']virgil["']\s*,\s*["']kv["']\s*\)/.test(readFileSync(f, "utf8")),
  );

  it("finds the owners (the census is not vacuous)", () => {
    expect(owners.length).toBeGreaterThanOrEqual(6);
  });

  it("every module that opens the store is a declared owner", () => {
    const declared = new Set(STORED_STATE_REGISTRY.map((f) => f.owner));
    const undeclared = owners.map((f) => relative(repo, f)).filter((f) => !declared.has(f));
    expect(undeclared).toEqual([]);
  });

  it("every key/prefix constant an owner writes resolves to a declared family", () => {
    const missing: string[] = [];
    for (const f of owners) {
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(/^const [A-Z_]*(?:KEY|PREFIX)\s*=\s*"([^"]+)"/gm)) {
        const fam = familyOf(m[1]) ?? familyOf(m[1] + "x");
        if (!fam) missing.push(`${relative(repo, f)}: ${m[1]}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("every capped family names its cap", () => {
    for (const f of STORED_STATE_REGISTRY) {
      if (f.bound === "capped") expect(f.cap, f.key).toBeTruthy();
    }
  });

  it("the unbounded-by-use families read through the door", () => {
    for (const rel of ["src/lib/emergency-mirror.ts", "src/lib/tex-assets.ts"]) {
      expect(readFileSync(join(repo, rel), "utf8"), rel).toMatch(/readStoredValue/);
    }
  });
});
