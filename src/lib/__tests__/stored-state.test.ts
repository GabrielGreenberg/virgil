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
import { readFileSync } from "node:fs";
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
  __resetTickersForTests,
  clearMirror,
  clearMirrorOffer,
  clearMirrorOffers,
  createMirrorTicker,
  openMirrorRecovery,
  readNextMirrorOffer,
  registerMirrorTicker,
  writeMirror,
  pruneExpiredMirrors,
  readMirror,
  type EmergencyMirrorEntry,
} from "@/lib/emergency-mirror";
import { walkFiles } from "./_source-scan";

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
  __resetTickersForTests();
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
  it("a corrupt slot is ABSENT at open and reported — but NOT deleted (task 851: it may be the only copy)", async () => {
    const bad = { docId: "a", savedAt: Date.now(), hash: "h", content: "not a model" };
    backing.set("emergency-mirror/a", bad);
    expect(await readMirror("a")).toBeNull();
    expect(backing.get("emergency-mirror/a")).toEqual(bad);
    expect(getStoredStateRefusals().at(-1)).toMatchObject({
      key: "emergency-mirror/a",
      why: "invalid",
      cleared: false,
    });
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
    // Task 850 — the ref bail REPLAYS the verdict. Pre-850 this said
    // "unchanged", which the reload door read as "already mirrored".
    expect(await t.tick()).toBe("oversized");
    expect(stringify.mock.calls.length).toBe(calls);
    expect(write).not.toHaveBeenCalled();
    stringify.mockRestore();
  });

  it("the sweep runs ONCE per session and keeps only the newest MIRROR_MAX_SLOTS — by count alone, leaving malformed slots, reporting each eviction", async () => {
    const now = Date.now();
    for (let i = 0; i < MIRROR_MAX_SLOTS + 5; i++) {
      backing.set(`emergency-mirror/d${i}`, mirror(`d${i}`, now - i * 1000));
    }
    backing.set("emergency-mirror/bad", 42);
    backing.set("tex-asset/x", { unrelated: true });

    const dropped = await pruneExpiredMirrors();
    expect(dropped).toBe(5);
    const left = [...backing.keys()].filter((k) => k.startsWith("emergency-mirror/"));
    expect(left).toHaveLength(MIRROR_MAX_SLOTS + 1);
    expect(left, "a slot the sweep cannot read is left, not deleted").toContain(
      "emergency-mirror/bad",
    );
    expect(left).toContain("emergency-mirror/d0");
    expect(left).not.toContain(`emergency-mirror/d${MIRROR_MAX_SLOTS + 4}`);
    expect(backing.has("tex-asset/x")).toBe(true);
    expect(getStoredStateRefusals().filter((r) => r.why === "evicted")).toHaveLength(5);

    // Second open in the same session: no second full read of every slot.
    reads.get = 0;
    await pruneExpiredMirrors();
    expect(reads.get).toBe(0);
  });

  it("task 851 · no age rule — a months-old mirror is still unlanded work, kept by read and by sweep", async () => {
    const old = mirror("a", Date.now() - 400 * 24 * 60 * 60 * 1000);
    backing.set("emergency-mirror/a", old);
    expect((await readMirror("a"))?.docId).toBe("a");
    expect(await pruneExpiredMirrors()).toBe(0);
    expect(backing.get("emergency-mirror/a")).toEqual(old);
  });

  it("task 851 · the count cap spares a document open in this window (its ticker's fingerprint would go stale)", async () => {
    const now = Date.now();
    for (let i = 0; i < MIRROR_MAX_SLOTS; i++) {
      backing.set(`emergency-mirror/d${i}`, mirror(`d${i}`, now - i * 1000));
    }
    // The OLDEST slot belongs to an open document.
    backing.set("emergency-mirror/open", mirror("open", now - 10_000_000));
    registerMirrorTicker("open", createMirrorTicker({ docId: "open", getModel: () => null, windowId: "w" }));
    expect(await pruneExpiredMirrors()).toBe(1);
    expect(backing.has("emergency-mirror/open")).toBe(true);
    expect(backing.has(`emergency-mirror/d${MIRROR_MAX_SLOTS - 1}`)).toBe(false);
  });
});

