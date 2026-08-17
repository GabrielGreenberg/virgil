/**
 * Per-serialize requirement collector (P4 — requirements by emission).
 *
 * The drift class P4 dissolves: two modules used to answer "what packages does
 * this LaTeX need?" independently — the serializer decided WHAT to emit, and
 * latex-requirements.ts GUESSED the packages by regex-scanning the serialized
 * string afterwards. Every construct was specified twice and the two specs
 * rotted apart (xlist→expex, `\tikz` inline, `\RequirePackage{biblatex}`).
 *
 * The fix makes emission and requirement ONE declaration at ONE site: the
 * serializer threads a `RequirementCollector` through its walk and each emit-
 * site that produces package-bound LaTeX calls `collect.need("expex")` /
 * `collect.needBibFamily(...)` / `collect.need("tikz")` ADJACENT to the bytes
 * it writes. A new construct then physically cannot be emitted without its
 * requirement.
 *
 * The after-the-fact detector (`detectBodyRequirements`) is NOT deleted — it
 * is demoted to a FALLBACK/AUDIT layer for hand-typed raw LaTeX that never
 * flows through a modeled emit-site (texBlock passthrough, figure extras, raw
 * commands a user typed into prose). Because the serializer UNIONs the
 * declared set with the detected set (never intersect/subtract), the result
 * can only ever be a superset-improvement over the old detector — which is
 * what keeps the change byte-stable for existing docs.
 *
 * The shared vocabulary predicates (`PACKAGE_DETECTORS`, and `TIKZ_RE` inside
 * it) live HERE and are imported by BOTH the co-located emit-site declarations
 * and the fallback detector, so the two layers call the SAME predicates and can
 * never diverge.
 */

import type { BibFamily } from "@/lib/bib-family";

/**
 * Shared tikz vocabulary. Broadened past the legacy `\begin{tikzpicture}`-only
 * detector to cover the constructs that reach the serializer through raw
 * passthrough (texBlock / figure extras):
 *   \begin{tikzpicture} | \begin{tikzcd} | \tikz inline (word-boundary) |
 *   \begin{axis} (pgfplots) | \usepackage{...pgfplots...} | \begin{pgfplots...}
 *
 * `\tikz(?![a-zA-Z])` boundary-guards the inline form so `\tikzstyle` etc. are
 * not double-counted as a bare `\tikz` (they still legitimately need tikz, so
 * the match is harmless either way — the guard is for cleanliness). Both
 * readers run it over the INERT-STRIPPED projection (the co-located
 * declaration over a texBlock/figure's projected raw bytes, the fallback over
 * the projected body), so the `\begin{axis}` false-positive risk (a non-pgf
 * `axis` env) is bounded to live LaTeX the user typed.
 */
export const TIKZ_RE =
  /\\begin\{tikzpicture\}|\\begin\{tikzcd\}|\\tikz(?![a-zA-Z])|\\begin\{axis\}|\\usepackage(?:\[[^\]]*\])?\{[^}]*pgfplots[^}]*\}|\\begin\{pgfplots[^}]*\}/;

