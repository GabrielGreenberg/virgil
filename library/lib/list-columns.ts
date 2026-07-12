// Column model for the LeftList — widths, sort state, persisted in
// localStorage. Both LeftList (header) and LeftListRow (data row)
// import the same grid-template builder so headers and cells line up
// pixel-for-pixel.

import type { CatalogEntry, IndexedState, BibAuthState } from "./catalog";
import type { BibEntry } from "./types";
import colOrderDefaults from "./list-columns.defaults.json";

/** Columns the user can sort by. */
export type SortColId = "year" | "author" | "title" | "status" | "citekey";

export type SortDir = "asc" | "desc";

/** A single index-status facet the user can sort by (F#14). Meaningful ONLY
 *  when `col === "status"`; absent → the composite `statusRank` (reached by
 *  clicking the STATUS label). The ONE shared `FACETS` array below drives the
 *  StatusPills glyph order, this comparator switch, AND the sub-bar segments,
 *  so the three can never drift. */
export type StatusFacet = "pdf" | "idx" | "bib" | "imp";

/** The canonical facet order — glyph order in StatusPills (pdf · idx · bib ·
 *  imp), the sub-bar segment order, and the comparator routing. Single source
 *  of truth for all three (F#14): StatusPills `.map`s this array onto its
 *  per-facet pill, the FacetSubBar `.map`s it onto its segments, and the
 *  `compareStatusFacet` switch is exhaustive over it — none can drift. */
export const FACETS: readonly StatusFacet[] = ["pdf", "idx", "bib", "imp"];

/** The shared sub-grid track template for the STATUS column's four facets —
 *  one `minmax(0, 1fr)` track per FACET. The SAME string drives BOTH the
 *  FacetSubBar header segments AND the row's `StatusPills` cell (grid mode),
 *  so the four header labels (pdf · idx · bib · imp) and the four row pills
 *  share identical tracks and always align — and scale together when the
 *  STATUS column is resized (F#13). `minmax(0, 1fr)` (not bare `1fr`) lets
 *  each cell shrink below its content width instead of overflowing the
 *  column at its min width. Kept next to FACETS so the track count and the
 *  facet count can't drift. */
export const STATUS_SUBGRID = "repeat(4, minmax(0, 1fr))";

const FACET_IDS: ReadonlySet<string> = new Set(FACETS);

export function isStatusFacet(s: unknown): s is StatusFacet {
  return typeof s === "string" && FACET_IDS.has(s);
}

/** The full sort state: a column, a direction, and — only when sorting the
 *  STATUS column by a single facet — which facet. Absent `facet` (or any
 *  non-status column) means the composite `statusRank` sort. */
export interface SortState {
  col: SortColId;
  dir: SortDir;
  facet?: StatusFacet;
}

export type ResizableColId = "year" | "author" | "status" | "citekey";

/** The five header-bearing CONTENT columns the user can drag to reorder
 *  (F#13). Superset of `ResizableColId`: `title` is the 1fr filler track —
 *  reorderable but NOT resizable (it has no width entry). The resizers
 *  interleave between adjacent content columns and travel WITH the order. */
export type ReorderableColId =
  | "year"
  | "author"
  | "title"
  | "status"
  | "citekey";

/** The shipped default column order. Single source = list-columns.defaults.json
 *  (so the in-code fallback and the promotable/shipped default can't drift —
 *  the same file rides the promote-defaults pipeline). */
export const DEFAULT_COL_ORDER: readonly ReorderableColId[] =
  colOrderDefaults.colOrder as ReorderableColId[];

const REORDERABLE_COL_IDS: ReadonlySet<string> = new Set([
  "year",
  "author",
  "title",
  "status",
  "citekey",
]);

export function isReorderableColId(s: unknown): s is ReorderableColId {
  return typeof s === "string" && REORDERABLE_COL_IDS.has(s);
}

/** Coerce a (possibly partial / hand-edited / undefined) saved order into a
 *  valid, complete permutation of the five reorderable columns: keep the
 *  first occurrence of each known id in the saved order, drop unknowns +
 *  duplicates, then APPEND any of the five that are missing (in the default
 *  order). A fully-absent/invalid input resolves to `DEFAULT_COL_ORDER` so a
 *  column can never silently disappear. */