describe("task 851 · an unanswered mirror ends only by the answer, or a landed write of THAT content", () => {
  const at = (docId: string, hash: string, savedAt: number) => ({ ...mirror(docId, savedAt), hash });

  it("the open PROMOTES a surviving mirror out of the live slot; the new session's ticker and landed save cannot touch it", async () => {
    const survivor = at("a", "crashed-work", 1000);
    backing.set("emergency-mirror/a", survivor);

    const offer = await openMirrorRecovery("a", "disk");
    expect(offer).toEqual(survivor);
    expect(backing.has("emergency-mirror/a"), "the live slot is free for this session").toBe(false);
    expect(backing.get("emergency-mirror-offer/a/crashed-work")).toEqual(survivor);

    // The new session: its ticker writes the live slot, then its first save lands.
    await writeMirror(at("a", "new-session", 2000));
    await clearMirror("a");
    expect(
      backing.get("emergency-mirror-offer/a/crashed-work"),
      "pre-851 the landed save deleted the ONLY copy of the unanswered work",
    ).toEqual(survivor);

    // A second crash before the answer: the reopen still offers it.
    expect(await openMirrorRecovery("a", "disk")).toEqual(survivor);
  });

  it("two unanswered generations are both kept: newest offered first, the older raised once that is answered", async () => {
    backing.set("emergency-mirror-offer/a/first", at("a", "first", 1000));
    backing.set("emergency-mirror/a", at("a", "second", 2000));
    const offer = await openMirrorRecovery("a", "disk");
    expect(offer?.hash).toBe("second");
    await clearMirrorOffer(offer!);
    expect((await readNextMirrorOffer("a"))?.hash).toBe("first");
    await clearMirrorOffer({ docId: "a", hash: "first" });
    expect(await readNextMirrorOffer("a")).toBeNull();
  });

  it("a slot whose content IS what was loaded reached disk — cleared, live or offer", async () => {
    backing.set("emergency-mirror/a", at("a", "disk", 2000));
    backing.set("emergency-mirror-offer/a/disk2", at("a", "disk2", 1000));
    expect((await openMirrorRecovery("a", "disk"))?.hash, "the other offer still stands").toBe("disk2");
    expect(backing.has("emergency-mirror/a")).toBe(false);
    expect(await openMirrorRecovery("a", "disk2")).toBeNull();
    expect(backing.has("emergency-mirror-offer/a/disk2")).toBe(false);
  });

  it("an offer slot the reader cannot parse is left in place", async () => {
    backing.set("emergency-mirror-offer/a/x", { docId: "a", junk: true });
    expect(await openMirrorRecovery("a", "disk")).toBeNull();
    expect(backing.has("emergency-mirror-offer/a/x")).toBe(true);
  });

  it("purgeDoc's door retires every offer slot of the doc id, and no other doc's", async () => {
    backing.set("emergency-mirror-offer/a/one", at("a", "one", 1));
    backing.set("emergency-mirror-offer/a/two", at("a", "two", 2));
    backing.set("emergency-mirror-offer/b/one", at("b", "one", 1));
    await clearMirrorOffers("a");
    expect([...backing.keys()]).toEqual(["emergency-mirror-offer/b/one"]);
  });

  it("the offer family is DECLARED in the registry, as its own family", () => {
    expect(familyOf("emergency-mirror-offer/a/h")?.key).toBe("emergency-mirror-offer/");
    expect(familyOf("emergency-mirror/a")?.key).toBe("emergency-mirror/");
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
  for (const p of walkFiles(dir, { skipDirs: ["__tests__"] })) if (/\.(ts|tsx)$/.test(p)) out.push(p);
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

  // Task 852 — task 757's rule "a read of a capped store goes through
  // readStoredValue" had no leg: four owners still handed raw `get` results to
  // their callers. Every raw idb-keyval `get(` in an owner must name its key
  // by a KEY/PREFIX constant that resolves to a FIXED family; a capped family,
  // or a key the census cannot resolve (a local, a helper call), must go
  // through the door.
  it("task 852 · no owner reads a capped family (or an unresolvable key) around the door", () => {
    const offenders: string[] = [];
    let rawReads = 0;
    for (const f of owners) {
      const src = readFileSync(f, "utf8");
      const consts = new Map<string, string>();
      for (const m of src.matchAll(/^const ([A-Z_]*(?:KEY|PREFIX))\s*=\s*"([^"]+)"/gm)) {
        consts.set(m[1], m[2]);
      }
      for (const m of src.matchAll(/(?<![.\w])get\s*(?:<[^>()]*>)?\(\s*([^,)]*)/g)) {
        rawReads++;
        const arg = m[1].trim();
        const head = /^([A-Z_]+)\b/.exec(arg)?.[1];
        const lit = head ? consts.get(head) : undefined;
        const fam = lit === undefined ? null : (familyOf(lit) ?? familyOf(lit + "x"));
        if (!fam || fam.bound !== "fixed") {
          const line = src.slice(0, m.index).split("\n").length;
          offenders.push(`${relative(repo, f)}:${line} get(${arg}) → ${fam ? fam.key : "unresolved"}`);
        }
      }
    }
    expect(rawReads, "the scan found no raw reads at all — is it vacuous?").toBeGreaterThan(0);
    expect(offenders).toEqual([]);
  });

  it("the unbounded-by-use families read through the door", () => {
    for (const rel of ["src/lib/emergency-mirror.ts", "src/lib/tex-assets.ts"]) {
      expect(readFileSync(join(repo, rel), "utf8"), rel).toMatch(/readStoredValue/);
    }
  });
});