/**
 * The package vocabulary a byte-SCAN answers with: `{ id, re }` per package
 * requirement, run against LaTeX source to ask "does this text use it?".
 *
 * ONE table, two readers — the only two scanners that ask THIS question about
 * THIS vocabulary (the repo has other byte scanners: the cite-family scan in
 * the same function, `detectBibFamily`, document-class detection). They are:
 *
 *  - `detectBodyRequirements` (latex-requirements.ts) — the after-the-fact
 *    FALLBACK over the whole serialized body;
 *  - `declareFromRawLatex` (latex-serializer.ts) — the emit-site declaration
 *    for a raw-passthrough block (a `texBlock`'s `code`, a `figureBlock`'s
 *    `extras`), the one input class where the emitter cannot know what the
 *    bytes mean and so has to scan them.
 *
 * Before task 345 only `TIKZ_RE` was shared and the other four regexes were
 * hand-copied between the two, byte-for-byte — the P4 collector header above
 * describes the shared-predicate design that the copies had already half
 * escaped. The regexes were identical when they were unified, so the move is
 * byte-neutral; what it buys is that the next vocabulary change cannot land in
 * one half only.
 *
 * NOTE the OTHER half of the same law, which lives at each reader rather than
 * here: a byte SCAN is a detection, so it believes only bytes the compiler
 * would — both readers project through `projectDetectableLatex` first. A
 * requirement declared from the NODE MODEL (the serializer knows an
 * `exampleBlock` emits `\ex`, a `graphicsBlock` an `\includegraphics`) searches
 * for nothing and needs no projection; those `need()` sites do not read this
 * table.
 *
 * These five patterns are module-level singletons read by two call sites, so
 * none may carry `/g` or `/y` — `lastIndex` would persist across `.test()`
 * calls and skip matches on alternate ones. Pinned in
 * raw-passthrough-declaration.test.ts.
 */
export const PACKAGE_DETECTORS: ReadonlyArray<{
  readonly id: string;
  readonly re: RegExp;
}> = [
  {
    id: "expex",
    re: /\\(?:begingl|getfullref|getref|pex|ex)(?![a-zA-Z])|\\begin\{xlist\}/,
  },
  // A nested example tier needs the `xlist` environment defined (see the
  // `xlistenv` requirement); expex itself does not provide it.
  { id: "xlistenv", re: /\\begin\{xlist\}/ },
  { id: "graphicx", re: /\\includegraphics(?![a-zA-Z])/ },
  { id: "tikz", re: TIKZ_RE },
  { id: "xcolor", re: /\\textcolor(?![a-zA-Z])/ },
];

/**
 * A per-serialize requirement collector. Mutable set-wrapper: emit-sites push
 * into it, `serializeToLatex` reads `ids`/`bibFamily` after the walk.
 */
export interface RequirementCollector {
  /** Declare a package/shim requirement id (`"expex"`, `"graphicx"`,
   *  `"xcolor"`, `"tikz"`, `"xlistenv"`). Idempotent. */
  need(id: string): void;
  /** Declare a bib-family need from a classified cite command. `null` (a
   *  shared/kernel cite that pins neither family) is ignored — SHARED-only
   *  bodies are resolved by the fallback detector's baseline default so byte
   *  output is unchanged. A concrete family is recorded; the FIRST concrete
   *  family wins (natbib is Virgil's baseline, so an early natbib-only cite
   *  pins natbib even if a later biblatex-only cite also appears — matching the
   *  legacy detector's "prefer natbib when both appear" rule). */
  needBibFamily(fam: BibFamily | null): void;
  /** The declared package/shim ids. */
  readonly ids: Set<string>;
  /** The declared bib family, or null when no cite emit-site pinned one. */
  readonly bibFamily: BibFamily | null;
}

export function createRequirementCollector(): RequirementCollector {
  const ids = new Set<string>();
  let bibFamily: BibFamily | null = null;
  return {
    need(id: string) {
      ids.add(id);
    },
    needBibFamily(fam: BibFamily | null) {
      if (!fam) return;
      // First concrete family wins → preserves the legacy "prefer natbib when
      // both families appear" behavior, since natbib is the baseline and the
      // detector resolved ties to natbib. Emit order follows document order,
      // so if a doc has natbib-only cites they are typically declared first;
      // but to be robust to order we bias toward natbib explicitly.
      if (bibFamily === null) {
        bibFamily = fam;
      } else if (bibFamily !== fam) {
        // Two different concrete families in one body — bias to natbib
        // (baseline), matching detectBodyRequirements' precedence.
        bibFamily = "natbib";
      }
    },
    get ids() {
      return ids;
    },
    get bibFamily() {
      return bibFamily;
    },
  };
}
