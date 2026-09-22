/**
 * @vitest-environment jsdom
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import {
  REPO_ROOT,
  commentsStripped,
  codeOnlyLines,
  trackedFiles,
} from "@/lib/__tests__/_source-scan";
import {
  FLAG_REGISTRY,
  FLAG_KEYS,
  FLAG_ON_VALUES,
  FLAG_OFF_VALUES,
  NON_FLAG_VIRGIL_KEYS,
  isFlagKey,
  parseFlagValue,
  readFlag,
  setFlagOverride,
  clearFlagOverrides,
  type FlagKey,
} from "@/lib/feature-flags";

/**
 * FEATURE-FLAG REGISTRY CENSUS (task 2026-09-18-646).
 *
 * Virgil was steered by sixteen `localStorage` switches that nothing listed.
 * They did not agree on what "on" looked like — `"1"`, `"on"`, `!== "0"`,
 * `"off"`-reverts — so `virgil:card-tiers = "1"`, the spelling every
 * neighbouring flag used, did nothing, silently. Four readers were
 * near-byte-identical clone modules differing only in the key string, and one
 * flag PAIR had an undeclared nesting whose wrong combination dropped footnote
 * orphan records on the floor.
 *
 * The fix is a registry, a universal dialect and one reader. This census is
 * what keeps all three true — "a registry earns its name by being read":
 *
 *   leg 1  every `virgil:` string in src/** + library/** is a flag row or a
 *          declared non-flag (TOTALITY — a new key is classified or fails);
 *   leg 2  no production file reads `localStorage` for a FLAG outside the
 *          reader (the dialect cannot be re-invented);
 *   leg 3  anti-vacuity — the needles in legs 1 and 2 are replayed against the
 *          five retired shapes and must FIND each one. Both legs pass on
 *          "zero hits", which is exactly what a broken needle produces.
 *   leg 4  the rows themselves are coherent (legacy sentinel really flips the
 *          flag; `requires` names real keys and is acyclic);
 *   leg 5  the reader's semantics, including the requires edge that the
 *          orphan-record defect turned on.
 */

const SRC_ROOTS = ["src", "library"] as const;
const TS = /\.(ts|tsx)$/;

/** Production TS/TSX under the scanned roots — tests excluded (a test may
 *  legitimately poke `localStorage` directly to exercise a dialect). */
function productionFiles(): { rel: string; text: string }[] {
  const out: { rel: string; text: string }[] = [];
  for (const root of SRC_ROOTS) {
    for (const abs of trackedFiles(root, TS)) {
      const rel = path.relative(REPO_ROOT, abs);
      if (rel.includes("__tests__") || /\.test\.tsx?$/.test(rel)) continue;
      out.push({ rel, text: readFileSync(abs, "utf8") });
    }
  }
  return out;
}

/** The SSOT itself — the one file allowed to spell a flag key next to
 *  `localStorage`, and the one place every key is declared. */
const SSOT = "src/lib/feature-flags.ts";

const VIRGIL_KEY = /"(virgil:[A-Za-z0-9:_-]+)"/g;

/** Every `virgil:` literal in a file, comments stripped so a doc-comment
 *  mentioning a key is not mistaken for a read. */
function virgilKeysIn(text: string): string[] {
  return [...commentsStripped(text).matchAll(VIRGIL_KEY)].map((m) => m[1]);
}

/**
 * A line that reaches `localStorage` (or `sessionStorage`) AND names a flag —
 * the shape the registry exists to own. Line-aligned so the report is
 * actionable.
 *
 * The key may be spelled inline OR reached through a const binding: the four
 * clone modules this task retired all wrote `const FLAG_KEY = "virgil:…"` once
 * and then `getItem(FLAG_KEY)`, so a needle that only saw literals would have
 * missed the very shape it exists to catch. Bindings are folded first, and the
 * anti-vacuity leg replays that exact fixture.
 */
function flagStorageReads(text: string): { line: number; key: string }[] {
  const code = commentsStripped(text);
  // `const X = "virgil:…"` / `const X: string = "virgil:…"` in this file.
  const bound = new Map<string, string>();
  for (const m of code.matchAll(
    /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)(?:\s*:[^=]+)?\s*=\s*"(virgil:[A-Za-z0-9:_-]+)"/g,
  )) {
    if (isFlagKey(m[2])) bound.set(m[1], m[2]);
  }
  const lines = codeOnlyLines(text).split("\n");
  const raw = code.split("\n");
  const hits: { line: number; key: string }[] = [];
  lines.forEach((codeLine, i) => {
    if (!/\b(local|session)Storage\b/.test(codeLine)) return;
    // The key may sit on this line or, for a wrapped call, the next two.
    const window_ = raw.slice(i, i + 3).join("\n");
    for (const m of window_.matchAll(VIRGIL_KEY)) {
      if (isFlagKey(m[1])) hits.push({ line: i + 1, key: m[1] });
    }
    for (const [ident, key] of bound) {
      if (new RegExp(`\\b${ident}\\b`).test(window_)) hits.push({ line: i + 1, key });
    }
  });
  return hits;
}

