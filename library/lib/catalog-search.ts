// Flexible, multi-token, diacritic-folding search over the Library catalog.
//
// UNIFY-not-duplicate: rather than hand-rolling a matcher (the old
// `hay.includes(q)` in LeftList that couldn't bridge tokens across fields —
// "lewis score" never matched David Lewis / "Scorekeeping in a Language
// Game"), this routes the catalog through the SAME fuzzy searcher the main
// app's Bibliography panel, bib pickers, and citekey picker already use:
// `searchBibFuzzy`. One matcher, one behaviour, everywhere.
//
// Sanctioned cross-silo import (see library/AGENTS.md): the bridge list is
// narrow, but search unification is the architectural justification — and
// `@/lib/bib-searcher` is a pure utility (its only runtime dep is fuse.js;
// `BibEntry` arrives as an erased `import type`), so importing it drags in
// no React/editor/circular weight.
import { searchBibFuzzy } from "@/lib/bib-searcher"; // cross-silo: search unification (see file header)
import type { BibEntry as MainBibEntry } from "@/lib/types";
import type { CatalogEntry } from "./catalog";
import type { BibEntry } from "./types";

/** A synthetic `BibEntry`-shaped record fed to `searchBibFuzzy`, paired with
 *  the `CatalogEntry` it was derived from so ranked results map back. The
 *  searcher only reads `key` + `fields.*`, never `uid`/`type`/`raw`, so we
 *  fill those defensively but they carry no signal. */
interface SynthRecord extends MainBibEntry {
  /** Back-reference to the source row — used to map fuse hits → entries. */
  __entry: CatalogEntry;
}

/** Cache the synthesized record array on the SOURCE `entries` array identity.
 *  Mirrors `bib-searcher.ts`'s own per-array WeakMap: between keystrokes only
 *  `query` changes, so the same `entries` reference is passed and the synth
 *  array (and, downstream, fuse's own index keyed on that synth array) is
 *  built ONCE. Per-keystroke cost is then just a token scan over prebuilt
 *  records — not a full re-synthesis each character.
 *
 *  The WeakMap lets a stale `entries` array (replaced when the catalog 6 s
 *  poll yields a new identity) GC normally along with its synth records. */
const synthCache = new WeakMap<CatalogEntry[], SynthRecord[]>();

/** Build (or reuse) the synthetic `BibEntry[]` for a catalog. Folds every
 *  searchable field of a `CatalogEntry` (preferring the catalog value, with
 *  the parsed bib as fallback) into the field shape `searchBibFuzzy` indexes:
 *
 *    citekey          → key                (also a weighted fuse key)
 *    title            → fields.title
 *    authors / author → fields.author      (joined with " and ")
 *    year             → fields.year
 *    journal          → fields.journal
 *    booktitle        → fields.booktitle
 *    originalFilename → folded into fields.booktitle (see note)
 *
 *  Note on filename: `FUSE_OPTIONS` (shared, in bib-searcher.ts) has NO
 *  `filename` key, and we must not mutate the shared options. To preserve the
 *  old matcher's filename reach, the source filename is appended into the
 *  `booktitle` field (an existing weighted key) so a query token can still
 *  match it. */
function getSynthRecords(
  entries: CatalogEntry[],
  bibByKey: Map<string, BibEntry>,
): SynthRecord[] {
  const cached = synthCache.get(entries);
  if (cached) return cached;

  const records = entries.map((e): SynthRecord => {
    const bib = e.citekey ? bibByKey.get(e.citekey) : undefined;
    const author =
      (e.authors && e.authors.length ? e.authors.join(" and ") : "") ||
      bib?.fields.author ||
      "";
    const title = e.title ?? bib?.fields.title ?? "";
    const year = String(e.year ?? bib?.fields.year ?? "");
    const journal = bib?.fields.journal ?? "";
    // Fold the filename into booktitle (an indexed key) since FUSE_OPTIONS
    // has no `filename` key and is shared — see header note.
    const booktitle = [bib?.fields.booktitle ?? "", e.originalFilename ?? ""]
      .filter(Boolean)
      .join(" ");

    return {
      __entry: e,
      uid: "",
      key: e.citekey ?? "",
      type: bib?.type ?? "misc",
      fields: { title, author, year, journal, booktitle },
      raw: "",
    };
  });

  synthCache.set(entries, records);
  return records;
}

/**
 * Flexible catalog search. Delegates to the shared `searchBibFuzzy` (whitespace
 * tokenization, multi-token AND across fields, diacritic folding, per-field
 * weights) over synthesized per-entry records, then maps the ranked hits back
 * to the originating `CatalogEntry[]`.
 *
 * An empty/whitespace query returns the entries unchanged (callers can use this
 * as a single code path). The returned order is fuse's relevance ranking;
 * LeftList re-applies its column sort on top, so the ranking is only a filter
 * signal there.
 */
export function searchCatalogFuzzy(
  entries: CatalogEntry[],
  bibByKey: Map<string, BibEntry>,
  query: string,
  limit = Infinity,
): CatalogEntry[] {
  if (!query || !query.trim()) {
    return Number.isFinite(limit) ? entries.slice(0, limit) : entries;
  }
  const records = getSynthRecords(entries, bibByKey);
  const hits = searchBibFuzzy(records, query, limit) as SynthRecord[];
  return hits.map((r) => r.__entry);
}
