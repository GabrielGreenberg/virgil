// Library data-layer scale benchmark — NOT part of the normal suite.
//
//   Run:  BENCH=1 npx vitest run library/dev/bench/library-scale.bench.test.ts
//
// Measures the costs identified in MEMO_LIBRARY_SCALE_RESEARCH.md so the
// browse-index rework has real before/after numbers:
//   1. citation-js parse of master.bib (the heavyweight) — synthetic 34k/100k
//      and, if present, the user's REAL ~/Virgil-Library/master.bib.
//   2. JSON.parse of catalog.json — synthetic 4.3k/34k/100k.
//   3. The mergedEntries merge/synthesis (LibraryView.tsx:407-473) — 34k/100k.
//   4. The TARGET path: JSON.parse of a flat slim browse-index — 34k/100k.
//
// All numbers are main-thread, single-shot (cold), median of a few runs.
import { describe, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { parseBibFile } from "@library/lib/bib-parser";
import type { CatalogEntry } from "@library/lib/catalog";
import type { BibEntry } from "@library/lib/types";

const RUN = !!process.env.BENCH;

function ms(fn: () => void): number {
  const t0 = performance.now();
  fn();
  return performance.now() - t0;
}
function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}
function timeN(label: string, n: number, fn: () => void): number {
  const runs: number[] = [];
  for (let i = 0; i < n; i++) runs.push(ms(fn));
  const m = median(runs);
  // eslint-disable-next-line no-console
  console.log(`  ${label.padEnd(48)} ${m.toFixed(1).padStart(8)} ms  (median of ${n})`);
  return m;
}

// --- synthetic generators ---------------------------------------------------

const FIRST = ["David", "Saul", "Ruth", "Angelika", "Irene", "Hans", "Barbara", "Paul", "Robert", "Hilary"];
const LAST = ["Lewis", "Kripke", "Millikan", "Kratzer", "Heim", "Kamp", "Partee", "Grice", "Stalnaker", "Putnam"];
const WORDS = "scorekeeping in a language game counterfactuals naming and necessity varieties of meaning context dependence presupposition projection generalized quantifiers".split(" ");

function pick<T>(a: T[], i: number): T { return a[i % a.length]; }
function title(i: number): string {
  const n = 4 + (i % 6);
  let t = "";
  for (let k = 0; k < n; k++) t += (k ? " " : "") + pick(WORDS, i + k);
  return t.replace(/\b\w/g, (c) => c.toUpperCase());
}

/** A realistic-ish @article block (~300 bytes) so parse cost tracks reality. */
function bibEntry(i: number): string {
  const key = `cite${String(i).padStart(6, "0")}`;
  const author = `${pick(LAST, i)}, ${pick(FIRST, i)} and ${pick(LAST, i + 3)}, ${pick(FIRST, i + 2)}`;
  return `@article{${key},
  title = {${title(i)}},
  author = {${author}},
  journal = {Linguistics and Philosophy},
  year = {${1950 + (i % 75)}},
  volume = {${1 + (i % 40)}},
  number = {${1 + (i % 4)}},
  pages = {${1 + (i % 300)}--${20 + (i % 300)}},
  doi = {10.1007/s10988-0${String(i % 100000).padStart(5, "0")}},
  publisher = {Springer},
}`;
}
function makeBib(n: number): string {
  const parts: string[] = [];
  for (let i = 0; i < n; i++) parts.push(bibEntry(i));
  return parts.join("\n\n") + "\n";
}

function makeCatalog(n: number): CatalogEntry[] {
  const out: CatalogEntry[] = [];
  for (let i = 0; i < n; i++) {
    out.push({
      citekey: `cite${String(i).padStart(6, "0")}`,
      title: title(i),
      authors: [`${pick(LAST, i)}, ${pick(FIRST, i)}`],
      year: 1950 + (i % 75),
      doi: `10.1007/s10988-0${String(i % 100000).padStart(5, "0")}`,
      addedAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
      pdf: { present: true, filename: `cite${i}.pdf` },
      indexed: { state: "indexed" },
      bib: { state: "authenticated" },
    });
  }
  return out;
}

