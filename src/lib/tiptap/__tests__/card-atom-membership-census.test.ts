// Task 1133 — the CENSUS for the registry's MEMBERSHIP half.
//
// `card-atom-idattr-census` pins two shapes of drift for the Card-bearing
// atoms: restating a row's {nodeName, idAttr} PAIR, and enumerating their id
// attrs as a list. It left the third shape open — restating the KIND SET
// itself: "is this a footnote or a citation?". That question was spelled by
// hand at nine sites (`ref.kind === "footnote" || ref.kind === "citation"` in
// placement, the anchor-highlight reconciler, the hover bridge and the
// lifecycle policy's re-point; `for (const kind of ["footnote", "citation"])`
// in the lifecycle policy and two dev canaries; and `isInlineAtomCardKind`
// itself, an explicit literal). The atom registry already published the set,
// derived (`CARD_ATOMS` / `CardAtomKind`, `idAttr !== null`), so a third
// Card-bearing atom would have joined the registry and none of those sites.
//
// THE INVARIANT, two needles over code (comments stripped, literals kept):
//   C1. a COMPARISON CHAIN — one `||`/`&&` expression holding a `===`/`!==`
//       test against EVERY card-atom kind literal.
//   C2. an ARRAY LITERAL whose string elements are EXACTLY the card-atom kinds.
// Either is the registry's set, restated. Read `isInlineAtomCardKind`
// (`@/cards/predicates`), `isCardAtomKind` or `CARD_ATOMS` instead.
//
// ALLOWLIST EMPTY. Anti-vacuity: every retired shape is replayed as a fixture,
// and the vocabulary is DERIVED from the registry.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { strip, walkFiles } from "@/lib/__tests__/_source-scan";
import { CARD_ATOMS } from "@/lib/tiptap/atom-registry";

const REPO = resolve(__dirname, "../../../..");
const ROOTS = ["src", "library"];

const KINDS = CARD_ATOMS.map((m) => m.kind as string);
/** One comparison of a value against a string literal (`k === "footnote"`). */
const TERM = String.raw`[\w$.?\]\[]+\s*[!=]==\s*["'\`][^"'\`\n]*["'\`]`;
/** A CHAIN of such comparisons joined by `||` / `&&` — one boolean expression,
 *  which may wrap lines. Per-kind dispatch in separate statements
 *  (`if (t === "citation") …; if (t === "footnote") …`) is not a chain. */
const CHAIN = new RegExp(`${TERM}(?:\\s*(?:\\|\\||&&)\\s*${TERM})+`, "g");
const TERM_LITERAL = /[!=]==\s*["'`]([^"'`\n]*)["'`]/g;
const ARRAY_LITERAL = /\[([^[\]]*)\]/g;
const STRING_ELEMENT = /^\s*["'`]([^"'`]*)["'`]\s*$/;

function walk(dir: string, out: string[] = []): string[] {
  for (const p of walkFiles(dir, { skipDirs: ["__tests__"] })) {
    if (/\.tsx?$/.test(p) && !/\.test\.tsx?$/.test(p)) out.push(p);
  }
  return out;
}

const FILES = ROOTS.flatMap((r) => walk(join(REPO, r))).map((f) => ({
  rel: relative(REPO, f),
  // Comments stripped (prose may NAME the retired shape), literals kept (every
  // needle matches inside one), lines aligned (each hit reports `file:line`).
  src: strip(readFileSync(f, "utf8"), true, true),
}));

const lineOf = (src: string, index: number) => src.slice(0, index).split("\n").length;

const chainHits = (src: string): number[] => {
  const out: number[] = [];
  for (const m of src.matchAll(CHAIN)) {
    const lits = new Set([...m[0].matchAll(TERM_LITERAL)].map((t) => t[1]));
    if (KINDS.every((k) => lits.has(k))) out.push(lineOf(src, m.index));
  }
  return out;
};

const arrayHits = (src: string): number[] => {
  const out: number[] = [];
  for (const m of src.matchAll(ARRAY_LITERAL)) {
    const parts = m[1].split(",").filter((p) => p.trim() !== "");
    const els = parts.map((p) => STRING_ELEMENT.exec(p)?.[1]);
    if (els.some((e) => e === undefined)) continue;
    const set = new Set(els as string[]);
    if (set.size === KINDS.length && KINDS.every((k) => set.has(k))) {
      out.push(lineOf(src, m.index));
    }
  }
  return out;
};

const report = (hits: (src: string) => number[]) =>
  FILES.flatMap(({ rel, src }) => hits(src).map((l) => `${rel}:${l}`));

describe("the Card-bearing atom KIND SET lives only in the registry (task 1133)", () => {
  it("C1 · ALLOWLIST EMPTY — no production file tests membership by a comparison chain", () => {
    expect(
      report(chainHits),
      "a hand-spelled `k === \"footnote\" || k === \"citation\"` — call " +
        "isInlineAtomCardKind / isCardAtomKind instead; never allowlist it",
    ).toEqual([]);
  });

  it("C2 · ALLOWLIST EMPTY — no production file lists the card-atom kinds as literals", () => {
    expect(
      report(arrayHits),
      "a hand-written card-atom kind list — iterate CARD_ATOMS instead; never allowlist it",
    ).toEqual([]);
  });
});

describe("the census can SEE what it forbids (task 1133 — anti-vacuity)", () => {
  const RETIRED: ReadonlyArray<[string, string, "C1" | "C2"]> = [
    [
      "usePlacement / reconciler branch",
      'if (ref.kind === "footnote" || ref.kind === "citation") {',
      "C1",
    ],
    [
      "lifecycle-policy expanded-set skip (negated)",
      'if (ref.kind !== "footnote" && ref.kind !== "citation") continue;',
      "C1",
    ],
    [
      "isInlineAtomCardKind literal (split across lines)",
      'export const isInlineAtomCardKind = (k: CardKind): boolean =>\n  k === "footnote" || k === "citation";',
      "C1",
    ],
    [
      "lifecycle-policy float-key loop / dev canaries",
      'for (const kind of ["footnote", "citation"] as const) {',
      "C2",
    ],
  ];

  for (const [name, fixture, needle] of RETIRED) {
    it(`${needle} still matches: ${name}`, () => {
      const src = strip(fixture, true, true);
      const hits = needle === "C1" ? chainHits(src) : arrayHits(src);
      expect(hits.length, `needle ${needle} no longer sees this shape`).toBeGreaterThan(0);
    });
  }

  it("a SUPERSET list and a single-kind test are not hits", () => {
    expect(arrayHits('["footnote", "citation", "note"]')).toEqual([]);
    expect(chainHits('if (k === "footnote") return;')).toEqual([]);
    // Per-kind DISPATCH (the serializer's / getCitationOrder's shape) is not a
    // membership test — each statement names one kind.
    expect(
      chainHits('if (t === "citation") a();\nif (t === "footnote" && x) b();'),
    ).toEqual([]);
  });

  it("the scan reaches real files, and the vocabulary is DERIVED", () => {
    expect(FILES.length).toBeGreaterThan(100);
    expect(FILES.some((f) => f.rel === "src/lib/tiptap/atom-registry.ts")).toBe(true);
    expect(KINDS.length).toBeGreaterThanOrEqual(2);
    expect(KINDS).not.toContain("ref");
    expect(KINDS).not.toContain("inline-math");
  });
});