describe("feature-flag registry census", () => {
  // ── leg 1 — totality ──────────────────────────────────────────────────
  it("every virgil: key in src/** and library/** is a flag row or a declared non-flag", () => {
    const unclassified: string[] = [];
    for (const { rel, text } of productionFiles()) {
      for (const key of virgilKeysIn(text)) {
        if (isFlagKey(key)) continue;
        if (key in NON_FLAG_VIRGIL_KEYS) continue;
        unclassified.push(`${rel}: ${key}`);
      }
    }
    expect(
      unclassified,
      "A new `virgil:` key must be declared: a boolean switch goes in FLAG_REGISTRY, " +
        "stored data or an event name goes in NON_FLAG_VIRGIL_KEYS.",
    ).toEqual([]);
  });

  it("no declared non-flag key is actually a flag key (the two tables are disjoint)", () => {
    const overlap = Object.keys(NON_FLAG_VIRGIL_KEYS).filter(isFlagKey);
    expect(overlap).toEqual([]);
  });

  // ── leg 2 — one reader ────────────────────────────────────────────────
  it("no production file reads localStorage for a flag outside the SSOT", () => {
    const offenders: string[] = [];
    for (const { rel, text } of productionFiles()) {
      if (rel === SSOT) continue;
      for (const hit of flagStorageReads(text)) {
        offenders.push(`${rel}:${hit.line} — ${hit.key}`);
      }
    }
    expect(
      offenders,
      "Read the flag through `readFlag(key)`; the dialect and the failure " +
        "branches are decided once, in " + SSOT + ".",
    ).toEqual([]);
  });

  it("every declared flag row is actually reachable — nothing is a dead row", () => {
    // A flag's key appears in the SSOT (its row) and its reader appears
    // somewhere: either a `readFlag("key")` call, or a named wrapper module.
    const all = productionFiles();
    const outsideSsot = all.filter((f) => f.rel !== SSOT);
    const unread: string[] = [];
    for (const key of FLAG_KEYS) {
      const read = outsideSsot.some((f) =>
        commentsStripped(f.text).includes(`readFlag("${key}")`),
      );
      if (!read) unread.push(key);
    }
    expect(
      unread,
      "A registry earns its name by being read: every row needs a `readFlag` caller.",
    ).toEqual([]);
  });

  // ── leg 3 — anti-vacuity ──────────────────────────────────────────────
  describe("anti-vacuity — the needles find the shapes that were retired", () => {
    // The five dialects that existed before the registry, replayed verbatim.
    const RETIRED = {
      'equals "1"': `const FLAG_KEY = "virgil:identity-cascade";
        export function isOn() { return window.localStorage.getItem(FLAG_KEY) === "1"; }`,
      'equals "on"': `export function cardTiersEnabled(): boolean {
        return typeof localStorage !== "undefined" &&
          localStorage.getItem("virgil:card-tiers") === "on";
      }`,
      'not "0" (default ON)': `export function canProducePendingChanges(): boolean {
        return window.localStorage.getItem("virgil:pending-changes") !== "0";
      }`,
      'not "off" (kill-switch)': `export function geomHoverEnabled(): boolean {
        return localStorage.getItem("virgil:geom-hover") !== "off";
      }`,
      'multi-value opt-out': `const v = window.localStorage.getItem("virgil:multi-doc-keepalive");
        return v !== "0" && v !== "false";`,
    };

    for (const [name, fixture] of Object.entries(RETIRED)) {
      it(`leg 2's needle finds the retired ${name} reader`, () => {
        // A `const FLAG_KEY = "…"` indirection is deliberately NOT resolved by
        // the needle; what it must catch is a key spelled near a storage call.
        const hits = flagStorageReads(fixture);
        expect(hits.length, `needle missed: ${fixture}`).toBeGreaterThan(0);
      });
    }

    it("leg 1's needle finds a key in code and ignores one in a comment", () => {
      expect(virgilKeysIn(`const k = "virgil:made-up-key";`)).toEqual([
        "virgil:made-up-key",
      ]);
      expect(virgilKeysIn(`// mentions "virgil:made-up-key" in prose`)).toEqual([]);
    });

    it("leg 2's needle ignores a storage line with no flag key, and a flag key with no storage", () => {
      expect(flagStorageReads(`localStorage.getItem("some-other-key");`)).toEqual([]);
      expect(flagStorageReads(`readFlag("virgil:card-tiers");`)).toEqual([]);
    });

    it("the SSOT's exemption is load-bearing — it really is the file that touches localStorage", () => {
      const ssot = commentsStripped(
        readFileSync(path.join(REPO_ROOT, SSOT), "utf8"),
      );
      // The one production read, now with a VARIABLE key — which is why leg
      // 2's literal-and-binding needle does not flag it, and therefore why the
      // exemption must stay honest about what it exempts. If this read ever
      // moves back to a literal, leg 2 would flag the SSOT and the exemption
      // would start hiding a real hit.
      expect(ssot).toMatch(/window\.localStorage\.getItem\(key\)/);
      expect(flagStorageReads(ssot)).toEqual([]);
    });

    it("the scan actually sees the tree", () => {
      const files = productionFiles();
      expect(files.length).toBeGreaterThan(500);
      expect(files.some((f) => f.rel === SSOT)).toBe(true);
      expect(files.some((f) => f.rel.startsWith("library/"))).toBe(true);
    });
  });

  // ── leg 4 — the rows are coherent ─────────────────────────────────────
  describe("row coherence", () => {
    it("every legacy sentinel really flips its flag away from the default", () => {
      for (const key of FLAG_KEYS) {
        const spec = FLAG_REGISTRY[key];
        expect(
          parseFlagValue(spec.legacy),
          `${key}: legacy "${spec.legacy}" must parse to ${!spec.default}`,
        ).toBe(!spec.default);
      }
    });

    it("every `requires` edge names a real key, and the graph is acyclic", () => {
      for (const key of FLAG_KEYS) {
        for (const dep of FLAG_REGISTRY[key].requires) {
          expect(isFlagKey(dep), `${key} requires unknown "${dep}"`).toBe(true);
        }
      }
      const seen = new Set<FlagKey>();
      const walk = (key: FlagKey, stack: FlagKey[]): void => {
        expect(stack.includes(key), `cycle: ${[...stack, key].join(" → ")}`).toBe(
          false,
        );
        if (seen.has(key)) return;
        seen.add(key);
        for (const dep of FLAG_REGISTRY[key].requires as readonly FlagKey[]) {
          walk(dep, [...stack, key]);
        }
      };
      for (const key of FLAG_KEYS) walk(key, []);
    });

    it("a `ssr` value is declared only where it differs from the default", () => {
      for (const key of FLAG_KEYS) {
        const spec: { default: boolean; ssr?: boolean } = FLAG_REGISTRY[key];
        if (spec.ssr === undefined) continue;
        expect(spec.ssr, `${key}: redundant ssr — it equals default`).not.toBe(
          spec.default,
        );
      }
    });

    it("every row carries a non-empty note and a known status", () => {
      const statuses = new Set(["kill-switch", "soak", "rollout", "dev"]);
      for (const key of FLAG_KEYS) {
        const spec = FLAG_REGISTRY[key];
        expect(spec.note.length, `${key}: empty note`).toBeGreaterThan(10);
        expect(statuses.has(spec.status), `${key}: ${spec.status}`).toBe(true);
      }
    });

    it("the on and off vocabularies are disjoint", () => {
      for (const v of FLAG_ON_VALUES) expect(FLAG_OFF_VALUES).not.toContain(v);
    });
  });
});

