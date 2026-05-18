/**
 * Fuzzy ranked search over BibEntry lists, backed by fuse.js.
 *
 * Used by all three search scopes in the Bibliography panel (Local, Global,
 * Library). Single shared primitive so the bar behaves the same regardless
 * of which scope is active.
 *
 * Behavior summary:
 *   - Multi-token queries match across fields. `iconic burge` finds
 *     Burge / Iconic Memory because `iconic` is in the title and `burge`
 *     is in the author. Fuse's `ignoreLocation: true` + default phrase
 *     matching gives token-order-independent multi-field matching.
 *   - Per-field weights (title and author dominate; year, publisher, etc.
 *     contribute secondary signal).
 *   - Diacritic folding on both indexed values and the query so e.g.
 *     "munoz" matches "Muñoz".
 *   - Per-array WeakMap cache so building the Fuse index is a one-time
 *     cost per stable entries reference (BibliographyPanel useMemo'd
 *     arrays stay stable across keystrokes).
 *
 * Note on `useExtendedSearch`: tried and rejected. Extended Search
 * tokenization (`a b` = match A AND match B) only AND's within the same
 * field, so multi-field queries like `1992 typographic` or `iconic burge`
 * silently returned nothing. Default Fuse search with `ignoreLocation`
 * handles cross-field multi-token queries naturally.
 */

import Fuse, { type IFuseOptions } from "fuse.js";
import type { BibEntry } from "@/lib/types";

/** Strip combining diacritical marks. `Muñoz` → `Munoz`, `Pöggeler` →
 *  `Poggeler`. Applied to both indexed values and queries. */
export function foldDiacritics(s: string): string {
  return s.normalize("NFD").replace(/\p{Diacritic}/gu, "");
}

const FUSE_OPTIONS: IFuseOptions<BibEntry> = {
  keys: [
    { name: "fields.title", weight: 2.0 },
    { name: "fields.author", weight: 1.8 },
    { name: "fields.editor", weight: 1.5 },
    { name: "key", weight: 1.5 },
    { name: "fields.journal", weight: 1.2 },
    { name: "fields.booktitle", weight: 1.2 },
    { name: "fields.year", weight: 1.0 },
    { name: "fields.publisher", weight: 1.0 },
  ],
  ignoreLocation: true,
  threshold: 0.35,
  minMatchCharLength: 2,
  isCaseSensitive: false,
  // Fold diacritics on the way into the index so the query can match
  // accent-free user input.
  getFn: (obj, path) => {
    const value = Fuse.config.getFn(obj, path);
    if (typeof value === "string") return foldDiacritics(value);
    if (Array.isArray(value)) {
      return value.map((v) => (typeof v === "string" ? foldDiacritics(v) : v));
    }
    return value;
  },
};

// WeakMap so old entries arrays GC normally after the source bib is
// replaced. Editing a paper's bib produces a new BibEntry[]; the previous
// array becomes unreachable and its Fuse index goes with it.
const fuseCache = new WeakMap<BibEntry[], Fuse<BibEntry>>();

/** Get (or lazily build) the Fuse index for an entries array. Memoized
 *  by reference identity — pass the same array reference across renders
 *  to hit the cache. */
export function getBibSearcher(entries: BibEntry[]): Fuse<BibEntry> {
  let fuse = fuseCache.get(entries);
  if (!fuse) {
    fuse = new Fuse(entries, FUSE_OPTIONS);
    fuseCache.set(entries, fuse);
  }
  return fuse;
}

/** The one search primitive. Builds (or reuses) a Fuse index for the
 *  entries array and returns ranked fuzzy matches.
 *
 *  Multi-token queries are AND'd at the entry level: each whitespace-
 *  separated token is fuzzy-matched against the whole entry (any field),
 *  and only entries that satisfy every token survive. The final ranking
 *  sums the per-token Fuse scores (lower = better). This makes
 *  "iconic burge" → the Burge entry whose title contains "iconic", even
 *  though no single field contains both tokens. Without this manual
 *  intersection, Fuse's phrase matching pulls in every entry that
 *  vaguely fuzzy-matches "iconic burge" as one string, drowning the
 *  intended hit in noise.
 *
 *  Empty query → returns the original `entries` (capped at `limit`) so
 *  callers can use this as a single code path. */
export function searchBibFuzzy(
  entries: BibEntry[],
  query: string,
  limit = Infinity,
): BibEntry[] {
  if (!query || !query.trim()) {
    return Number.isFinite(limit) ? entries.slice(0, limit) : entries;
  }
  const fuse = getBibSearcher(entries);
  const folded = foldDiacritics(query.trim());
  const tokens = folded.split(/\s+/).filter(Boolean);

  // Single-token: Fuse's normal ranking is what we want.
  if (tokens.length === 1) {
    const opts = Number.isFinite(limit) ? { limit } : undefined;
    return fuse.search(tokens[0], opts).map((r) => r.item);
  }

  // Multi-token: intersect per-token result sets, then sum scores.
  // First pass: per-token Fuse.search returns ranked hits per token.
  // We track, per entry, (a) which tokens it matched and (b) the
  // sum of Fuse scores across matched tokens. Entries that miss any
  // token are dropped.
  type Acc = { item: BibEntry; matched: number; score: number };
  const acc = new Map<BibEntry, Acc>();
  for (let i = 0; i < tokens.length; i++) {
    const results = fuse.search(tokens[i]);
    for (const r of results) {
      const prior = acc.get(r.item);
      // Fuse score is `undefined` when includeScore is off, but since
      // we use the default config it's always a number; default to 1
      // (worst) defensively.
      const s = typeof r.score === "number" ? r.score : 1;
      if (prior) {
        prior.matched += 1;
        prior.score += s;
      } else {
        acc.set(r.item, { item: r.item, matched: 1, score: s });
      }
    }
  }
  const survivors = [...acc.values()].filter((v) => v.matched === tokens.length);
  survivors.sort((a, b) => a.score - b.score);
  const out = survivors.map((v) => v.item);
  return Number.isFinite(limit) ? out.slice(0, limit) : out;
}
