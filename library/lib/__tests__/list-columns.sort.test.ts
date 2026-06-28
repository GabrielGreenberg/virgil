// @vitest-environment jsdom
import { describe, expect, it, beforeEach } from "vitest";

import {
  FACETS,
  isStatusFacet,
  loadSort,
  saveSort,
  sortEntries,
  type SortState,
  type StatusFacet,
} from "../list-columns";
import type { CatalogEntry, IndexedState, BibAuthState } from "../catalog";
import type { BibEntry } from "../types";

// ── Fixtures ───────────────────────────────────────────────────────────────

function entry(p: {
  citekey: string;
  indexed?: IndexedState;
  bib?: BibAuthState;
  pdfPresent?: boolean;
  imported?: boolean;
}): CatalogEntry {
  return {
    citekey: p.citekey,
    addedAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    pdf: { present: p.pdfPresent ?? false },
    indexed: { state: p.indexed ?? "none" },
    bib: { state: p.bib ?? "none", imported: p.imported },
  };
}

const NO_BIB = new Map<string, BibEntry>();

const keys = (entries: CatalogEntry[]): string[] =>
  entries.map((e) => e.citekey ?? "");

describe("FACETS / isStatusFacet", () => {
  it("the shared FACETS array is the canonical pdf·idx·bib·imp order", () => {
    expect([...FACETS]).toEqual(["pdf", "idx", "bib", "imp"]);
  });

  it("isStatusFacet accepts the four facets and rejects everything else", () => {
    for (const f of FACETS) expect(isStatusFacet(f)).toBe(true);
    expect(isStatusFacet("status")).toBe(false);
    expect(isStatusFacet("year")).toBe(false);
    expect(isStatusFacet(undefined)).toBe(false);
    expect(isStatusFacet(null)).toBe(false);
    expect(isStatusFacet(3)).toBe(false);
  });
});

describe("sortEntries — per-facet status sort (F#14)", () => {
  // For each facet: a clear BEST row and a clear WORST row, plus a middle.
  // `asc` (the best-first default) must put best on top; flipping to `desc`
  // reverses it exactly.

  it("pdf facet: present-first asc, missing-first on reverse", () => {
    const entries = [
      entry({ citekey: "missing", pdfPresent: false }),
      entry({ citekey: "present", pdfPresent: true }),
    ];
    expect(keys(sortEntries(entries, NO_BIB, "status", "asc", "pdf"))).toEqual([
      "present",
      "missing",
    ]);
    expect(keys(sortEntries(entries, NO_BIB, "status", "desc", "pdf"))).toEqual([
      "missing",
      "present",
    ]);
  });

  it("idx facet: deepIndexed best-first asc, reverses on desc", () => {
    const entries = [
      entry({ citekey: "none", indexed: "none" }),
      entry({ citekey: "indexed", indexed: "indexed" }),
      entry({ citekey: "deep", indexed: "deepIndexed" }),
    ];
    expect(keys(sortEntries(entries, NO_BIB, "status", "asc", "idx"))).toEqual([
      "deep",
      "indexed",
      "none",
    ]);
    expect(keys(sortEntries(entries, NO_BIB, "status", "desc", "idx"))).toEqual([
      "none",
      "indexed",
      "deep",
    ]);
  });

  it("bib facet: authenticated best-first asc, reverses on desc", () => {
    const entries = [
      entry({ citekey: "none", bib: "none" }),
      entry({ citekey: "unverified", bib: "unverified" }),
      entry({ citekey: "auth", bib: "authenticated" }),
    ];
    expect(keys(sortEntries(entries, NO_BIB, "status", "asc", "bib"))).toEqual([
      "auth",
      "unverified",
      "none",
    ]);
    expect(keys(sortEntries(entries, NO_BIB, "status", "desc", "bib"))).toEqual([
      "none",
      "unverified",
      "auth",
    ]);
  });

  it("imp facet: imported best-first asc, reverses on desc", () => {
    const entries = [
      entry({ citekey: "plain", imported: false }),
      entry({ citekey: "imported", imported: true }),
    ];
    expect(keys(sortEntries(entries, NO_BIB, "status", "asc", "imp"))).toEqual([
      "imported",
      "plain",
    ]);
    expect(keys(sortEntries(entries, NO_BIB, "status", "desc", "imp"))).toEqual([
      "plain",
      "imported",
    ]);
  });

  it("each facet is independent — sorting by one ignores the others", () => {
    // `a` is best on idx but worst on bib; `b` is the inverse. Sorting by idx
    // must order by idx alone; sorting by bib must order by bib alone.
    const a = entry({ citekey: "a", indexed: "deepIndexed", bib: "none" });
    const b = entry({ citekey: "b", indexed: "none", bib: "authenticated" });
    expect(keys(sortEntries([b, a], NO_BIB, "status", "asc", "idx"))).toEqual([
      "a",
      "b",
    ]);
    expect(keys(sortEntries([a, b], NO_BIB, "status", "asc", "bib"))).toEqual([
      "b",
      "a",
    ]);
  });

  it("equal-rank rows tie-break stably by citekey", () => {
    const entries = [
      entry({ citekey: "zeta", indexed: "indexed" }),
      entry({ citekey: "alpha", indexed: "indexed" }),
      entry({ citekey: "mu", indexed: "indexed" }),
    ];
    // asc: equal rank → ascending citekey.
    expect(keys(sortEntries(entries, NO_BIB, "status", "asc", "idx"))).toEqual([
      "alpha",
      "mu",
      "zeta",
    ]);
  });
});

