/**
 * Shared types for the Virgil Library.
 *
 * The library is a user-picked folder, global across all open documents,
 * that holds PDFs and Cowork-produced sidecars. Virgil reads; Cowork
 * reads/writes. See src/lib/library/README in the plan file for the
 * filesystem contract.
 */

export type LibraryItemStatus =
  | "pending"
  | "extracting"
  | "ocring"
  | "ready"
  | "failed";

/** Bib-authentication state mirrored from `catalog.json`'s `bib.state`. */
export type LibraryBibState =
  | "none"
  | "unverified"
  | "authenticated"
  | "manuscript"
  | "canonical"
  | "failed";

/**
 * Coarse, paper-side processing tier for a library entry — derived from the
 * catalog's `indexed.state` (`none | queued | running | indexed | deepIndexed
 * | failed`). This is the human-readable axis surfaced on bibliography /
 * citation cards (Bib only / Indexed PDF / Deep-indexed PDF), kept distinct
 * from the orthogonal `LibraryBibState` auth axis. A paper-side derived
 * vocabulary, so the card layer never imports the library's `IndexedState`.
 */
export type LibraryIndexTier =
  | "bib-only" // no PDF / not indexed (indexed.state none)
  | "processing" // queued or extracting (indexed.state queued|running)
  | "indexed" // standard extraction (indexed.state indexed)
  | "deep-indexed" // structural cleanup applied (indexed.state deepIndexed)
  | "failed"; // extraction failed

/** One row in `library-index.json` — the manifest Virgil polls. */
export interface LibraryIndexItem {
  /** Stable UUID assigned by Cowork; also the folder name for this item. */
  id: string;
  status: LibraryItemStatus;
  /** Citekey Cowork inferred (if any). Matches against references.bib keys. */
  citekey?: string;
  title?: string;
  authors?: string[];
  year?: number;
  doi?: string;
  pageCount?: number;
  /** True if Cowork found real print page numbers; false means pdfPage is used. */
  hasPrintPageNumbers?: boolean;
  /** ISO timestamp of the last Cowork-side write to this item's files. */
  updatedAt?: string;
  /** Auth state for the matching `master.bib` entry, when known. */
  bibState?: LibraryBibState;
  /** Processing tier derived from the catalog's `indexed.state` — the
   *  Bib only / Indexed PDF / Deep-indexed PDF axis. */
  indexTier?: LibraryIndexTier;
}

/** Whole-manifest shape written at `library-index.json`. */
export interface LibraryManifest {
  version: 1;
  generatedAt?: string;
  items: LibraryIndexItem[];
}

/** Richer metadata read on-demand from `<uuid>/meta.json`. Superset of index row. */
export interface LibraryItemMeta extends LibraryIndexItem {
  abstract?: string;
  publisher?: string;
  journal?: string;
  volume?: string;
  issue?: string;
  isbn?: string;
  url?: string;
  /** Raw BibTeX, if Cowork can generate one. */
  bibtex?: string;
  /** Free-form additional fields we don't model explicitly. */
  extra?: Record<string, string | number | boolean>;
}

export type LibraryParagraphKind =
  | "body"
  | "heading"
  | "footnote"
  | "caption"
  | "list-item";

export interface LibraryParagraph {
  id: string;
  text: string;
  kind?: LibraryParagraphKind;
}

export interface LibraryPage {
  /** Human-facing page number. Usually numeric-as-string; roman numerals possible. */
  printPage: string;
  /** 1-indexed position inside the PDF. */
  pdfPage: number;
  /** True when there was no printed page number; `printPage` falls back to pdfPage. */
  printPageMissing?: boolean;
  paragraphs: LibraryParagraph[];
}

/** Shape of `<uuid>/text.json`. */
export interface LibraryText {
  itemId: string;
  pages: LibraryPage[];
}

/** Diagnostic / progress detail from `<uuid>/status.json`. Manifest is authoritative for UI status. */
export interface LibraryItemStatusDetail {
  status: LibraryItemStatus;
  /** Human-readable progress message. */
  message?: string;
  /** Cowork-side error if status = failed. */
  error?: string;
  updatedAt?: string;
}

// ---------------------------------------------------------------------------
// Per-doc overlay (Virgil-owned, lives in doc's virgil/library-overlay.json)
// ---------------------------------------------------------------------------

export interface LibraryOverlay {
  /** Markdown notes the user wrote about a library item, scoped to this doc. */
  notesByItemId: Record<string, string>;
}

export const EMPTY_LIBRARY_OVERLAY: LibraryOverlay = {
  notesByItemId: {},
};

// ---------------------------------------------------------------------------
// Derived / computed (not persisted)
// ---------------------------------------------------------------------------

/** Per-doc, per-item alignment with the doc's references.bib. */
export type CitationAlignment =
  /** Library item's citekey matches a key in this doc's bib. */
  | "cited-here"
  /** Library item has a citekey but it's not in this doc's bib. */
  | "not-in-bib"
  /** Library item has no citekey yet (Cowork hasn't assigned one). */
  | "unresolved";
