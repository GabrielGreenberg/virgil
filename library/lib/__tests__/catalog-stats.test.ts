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
  pdfPresent?: boolean;
}): CatalogEntry {
  return {
    citekey: p.citekey,
    title: p.title,
    authors: p.authors,
    year: p.year,
    addedAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    pdf: { present: p.pdfPresent ?? true },
    indexed: { state: p.indexed },
    bib: { state: p.bib },
    originalFilename: p.originalFilename,
  };
}

describe("computeCatalogStats", () => {
  it("counts each indexing + bib bucket in one pass", () => {
    const entries: CatalogEntry[] = [
      // deepIndexed + canonical
      entry({ citekey: "a", indexed: "deepIndexed", bib: "canonical" }),
      // indexed + authenticated
      entry({ citekey: "b", indexed: "indexed", bib: "authenticated" }),
      // queued + unverified (needs action)
      entry({ citekey: "c", indexed: "queued", bib: "unverified" }),
      // running + failed bib (needs action)
      entry({ citekey: "d", indexed: "running", bib: "failed" }),
      // failed index + manuscript
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
    expect(s.sourcesWithFile).toBe(6); // all 6 citekey rows have pdf.present
    expect(s.unsorted).toBe(1);
    expect(s.bibEntries).toBe(3); // map size, independent of entries

    // Indexing pipeline
    expect(s.indexed).toBe(2); // deepIndexed (a) + indexed (b)
    expect(s.deepIndexed).toBe(1); // a
    expect(s.queuedOrRunning).toBe(2); // c + d
    expect(s.failedIndex).toBe(1); // e

    // Bibliography (F#1/F#2/F#4)
    expect(s.authenticated).toBe(1); // b
    expect(s.bibNeedsAction).toBe(2); // unverified(c) + failed(d)
    // Strict binary complement over the bibliography total: 3 − 1 = 2.
    expect(s.nonAuthenticated).toBe(2);
  });

  it("Sources counts only citekey+pdf-present rows (F#1); non-auth is the strict complement", () => {
    // The merged universe: 2 real holdings (one authenticated) + 3 fileless
    // reference rows (one authenticated via the bib-index projection) + an
    // untriaged file.
    const entries: CatalogEntry[] = [
      entry({ citekey: "h1", indexed: "indexed", bib: "authenticated", pdfPresent: true }),
      entry({ citekey: "h2", indexed: "indexed", bib: "none", pdfPresent: true }),
      entry({ citekey: "r1", indexed: "none", bib: "authenticated", pdfPresent: false }),
      entry({ citekey: "r2", indexed: "none", bib: "none", pdfPresent: false }),
      entry({ citekey: "r3", indexed: "none", bib: "unverified", pdfPresent: false }),
      entry({ citekey: null, indexed: "none", bib: "none", originalFilename: "drop.pdf", pdfPresent: true }),
    ];
    const bibByKey = new Map<string, BibEntry>(
      ["h1", "h2", "r1", "r2", "r3"].map((k) => [
        k,
        { key: k, type: "article", fields: {}, raw: "" } as BibEntry,
      ]),
    );

    const s = computeCatalogStats(entries, bibByKey);
    // Only h1 + h2 are real documents on disk.
    expect(s.sourcesWithFile).toBe(2);
    // Authenticated over the whole universe: h1 + r1.
    expect(s.authenticated).toBe(2);
    // 5 references total − 2 authenticated = 3 non-authenticated.
    expect(s.nonAuthenticated).toBe(3);
  });

  it("clamps nonAuthenticated at zero when a holding's citekey isn't in master.bib", () => {
    const s = computeCatalogStats(
      [entry({ citekey: "ghost", indexed: "indexed", bib: "authenticated" })],
      new Map(), // bibEntries = 0
    );
    expect(s.authenticated).toBe(1);
    expect(s.nonAuthenticated).toBe(0); // max(0, 0 − 1)
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