describe("sortEntries — composite status (no facet)", () => {
  it("absent facet sorts by the composite statusRank, best-first asc", () => {
    // best = pdf present + deepIndexed + authenticated; worst = all none.
    const best = entry({
      citekey: "best",
      pdfPresent: true,
      indexed: "deepIndexed",
      bib: "authenticated",
    });
    const worst = entry({
      citekey: "worst",
      pdfPresent: false,
      indexed: "none",
      bib: "none",
    });
    const mid = entry({
      citekey: "mid",
      pdfPresent: true,
      indexed: "indexed",
      bib: "unverified",
    });
    const composite = keys(
      sortEntries([worst, mid, best], NO_BIB, "status", "asc"),
    );
    expect(composite).toEqual(["best", "mid", "worst"]);
  });

  it("composite differs from a single facet when facets disagree", () => {
    // `a` has a great idx but nothing else; `b` is solid across the board.
    const a = entry({
      citekey: "a",
      pdfPresent: false,
      indexed: "deepIndexed",
      bib: "none",
    });
    const b = entry({
      citekey: "b",
      pdfPresent: true,
      indexed: "indexed",
      bib: "authenticated",
    });
    // By idx facet alone, `a` (deepIndexed) wins.
    expect(keys(sortEntries([b, a], NO_BIB, "status", "asc", "idx"))).toEqual([
      "a",
      "b",
    ]);
    // By composite, `b` (better overall) wins.
    expect(keys(sortEntries([a, b], NO_BIB, "status", "asc"))).toEqual([
      "b",
      "a",
    ]);
  });
});

describe("loadSort / saveSort — facet round-trip (F#14)", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("round-trips a status+facet sort", () => {
    const s: SortState = { col: "status", dir: "asc", facet: "idx" };
    saveSort(s);
    expect(loadSort()).toEqual(s);
  });

  it("round-trips every facet", () => {
    for (const facet of FACETS) {
      const s: SortState = { col: "status", dir: "desc", facet };
      saveSort(s);
      expect(loadSort()).toEqual(s);
    }
  });

  it("drops a stray facet on a non-status column (canonicalizes on save)", () => {
    // A facet only means something on status — saving it on `year` must not
    // persist it, so the loaded value has no facet.
    saveSort({ col: "year", dir: "desc", facet: "bib" } as SortState);
    expect(loadSort()).toEqual({ col: "year", dir: "desc" });
  });

  it("ignores a persisted facet on a non-status column when loading", () => {
    localStorage.setItem(
      "virgil-library-col-sort",
      JSON.stringify({ col: "author", dir: "asc", facet: "pdf" }),
    );
    expect(loadSort()).toEqual({ col: "author", dir: "asc" });
  });

  it("ignores an unknown facet value", () => {
    localStorage.setItem(
      "virgil-library-col-sort",
      JSON.stringify({ col: "status", dir: "asc", facet: "bogus" }),
    );
    expect(loadSort()).toEqual({ col: "status", dir: "asc" });
  });

  it("a plain status sort (no facet) round-trips without a facet key", () => {
    saveSort({ col: "status", dir: "asc" });
    const loaded = loadSort();
    expect(loaded).toEqual({ col: "status", dir: "asc" });
    expect((loaded as { facet?: StatusFacet }).facet).toBeUndefined();
  });
});