export function resolveColOrder(
  saved: readonly string[] | undefined | null,
): ReorderableColId[] {
  const out: ReorderableColId[] = [];
  const seen = new Set<ReorderableColId>();
  if (Array.isArray(saved)) {
    for (const c of saved) {
      if (isReorderableColId(c) && !seen.has(c)) {
        seen.add(c);
        out.push(c);
      }
    }
  }
  for (const c of DEFAULT_COL_ORDER) {
    if (!seen.has(c)) {
      seen.add(c);
      out.push(c);
    }
  }
  return out;
}

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

/** The inherited CSS custom property carrying the live column template.
 *  Defined ONCE on the LeftList root (and rewritten there imperatively per
 *  drag frame by the pane-resize engine); the header grid and every row's
 *  grid reference it via `COL_TEMPLATE_REF`. Shared here so LeftListRow's
 *  drag ghost can re-anchor the RESOLVED value on its body-appended clone
 *  (outside the list root the var is undefined and the ghost's
 *  `grid-template-columns: var(...)` would collapse to `none`). */
export const COL_TEMPLATE_VAR = "--lib-col-template";
export const COL_TEMPLATE_REF = `var(${COL_TEMPLATE_VAR})`;

export function clampWidth(col: ResizableColId, w: number): number {
  return Math.max(MIN_WIDTHS[col], Math.min(MAX_WIDTHS[col], Math.round(w)));
}

/** Track string for one content column: the 1fr filler for `title`, else its
 *  px width. */
function trackFor(col: ReorderableColId, widths: Record<ResizableColId, number>): string {
  return col === "title" ? "1fr" : `${widths[col]}px`;
}

/**
 * Build the grid-template from the LIVE column order (F#13). For N content
 * columns we emit N tracks with a `RESIZER_WIDTH` track BETWEEN every adjacent
 * pair (N-1 resizers) — for the default 5 columns that's the same 9-track grid
 * as before (no trailing bib-imp track, dropped in F#14). `title` is always the
 * lone 1fr; every other column gets its px width. The header + every row import
 * this single builder so they line up pixel-for-pixel.
 */
export function gridTemplate(
  widths: Record<ResizableColId, number>,
  order: readonly ReorderableColId[] = DEFAULT_COL_ORDER,
): string {
  const tracks: string[] = [];
  order.forEach((col, i) => {
    tracks.push(trackFor(col, widths));
    if (i < order.length - 1) tracks.push(`${RESIZER_WIDTH}px`);
  });
  return tracks.join(" ");
}

/**
 * Resolve which real (px-resizable) columns a resizer boundary controls, from
 * the LIVE order. The boundary `i` sits between `order[i]` and `order[i+1]`.
 *
 * The asymmetry is load-bearing: the `title` column is the 1fr filler that
 * absorbs slack, so a resizer must NOT try to resize `title` (it has no width).
 *   - A boundary on the LEFT side of title pulls only the single non-title
 *     neighbor ({left: "year"|"author", right: null}); the delta flows into
 *     the 1fr.
 *   - A boundary on the RIGHT side of title pulls the two real px neighbors
 *     ({left: "status", right: "citekey"}) so the 1fr doesn't absorb the
 *     delta, EXCEPT the boundary immediately right of title, which shrinks
 *     only the right neighbor ({left: null, right: "status"}).
 * `title` on either side maps to `null` for that side.
 *
 * This makes resize correct for ANY column arrangement, including title at
 * index 0 or last.
 */
export function resizeNeighborsForBoundary(
  order: readonly ReorderableColId[],
  boundaryIndex: number,
): { left: ResizableColId | null; right: ResizableColId | null } {
  const leftCol = order[boundaryIndex];
  const rightCol = order[boundaryIndex + 1];
  const titleIdx = order.indexOf("title");

  const asResizable = (c: ReorderableColId | undefined): ResizableColId | null =>
    c && c !== "title" ? c : null;

  // Boundary entirely LEFT of title (both neighbors at index < titleIdx, i.e.
  // the right neighbor is at-or-before title): pull only the non-title neighbor,
  // delta flows into the 1fr. When title sits exactly to the boundary's right,
  // leftCol is real and rightCol is title → {left: leftCol, right: null}.
  if (boundaryIndex + 1 <= titleIdx) {
    return { left: asResizable(leftCol), right: null };
  }
  // Boundary at-or-right of title.
  // Immediately right of title (leftCol === title): shrink only the right
  // neighbor — the 1fr is on the left, so a single-sided pull on the right.
  if (leftCol === "title") {
    return { left: null, right: asResizable(rightCol) };
  }
  // Two real px neighbors to the right of title: pull both.
  return { left: asResizable(leftCol), right: asResizable(rightCol) };
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
  "needs-reauth": 4,
  failed: 5,
  none: 6,
};