/** The slim browse-index target record (flat, no raw, no nesting). */
interface SlimRecord {
  c: string; // citekey
  t?: string; // title
  a?: string[]; // authors
  y?: number; // year
  d?: string; // doi
  i?: string; // indexed state
  b?: string; // bib state
  p?: boolean; // pdf present
}
function makeSlim(n: number): SlimRecord[] {
  const out: SlimRecord[] = [];
  for (let i = 0; i < n; i++) {
    out.push({
      c: `cite${String(i).padStart(6, "0")}`,
      t: title(i),
      a: [`${pick(LAST, i)}, ${pick(FIRST, i)}`],
      y: 1950 + (i % 75),
      d: `10.1007/s10988-0${String(i % 100000).padStart(5, "0")}`,
      i: "indexed",
      b: "authenticated",
      p: true,
    });
  }
  return out;
}

/** Replica of LibraryView.tsx:407-473 mergedEntries bib-only synthesis cost. */
function mergeCost(catalog: CatalogEntry[], bib: BibEntry[]): CatalogEntry[] {
  const rows = catalog;
  const seenKeys = new Set(rows.map((e) => e.citekey).filter(Boolean) as string[]);
  const bibOnly: CatalogEntry[] = [];
  for (const b of bib) {
    if (seenKeys.has(b.key)) continue;
    bibOnly.push({
      citekey: b.key,
      title: b.fields.title,
      authors: b.fields.author ? [b.fields.author] : undefined,
      year: b.fields.year ? Number(b.fields.year) : undefined,
      doi: b.fields.doi,
      addedAt: "",
      updatedAt: "",
      pdf: { present: false },
      indexed: { state: "none" },
      bib: { state: "unverified" },
    });
    seenKeys.add(b.key);
  }
  return [...rows, ...bibOnly];
}

describe.skipIf(!RUN)("library scale benchmark", () => {
  it("measures parse / merge / target costs", () => {
    // eslint-disable-next-line no-console
    console.log("\n=== Library data-layer scale benchmark ===\n");

    for (const N of [34_000, 100_000]) {
      // eslint-disable-next-line no-console
      console.log(`--- synthetic N=${N.toLocaleString()} ---`);
      const bibText = makeBib(N);
      // eslint-disable-next-line no-console
      console.log(`  master.bib size: ${(bibText.length / 1e6).toFixed(1)} MB`);

      // citation-js parse — the heavyweight. Single run (cache makes reruns free).
      const t0 = performance.now();
      const parsed = parseBibFile(bibText);
      const parseMs = performance.now() - t0;
      // eslint-disable-next-line no-console
      console.log(`  citation-js parseBibFile (COLD)                  ${parseMs.toFixed(1).padStart(8)} ms  -> ${parsed.length} entries`);

      const slim = makeSlim(N);
      const slimText = JSON.stringify(slim);
      const catalog = makeCatalog(Math.min(N, 4324)); // catalog stays lean
      const catText = JSON.stringify({ version: 1, generatedAt: "x", entries: catalog });

      timeN("JSON.parse(catalog.json) lean", 5, () => { JSON.parse(catText); });
      timeN("mergedEntries synthesis (catalog+bib)", 5, () => { mergeCost(catalog, parsed); });
      // eslint-disable-next-line no-console
      console.log(`  browse-index size: ${(slimText.length / 1e6).toFixed(1)} MB`);
      timeN("TARGET: JSON.parse(browse-index.json)", 5, () => { JSON.parse(slimText); });
      // eslint-disable-next-line no-console
      console.log("");
    }

    // Real library, if available.
    const realBib = path.join(os.homedir(), "Virgil-Library", "master.bib");
    if (fs.existsSync(realBib)) {
      const text = fs.readFileSync(realBib, "utf8");
      // eslint-disable-next-line no-console
      console.log(`--- REAL ~/Virgil-Library/master.bib (${(text.length / 1e6).toFixed(1)} MB) ---`);
      // fresh text key so PARSE_CACHE misses
      const t0 = performance.now();
      const parsed = parseBibFile(text);
      const parseMs = performance.now() - t0;
      // eslint-disable-next-line no-console
      console.log(`  citation-js parseBibFile (COLD)                  ${parseMs.toFixed(1).padStart(8)} ms  -> ${parsed.length} entries\n`);
    } else {
      // eslint-disable-next-line no-console
      console.log("--- REAL master.bib not found, skipping ---\n");
    }
  }, 600_000);
});