describe("readFlag", () => {
  afterEach(() => {
    clearFlagOverrides();
    try {
      localStorage.clear();
    } catch {
      /* jsdom always has it; belt and braces */
    }
  });

  // ── leg 5 — the reader's semantics ────────────────────────────────────
  it("parses the universal dialect in both directions, case- and space-insensitively", () => {
    for (const v of ["1", "true", "on", "yes", "ON", " Yes "]) {
      expect(parseFlagValue(v), v).toBe(true);
    }
    for (const v of ["0", "false", "off", "no", "OFF", " No "]) {
      expect(parseFlagValue(v), v).toBe(false);
    }
    for (const v of [null, undefined, "", "maybe", "2"]) {
      expect(parseFlagValue(v), String(v)).toBe(null);
    }
  });

  it("honours every row's default when the key is unset", () => {
    for (const key of FLAG_KEYS) {
      const spec = FLAG_REGISTRY[key];
      if (spec.requires.length > 0) continue; // covered by the requires leg
      expect(readFlag(key), key).toBe(spec.default);
    }
  });

  it("an unrecognised stored value falls back to the default, it does not flip the flag", () => {
    localStorage.setItem("virgil:card-tiers", "definitely");
    expect(readFlag("virgil:card-tiers")).toBe(false);
    localStorage.setItem("virgil:geom-hover", "definitely");
    expect(readFlag("virgil:geom-hover")).toBe(true);
  });

  it("the legacy sentinel of every flag still works — no switch already set changes meaning", () => {
    for (const key of FLAG_KEYS) {
      const spec = FLAG_REGISTRY[key];
      // Satisfy any parent so the row's own value is what is being read.
      for (const dep of spec.requires as readonly FlagKey[]) {
        setFlagOverride(dep, true);
      }
      localStorage.setItem(key, spec.legacy);
      expect(readFlag(key), `${key} = "${spec.legacy}"`).toBe(!spec.default);
      localStorage.removeItem(key);
      clearFlagOverrides();
    }
  });

  it('the soak flags now accept "1" — the spelling every neighbouring flag used', () => {
    localStorage.setItem("virgil:card-tiers", "1");
    expect(readFlag("virgil:card-tiers")).toBe(true);
    localStorage.setItem("virgil:perf-contain", "1");
    expect(readFlag("virgil:perf-contain")).toBe(true);
  });

  it("a throwing localStorage reads as the default — for a default-ON flag too", () => {
    const spy = vi
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(() => {
        throw new Error("blocked site data");
      });
    try {
      expect(readFlag("virgil:pending-changes")).toBe(true); // default ON
      expect(readFlag("virgil:card-tiers")).toBe(false); // default OFF
      expect(readFlag("virgil:geom-hover")).toBe(true); // kill-switch ON
    } finally {
      spy.mockRestore();
    }
  });

  it("an override forces the flag and `undefined` clears it", () => {
    setFlagOverride("virgil:card-tiers", true);
    expect(readFlag("virgil:card-tiers")).toBe(true);
    setFlagOverride("virgil:card-tiers", undefined);
    expect(readFlag("virgil:card-tiers")).toBe(false);
  });
});

