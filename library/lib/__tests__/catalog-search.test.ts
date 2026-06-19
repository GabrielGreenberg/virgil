import { describe, expect, it } from "vitest";
import { searchCatalogFuzzy } from "../catalog-search";
import type { CatalogEntry } from "../catalog";
import type { BibEntry } from "../types";

// ── Fixtures ──────────────────────────────────────────────────────────────
// A small realistic catalog. The headline row is Lewis / Scorekeeping: its
// author token ("lewis") and title token ("score…") live in DIFFERENT fields,
// which is exactly what the old single-substring `hay.includes(q)` could not
// bridge — `lewis score` was never a contiguous substring of the joined
// haystack, so it returned nothing. The fuzzy matcher AND's tokens across
// fields, so it surfaces the row.

function entry(p: Partial<CatalogEntry> & Pick<CatalogEntry, "citekey">): CatalogEntry {
  return {
    citekey: p.citekey,
    title: p.title,
    authors: p.authors,
    year: p.year,
    addedAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    pdf: { present: true },
    indexed: { state: "indexed" },
    bib: { state: "authenticated" },
    originalFilename: p.originalFilename,
  };
}

const lewis = entry({
  citekey: "lewis1979scorekeeping",
  title: "Scorekeeping in a Language Game",
  authors: ["David Lewis"],
  year: 1979,
  originalFilename: "lewis-scorekeeping.pdf",
});

const grice = entry({
  citekey: "grice1975logic",
  title: "Logic and Conversation",
  authors: ["H. P. Grice"],
  year: 1975,
  originalFilename: "grice-logic.pdf",
});

// Citekey/filename deliberately accent-free-but-NOT-"munoz" so the ONLY place
// the search term could land is the accented author "Muñoz". This isolates the
// diacritic-folding gap: the old `includes` matcher (no NFD fold) misses it;
// the fuzzy matcher folds both index and query and finds it.
const munoz = entry({
  citekey: "dm2019desire",
  title: "The Paradox of Duty",
  authors: ["Daniel Muñoz"],
  year: 2019,
  originalFilename: "desire-2019.pdf",
});

const stalnaker = entry({
  citekey: "stalnaker1978assertion",
  title: "Assertion",
  authors: ["Robert Stalnaker"],
  year: 1978,
  originalFilename: "stalnaker-assertion.pdf",
});

const entries: CatalogEntry[] = [lewis, grice, munoz, stalnaker];

// Empty bib map — exercises the path where all signal comes from the catalog
// fields, which is the real failure mode the user reported.
const emptyBib = new Map<string, BibEntry>();

const citekeys = (rows: CatalogEntry[]) => rows.map((r) => r.citekey);

// The OLD matcher, reproduced verbatim, to PROVE the defect: `lewis score`
// must fail here and pass under searchCatalogFuzzy.
function oldIncludesMatch(
  es: CatalogEntry[],
  bibByKey: Map<string, BibEntry>,
  query: string,
): CatalogEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return es;
  return es.filter((e) => {
    const bib = e.citekey ? bibByKey.get(e.citekey) : undefined;
    const hay = [
      e.citekey ?? "",
      e.title ?? bib?.fields.title ?? "",
      (e.authors ?? []).join(" "),
      bib?.fields.author ?? "",
      String(e.year ?? bib?.fields.year ?? ""),
      e.originalFilename ?? "",
    ]
      .join(" ")
      .toLowerCase();
    return hay.includes(q);
  });
}

describe("searchCatalogFuzzy — the headline defect", () => {
  it('"lewis score" surfaces the Lewis / Scorekeeping entry (cross-field tokens)', () => {
    const out = searchCatalogFuzzy(entries, emptyBib, "lewis score");
    expect(citekeys(out)).toContain("lewis1979scorekeeping");
    // And it does NOT pull in the unrelated rows.
    expect(citekeys(out)).not.toContain("grice1975logic");
    expect(citekeys(out)).not.toContain("stalnaker1978assertion");
  });

  it('PROOF the old `includes` matcher FAILED "lewis score" (regression guard)', () => {
    // The whole reason for this work: the old matcher could not bridge the
    // author token and the title token across fields.
    const old = oldIncludesMatch(entries, emptyBib, "lewis score");
    expect(citekeys(old)).not.toContain("lewis1979scorekeeping");
    expect(old).toHaveLength(0);

    // New matcher fixes it.
    const fresh = searchCatalogFuzzy(entries, emptyBib, "lewis score");
    expect(citekeys(fresh)).toContain("lewis1979scorekeeping");
  });
});

