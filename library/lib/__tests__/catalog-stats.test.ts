import { describe, expect, it } from "vitest";
import { computeCatalogStats } from "../catalog-stats";
import type { CatalogEntry } from "../catalog";
import type { BibEntry } from "../types";
import type { IndexedState, BibAuthState } from "../catalog";

// ── Fixtures ──────────────────────────────────────────────────────────────
// One row per bucket so every branch of computeCatalogStats is exercised.

function entry(p: {
  citekey: string | null;
  indexed: IndexedState;
  bib: BibAuthState;
  title?: string;
  authors?: string[];
  year?: number;
  originalFilename?: string;
}): CatalogEntry {
  return {
    citekey: p.citekey,
    title: p.title,
    authors: p.authors,
    year: p.year,
    addedAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    pdf: { present: true },
    indexed: { state: p.indexed },
    bib: { state: p.bib },
    originalFilename: p.originalFilename,
  };
}

describe("computeCatalogStats", () => {
  it("counts each indexing + bib bucket in one pass", () => {
    const entries: CatalogEntry[] = [
      // deepIndexed + canonical (verified terminal, not authenticated)
      entry({ citekey: "a", indexed: "deepIndexed", bib: "canonical" }),
      // indexed + authenticated (verified terminal + authenticated)
      entry({ citekey: "b", indexed: "indexed", bib: "authenticated" }),
      // queued + unverified (needs action)
      entry({ citekey: "c", indexed: "queued", bib: "unverified" }),
      // running + failed bib (needs action)
      entry({ citekey: "d", indexed: "running", bib: "failed" }),
      // failed index + manuscript (verified terminal)
      entry({ citekey: "e", indexed: "failed", bib: "manuscript" }),
      // none + none — contributes to nothing but totals/papers
      entry({ citekey: "f", indexed: "none", bib: "none" }),
      // unsorted file (no citekey) — counts as unsorted, not a paper
      entry({ citekey: null, indexed: "none", bib: "none", originalFilename: "x.pdf" }),
    ];

    const bibByKey = new Map<string, BibEntry>([
      ["a", { key: "a", type: "article", fields: {}, raw: "" }],
      ["b", { key: "b", type: "article", fields: {}, raw: "" }],
      ["c", { key: "c", type: "article", fields: {}, raw: "" }],
    ]);

    const s = computeCatalogStats(entries, bibByKey);

    expect(s.totalSources).toBe(7);
    expect(s.papers).toBe(6); // all but the null-citekey row
    expect(s.unsorted).toBe(1);
    expect(s.bibEntries).toBe(3); // map size, independent of entries

    // Indexing pipeline
    expect(s.indexed).toBe(2); // deepIndexed (a) + indexed (b)
    expect(s.deepIndexed).toBe(1); // a
    expect(s.queuedOrRunning).toBe(2); // c + d
    expect(s.failedIndex).toBe(1); // e

    // Bibliography
    expect(s.authenticated).toBe(1); // b
    expect(s.verifiedTerminal).toBe(3); // canonical(a) + authenticated(b) + manuscript(e)
    expect(s.bibNeedsAction).toBe(2); // unverified(c) + failed(d)
  });

  it("is defensive against empty / missing inputs", () => {
    const empty = computeCatalogStats([], new Map());
    expect(empty.totalSources).toBe(0);
    expect(empty.bibEntries).toBe(0);
    expect(empty.indexed).toBe(0);

    // Null / undefined arguments must not throw.
    const nullish = computeCatalogStats(null, null);
    expect(nullish.totalSources).toBe(0);
    expect(nullish.bibEntries).toBe(0);
    expect(nullish.papers).toBe(0);
  });

  it("tolerates entries with malformed indexed/bib shapes", () => {
    // Simulate a partial on-disk row missing the nested state objects.
    const broken = [
      { citekey: "ok", indexed: { state: "indexed" }, bib: { state: "authenticated" } },
      { citekey: "bad" }, // no indexed/bib at all
      null,
    ] as unknown as CatalogEntry[];

    const s = computeCatalogStats(broken, new Map());
    expect(s.totalSources).toBe(3); // length, including the null slot
    expect(s.papers).toBe(2); // "ok" + "bad" both have citekeys
    expect(s.indexed).toBe(1); // only "ok"
    expect(s.authenticated).toBe(1); // only "ok"
  });

  it("treats absent bibByKey.size as zero", () => {
    const s = computeCatalogStats(
      [entry({ citekey: "a", indexed: "indexed", bib: "authenticated" })],
      undefined,
    );
    expect(s.bibEntries).toBe(0);
    expect(s.papers).toBe(1);
  });
});
