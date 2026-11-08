/**
 * Task 1521 — bibliography search matches what the card SHOWS, not the raw
 * `.bib` bytes. `author = {G{\"o}del}` is displayed as `G{ö}del`; the fuzzy
 * index (panel scopes + citation picker) and the Search panel's bibliography
 * scope both read the display projection.
 */
import { describe, expect, it } from "vitest";
import { bibSearchText, searchBibFuzzy } from "@/lib/bib-searcher";
import { searchBibliography } from "@/lib/search-sources";
import type { BibEntry } from "@/lib/types";

function entry(key: string, author: string, title: string): BibEntry {
  return { key, uid: key, raw: "", type: "article", fields: { author, title, year: "1931" } } as BibEntry;
}

const ENTRIES: BibEntry[] = [
  entry("godel1931", 'G{\\"o}del, Kurt', "On Formally Undecidable Propositions"),
  entry("munoz2001", "Mu{\\~n}oz, Ana", "Tense and Aspect"),
  entry("lopez1999", "L{\\'o}pez, Rosa", "Modal Bases"),
  entry("smith2010", "Smith, John", "Something Else Entirely"),
];

describe("bibSearchText — the indexed text is the display projection", () => {
  it("projects accent escapes, drops grouping braces, folds diacritics", () => {
    expect(bibSearchText('G{\\"o}del')).toBe("Godel");
    expect(bibSearchText("Mu{\\~n}oz")).toBe("Munoz");
    expect(bibSearchText("{The} {Logic}")).toBe("The Logic");
  });
});

describe("searchBibFuzzy — LaTeX-escaped names are findable", () => {
  it.each([
    ["Gödel", "godel1931"],
    ["godel", "godel1931"],
    ["munoz", "munoz2001"],
    ["Muñoz", "munoz2001"],
    ["López", "lopez1999"],
    ["lopez", "lopez1999"],
  ])("%s finds %s", (query, key) => {
    const keys = searchBibFuzzy(ENTRIES, query).map((e) => e.key);
    expect(keys[0]).toBe(key);
  });

  it("does not mutate the entries' raw field bytes", () => {
    searchBibFuzzy(ENTRIES, "godel");
    expect(ENTRIES[0].fields.author).toBe('G{\\"o}del, Kurt');
  });
});

describe("searchBibliography (Search panel) — matches display text", () => {
  it("finds Gödel in G{\\\"o}del and shows the display snippet", () => {
    const hits = searchBibliography(ENTRIES, /Gödel/gi);
    expect(hits.map((h) => h.itemId)).toEqual(["godel1931"]);
    expect(hits[0].match).toBe("Gödel");
    expect(hits[0].before + hits[0].match + hits[0].after).not.toContain("\\");
  });
});