/** Compare two catalog entries for the given sort column. Returns the
 *  ascending result; the caller flips the sign for descending. When `col ===
 *  "status"` and a `facet` is given, routes to the single-facet comparator
 *  (F#14); otherwise the status case is the composite `statusRank`. */
export function compareEntries(
  a: CatalogEntry,
  b: CatalogEntry,
  bibByKey: Map<string, BibEntry>,
  col: SortColId,
  facet?: StatusFacet,
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
      return facet
        ? compareStatusFacet(a, b, facet)
        : statusRank(a) - statusRank(b);
    case "citekey":
      return (a.citekey ?? "").localeCompare(b.citekey ?? "");
  }
}

export function sortEntries(
  entries: CatalogEntry[],
  bibByKey: Map<string, BibEntry>,
  col: SortColId,
  dir: SortDir,
  facet?: StatusFacet,
): CatalogEntry[] {
  const arr = [...entries];
  const sign = dir === "asc" ? 1 : -1;
  arr.sort((a, b) => sign * compareEntries(a, b, bibByKey, col, facet));
  return arr;
}

function statusRank(e: CatalogEntry): number {
  const pdfR = e.pdf.present ? 0 : 4;
  return pdfR + INDEXED_RANK[e.indexed.state] + BIB_RANK[e.bib.state];
}

/** Per-facet rank: the ASCENDING comparand for a single status facet, where
 *  the BEST value (deepIndexed / authenticated / has-PDF / imported) is the
 *  SMALLEST — so the ascending sort puts best-first, and the existing `dir`
 *  flip reverses it (F#14: click best-first, re-click reverses). The pdf/imp
 *  facets are booleans (present/imported → 0, else 1); idx/bib reuse the
 *  existing INDEXED_RANK / BIB_RANK tables. */
function facetRank(e: CatalogEntry, facet: StatusFacet): number {
  switch (facet) {
    case "pdf":
      return e.pdf.present ? 0 : 1;
    case "idx":
      return INDEXED_RANK[e.indexed.state];
    case "bib":
      return BIB_RANK[e.bib.state];
    case "imp":
      return e.bib.imported ? 0 : 1;
  }
}

/** Compare two entries on one status facet, best-first, with a stable citekey
 *  tie-break so equal-rank rows keep a deterministic order. */
function compareStatusFacet(
  a: CatalogEntry,
  b: CatalogEntry,
  facet: StatusFacet,
): number {
  const d = facetRank(a, facet) - facetRank(b, facet);
  if (d !== 0) return d;
  return (a.citekey ?? "").localeCompare(b.citekey ?? "");
}

/** Default direction when a facet (or the composite STATUS) is first picked:
 *  "asc" so the BEST values sort to the top (the facet ranks are best=0). The
 *  composite STATUS label also defaults best-first via this same "asc". */
export function defaultDirForStatusFacet(): SortDir {
  return "asc";
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

export function loadSort(): SortState {
  const fallback: SortState = { col: "year", dir: "desc" };
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(COL_SORT_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as { col?: string; dir?: string; facet?: string };
    if (
      parsed.col &&
      ["year", "author", "title", "status", "citekey"].includes(parsed.col) &&
      (parsed.dir === "asc" || parsed.dir === "desc")
    ) {
      const col = parsed.col as SortColId;
      // `facet` is only meaningful on the status column; ignore it elsewhere.
      const facet =
        col === "status" && isStatusFacet(parsed.facet) ? parsed.facet : undefined;
      return facet ? { col, dir: parsed.dir, facet } : { col, dir: parsed.dir };
    }
    return fallback;
  } catch {
    return fallback;
  }
}

export function saveSort(s: SortState): void {
  try {
    // Drop a stray facet on a non-status column so the blob stays canonical.
    const canonical: SortState =
      s.col === "status" && s.facet
        ? { col: s.col, dir: s.dir, facet: s.facet }
        : { col: s.col, dir: s.dir };
    localStorage.setItem(COL_SORT_KEY, JSON.stringify(canonical));
  } catch {
    // ignore
  }
}