describe("searchCatalogFuzzy — token / field coverage", () => {
  it("author-only token matches", () => {
    const out = searchCatalogFuzzy(entries, emptyBib, "lewis");
    expect(citekeys(out)).toContain("lewis1979scorekeeping");
  });

  it("partial-title-word token matches (author + partial title across fields)", () => {
    // "languag" is a substring of "Language" — the old matcher failed this
    // too (author token never contiguous with the partial title word).
    const out = searchCatalogFuzzy(entries, emptyBib, "lewis languag");
    expect(citekeys(out)).toContain("lewis1979scorekeeping");
    expect(oldIncludesMatch(entries, emptyBib, "lewis languag")).toHaveLength(0);
  });

  it("multi-token AND EXCLUDES rows that miss a token", () => {
    // "lewis" matches Lewis; "conversation" matches only Grice. No single row
    // has both → empty result (the AND intersection, not an OR union).
    const out = searchCatalogFuzzy(entries, emptyBib, "lewis conversation");
    expect(citekeys(out)).not.toContain("lewis1979scorekeeping");
    expect(citekeys(out)).not.toContain("grice1975logic");
    expect(out).toHaveLength(0);
  });

  it("citekey token matches", () => {
    const out = searchCatalogFuzzy(entries, emptyBib, "scorekeeping");
    expect(citekeys(out)).toContain("lewis1979scorekeeping");
  });

  it("diacritic-insensitive: accent-free query matches an accented author", () => {
    // "munoz" must find "Muñoz" — the old matcher did NOT fold diacritics.
    const out = searchCatalogFuzzy(entries, emptyBib, "munoz");
    expect(citekeys(out)).toContain("dm2019desire");
    // The old matcher folds no diacritics, so an accent-free "munoz" never
    // matched the accented author "Muñoz" — this is the gap we close.
    expect(oldIncludesMatch(entries, emptyBib, "munoz")).toHaveLength(0);
  });

  it("empty query returns all entries unchanged", () => {
    expect(searchCatalogFuzzy(entries, emptyBib, "")).toBe(entries);
    expect(searchCatalogFuzzy(entries, emptyBib, "   ")).toBe(entries);
  });
});

describe("searchCatalogFuzzy — bib fallback + filename reach", () => {
  it("falls back to the parsed bib when the catalog field is absent", () => {
    const bare = entry({ citekey: "x2020untitled" }); // no title/authors
    const bib = new Map<string, BibEntry>([
      [
        "x2020untitled",
        {
          key: "x2020untitled",
          type: "article",
          fields: { title: "Hidden Gem", author: "Jane Roe", year: "2020" },
          raw: "",
        },
      ],
    ]);
    const out = searchCatalogFuzzy([bare], bib, "hidden gem");
    expect(citekeys(out)).toContain("x2020untitled");
    const byAuthor = searchCatalogFuzzy([bare], bib, "roe");
    expect(citekeys(byAuthor)).toContain("x2020untitled");
  });

  it("matches on the source filename (folded into an indexed field)", () => {
    // The old matcher searched originalFilename; we preserve that reach.
    const out = searchCatalogFuzzy(entries, emptyBib, "stalnaker-assertion");
    expect(citekeys(out)).toContain("stalnaker1978assertion");
  });
});

describe("searchCatalogFuzzy — synth-record WeakMap cache", () => {
  it("reuses the synthesized records across calls on the same entries identity", () => {
    // Two searches with the same `entries` reference must both work; the
    // second hits the cache (we can't observe the cache directly, but a stale
    // build would surface as a wrong/empty result).
    const a = searchCatalogFuzzy(entries, emptyBib, "lewis");
    const b = searchCatalogFuzzy(entries, emptyBib, "grice");
    expect(citekeys(a)).toContain("lewis1979scorekeeping");
    expect(citekeys(b)).toContain("grice1975logic");
  });
});