describe("requires — the incoherent flag combination is unrepresentable", () => {
  beforeEach(() => clearFlagOverrides());
  afterEach(() => {
    clearFlagOverrides();
    localStorage.clear();
    vi.restoreAllMocks();
  });

  /**
   * The defect this edge exists for: `virgil:inline-atom-lifecycle` gates a
   * reconciler that registers as a POLICY on the identity-bus consumer, and
   * that consumer only exists when `virgil:identity-cascade` is on. With the
   * child ON and the parent OFF, BOTH footnote-orphan writers went dark — the
   * legacy event bridges bailed *because the child flag was on*, and the
   * reconciler never registered *because there was no consumer*. A deleted
   * footnote was dropped instead of recorded as an orphan.
   *
   * Making the child read OFF restores the legacy bridges, so an orphan record
   * is written on every reachable combination.
   */
  it("child ON + parent OFF reads OFF, so the legacy orphan writer still runs", () => {
    localStorage.setItem("virgil:inline-atom-lifecycle", "1");
    expect(readFlag("virgil:identity-cascade")).toBe(false);
    expect(readFlag("virgil:inline-atom-lifecycle")).toBe(false);
  });

  it("the named door agrees with the registry", async () => {
    const { isInlineAtomLifecycleOn } = await import(
      "@/lib/identity/inline-atom-lifecycle-flag"
    );
    const { isIdentityCascadeOn } = await import("@/lib/identity/identity-flag");
    localStorage.setItem("virgil:inline-atom-lifecycle", "1");
    expect(isIdentityCascadeOn()).toBe(false);
    expect(isInlineAtomLifecycleOn()).toBe(false);
    localStorage.setItem("virgil:identity-cascade", "1");
    expect(isInlineAtomLifecycleOn()).toBe(true);
  });

  it("an override cannot escape the requirement either — not even in a test", () => {
    setFlagOverride("virgil:inline-atom-lifecycle", true);
    expect(readFlag("virgil:inline-atom-lifecycle")).toBe(false);
    setFlagOverride("virgil:identity-cascade", true);
    expect(readFlag("virgil:inline-atom-lifecycle")).toBe(true);
  });

  it("with the parent on, the child behaves as an ordinary default-OFF flag", () => {
    setFlagOverride("virgil:identity-cascade", true);
    expect(readFlag("virgil:inline-atom-lifecycle")).toBe(false);
    localStorage.setItem("virgil:inline-atom-lifecycle", "1");
    expect(readFlag("virgil:inline-atom-lifecycle")).toBe(true);
  });

  it("warns once per unmet edge in dev — a per-read warn would be its own perf bug", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    setFlagOverride("virgil:inline-atom-lifecycle", true);
    for (let i = 0; i < 5; i++) readFlag("virgil:inline-atom-lifecycle");
    expect(warn.mock.calls.length).toBeLessThanOrEqual(1);
  });
});
