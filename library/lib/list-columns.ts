// Column model for the LeftList — widths, sort state, persisted in
// localStorage. Both LeftList (header) and LeftListRow (data row)
// import the same grid-template builder so headers and cells line up
// pixel-for-pixel.

import type { CatalogEntry, IndexedState, BibAuthState } from "./catalog";
import type { BibEntry } from "./types";

/** Columns the user can sort by. */
export type SortColId = "year" | "author" | "title" | "status" | "citekey";

export type SortDir = "asc" | "desc";

export type ResizableColId = "year" | "author" | "status" | "citekey";

export const DEFAULT_WIDTHS: Record<ResizableColId, number> = {
  year: 56,
  author: 130,
  // F#14: bib-imp folded INTO status (a 4th "✓ imp" pill) — widened ~52px so
  // the freed bib-imp space holds the extra pill instead of flowing to title.
  status: 208,
  citekey: 140,
};

const MIN_WIDTHS: Record<ResizableColId, number> = {
  year: 40,
  author: 70,
  status: 120,
  citekey: 80,
};

const MAX_WIDTHS: Record<ResizableColId, number> = {
  year: 110,
  author: 260,
  status: 320,
  citekey: 200,
};

export const RESIZER_WIDTH = 4;

export function clampWidth(col: ResizableColId, w: number): number {
  return Math.max(MIN_WIDTHS[col], Math.min(MAX_WIDTHS[col], Math.round(w)));
}

export function gridTemplate(widths: Record<ResizableColId, number>): string {
  return [
    `${widths.year}px`,
    `${RESIZER_WIDTH}px`,
    `${widths.author}px`,
    `${RESIZER_WIDTH}px`,
    "1fr", // title
    `${RESIZER_WIDTH}px`,
    `${widths.status}px`,
    `${RESIZER_WIDTH}px`,
    `${widths.citekey}px`,
    // F#14: the trailing bib-imp track is gone — it's now a 4th status pill.
  ].join(" ");
}

// ── Sort ────────────────────────────────────────────────────────────────

const INDEXED_RANK: Record<IndexedState, number> = {
  deepIndexed: 0,
  indexed: 1,
  running: 2,
  queued: 3,
  failed: 4,
  none: 5,
};

const BIB_RANK: Record<BibAuthState, number> = {
  authenticated: 0,
  manuscript: 1,
  canonical: 2,
  unverified: 3,
  failed: 4,
  none: 5,
};

/** Compare two catalog entries for the given sort column. Returns the
 *  ascending result; the caller flips the sign for descending. */
export function compareEntries(
  a: CatalogEntry,
  b: CatalogEntry,
  bibByKey: Map<string, BibEntry>,
  col: SortColId,
): number {
  switch (col) {
    case "year": {
      const ay = numericYear(a, bibByKey);
      const by = numericYear(b, bibByKey);
      if (ay !== by) return ay - by;
      // Tie-break by citekey so the order is stable.
      return (a.citekey ?? "").localeCompare(b.citekey ?? "");
    }
    case "author":
      return firstAuthorSurname(a, bibByKey).localeCompare(firstAuthorSurname(b, bibByKey));
    case "title":
      return titleOf(a, bibByKey).localeCompare(titleOf(b, bibByKey));
    case "status":
      return statusRank(a) - statusRank(b);
    case "citekey":
      return (a.citekey ?? "").localeCompare(b.citekey ?? "");
  }
}

export function sortEntries(
  entries: CatalogEntry[],
  bibByKey: Map<string, BibEntry>,
  col: SortColId,
  dir: SortDir,
): CatalogEntry[] {
  const arr = [...entries];
  const sign = dir === "asc" ? 1 : -1;
  arr.sort((a, b) => sign * compareEntries(a, b, bibByKey, col));
  return arr;
}

function statusRank(e: CatalogEntry): number {
  const pdfR = e.pdf.present ? 0 : 4;
  return pdfR + INDEXED_RANK[e.indexed.state] + BIB_RANK[e.bib.state];
}

// ── Helpers ─────────────────────────────────────────────────────────────

// Bib wins over catalog: master.bib is the authoritative source. Catalog
// fields are a snapshot from index time and can drift after auth runs.

function numericYear(e: CatalogEntry, bibByKey: Map<string, BibEntry>): number {
  const bibYear = e.citekey ? bibByKey.get(e.citekey)?.fields.year : undefined;
  if (bibYear) {
    const n = parseInt(bibYear, 10);
    if (!Number.isNaN(n)) return n;
  }
  if (typeof e.year === "number") return e.year;
  return -Infinity;
}

function titleOf(e: CatalogEntry, bibByKey: Map<string, BibEntry>): string {
  return (
    (e.citekey ? bibByKey.get(e.citekey)?.fields.title : undefined) ??
    e.title ??
    e.originalFilename ??
    ""
  );
}

function firstAuthorSurname(
  e: CatalogEntry,
  bibByKey: Map<string, BibEntry>,
): string {
  let raw = "";
  if (e.citekey) {
    const bib = bibByKey.get(e.citekey);
    if (bib?.fields.author) raw = bib.fields.author.split(" and ")[0];
    else if (bib?.fields.editor) raw = bib.fields.editor.split(" and ")[0];
  }
  if (!raw && e.authors && e.authors.length > 0) raw = e.authors[0];
  raw = raw.trim();
  if (!raw) return "";
  if (raw.includes(",")) return raw.split(",", 1)[0].trim().toLowerCase();
  const words = raw.split(/\s+/);
  return words[words.length - 1].toLowerCase();
}

// ── localStorage hydration / persistence ────────────────────────────────

export const COL_WIDTHS_KEY = "virgil-library-col-widths";
export const COL_SORT_KEY = "virgil-library-col-sort";

export function loadWidths(): Record<ResizableColId, number> {
  if (typeof window === "undefined") return { ...DEFAULT_WIDTHS };
  try {
    const raw = localStorage.getItem(COL_WIDTHS_KEY);
    if (!raw) return { ...DEFAULT_WIDTHS };
    const parsed = JSON.parse(raw) as Partial<Record<ResizableColId, number>>;
    const out = { ...DEFAULT_WIDTHS };
    for (const k of Object.keys(DEFAULT_WIDTHS) as ResizableColId[]) {
      const v = parsed[k];
      if (typeof v === "number" && Number.isFinite(v)) out[k] = clampWidth(k, v);
    }
    return out;
  } catch {
    return { ...DEFAULT_WIDTHS };
  }
}

export function saveWidths(w: Record<ResizableColId, number>): void {
  try {
    localStorage.setItem(COL_WIDTHS_KEY, JSON.stringify(w));
  } catch {
    // ignore
  }
}

export function loadSort(): { col: SortColId; dir: SortDir } {
  const fallback: { col: SortColId; dir: SortDir } = { col: "year", dir: "desc" };
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(COL_SORT_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as { col?: string; dir?: string };
    if (
      parsed.col &&
      ["year", "author", "title", "status", "citekey"].includes(parsed.col) &&
      (parsed.dir === "asc" || parsed.dir === "desc")
    ) {
      return { col: parsed.col as SortColId, dir: parsed.dir };
    }
    return fallback;
  } catch {
    return fallback;
  }
}

export function saveSort(s: { col: SortColId; dir: SortDir }): void {
  try {
    localStorage.setItem(COL_SORT_KEY, JSON.stringify(s));
  } catch {
    // ignore
  }
}
