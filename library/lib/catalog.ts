// .virgil/catalog.json types and reader. The skill-side rebuilds this file
// after every run; the frontend never writes it (drag-drop only writes to
// unsorted/ and .virgil/queue/).

import { readJsonFile, ROOT_FILES, readTextFile } from "./library-storage";

export type IndexedState =
  | "none"
  | "queued"
  | "running"
  | "indexed"
  | "deepIndexed"
  | "failed";

/** Legacy on-disk state from before the rich-index → deep-index rename.
 *  Read paths normalize this to "deepIndexed"; new writes never use it. */
export type LegacyIndexedState = "richIndexed";

export type BibAuthState =
  | "none"
  | "unverified"
  | "authenticated"
  | "manuscript"
  | "canonical"
  | "failed"
  // Metadata-mismatch policy rewrote the entry's fields from the on-disk
  // file (apply_metadata_mismatch_policy.py); awaiting a re-authentication
  // pass before the new fields are trusted. Action needed. Mirrors the
  // canonical Python set in library/scripts/_tools.py CANONICAL_BIB_STATES.
  | "needs-reauth";

export type SourceFormat = "pdf" | "docx" | "tex";

export interface PdfStatus {
  present: boolean;
  filename?: string;
  sha256?: string;
  pageCount?: number;
  // Source format. Absent → treat as "pdf" (libraries indexed before
  // .docx support shipped won't have this field).
  format?: SourceFormat;
  // Lower-priority same-citekey source files kept on disk as archives.
  // Filenames only (relative to papers/<citekey>/). e.g., when a .docx
  // supersedes a .pdf, alternates = ["<citekey>.pdf"].
  alternates?: string[];
}

export interface IndexedStatus {
  state: IndexedState;
  lastIndexedAt?: string;
  extractor?: "marker" | "pymupdf" | "docx-native" | "docling" | "pdftotext-fallback" | "tex-passthrough";
  pgmarkCount?: number;
  // Where this document prints its page numbers — determined during
  // pgmark detection. Tells downstream tools which margin band to trust
  // when interpreting pgmark positions.
  //   "header"  — page numbers in top margin (e.g. Linguistic Inquiry)
  //   "footer"  — page numbers in bottom margin (e.g. Philosophical Review)
  //   "mixed"   — front matter and body use different bands
  //   "unknown" — no clean signal (DOCX sources, scanned PDFs, etc.)
  pgmarkPosition?: "header" | "footer" | "mixed" | "unknown";
  // Filename of the source the pgmarks were derived from. Set when
  // pgmarks came from a PDF alternate via fusion (see /library/fuse-alternate
  // and the auto-step inside index_paper.py). Absent on rows from before
  // fusion shipped: pgmarks (if any) came from the primary source named in
  // pdf.filename.
  pgmarkSource?: string;
  footnoteCount?: number;
  warnings?: string[];
}

export interface BibFieldChange {
  field: string;
  from: string;
  to: string;
  source: string;
  at: string;
}

export interface BibStatus {
  state: BibAuthState;
  authenticatedAt?: string;
  doiVerified?: boolean;
  sources?: string[];
  fieldChanges?: BibFieldChange[];
  // Confidence score (0–1) and a free-text provenance note from the auth
  // pipeline (bib_auth.py AuthResult). Already written to catalog.json /
  // surfaced in the master.bib comment; declared here so readers can show
  // *why* an entry is authenticated (esp. F#3 pre-digital corroboration).
  score?: number;
  note?: string;
  manuallyAcceptedAt?: string;
  // Set by the bib-merge engine (merge_paper_references.py) when this paper's
  // references.bib has been folded into the central master.bib — surfaced as a
  // blue "imported" check. Skill-written only; the frontend reads but never
  // writes the catalog.
  imported?: boolean;
  importedAt?: string;
  // Sorted NFC citekeys present in references.bib at import time. Used for
  // additions-only invalidation: if references.bib later gains a citekey not in
  // this set, `imported` is cleared by the next library skill run that touches
  // the bibliography (the /library/clean-bibliography tail step, or the
  // catch-all sweep in /library/index-pending) — not synchronously. Removals
  // are ignored.
  importedKeys?: string[];
}

export interface CatalogEntry {
  citekey: string | null; // null while triaging an unsorted PDF
  title?: string;
  authors?: string[];
  year?: number;
  doi?: string;
  addedAt: string;
  updatedAt: string;
  pdf: PdfStatus;
  indexed: IndexedStatus;
  bib: BibStatus;
  originalFilename?: string;
  isScanned?: boolean;
  tags?: string[];
  /**
   * Operator pin: when true, the deep-index family must not rewrite this
   * paper's `master.bib` fields or the catalog `title`. It is the ONLY
   * block-the-pass condition in the whole convergence loop — the pipeline
   * emits `DEEP_INDEX_STALLED` with reason token `metadata-lock` instead
   * of applying the file-is-source-of-truth default
   * (`library/skills/_doctrine.md` §4).
   *
   * Hand-set today via `update_catalog_entry.py --patch-file` (the recipe
   * is in §4); there is no UI for it yet. Declared here so the field is
   * part of the app's model of a row rather than an undeclared key the
   * frontend is merely incapable of destroying — the app never rewrites
   * catalog entries, but a reader that wants to surface the pin needs a
   * name to read. Written by the operator and by Python only; the
   * frontend reads and never writes the catalog.
   *
   * Consumed by `library/scripts/apply_metadata_mismatch_policy.py`
   * (`METADATA_LOCK_KEY`), which is the SSOT for the spelling.
   */
  metadataLock?: boolean;
}

export interface Catalog {
  version: number;
  generatedAt: string;
  entries: CatalogEntry[];
}

export async function readCatalog(
  root: FileSystemDirectoryHandle,
): Promise<Catalog> {
  const c = await readJsonFile<Catalog>(root, ROOT_FILES.catalog);
  if (!c) {
    return { version: 1, generatedAt: new Date().toISOString(), entries: [] };
  }
  if (typeof c.version !== "number" || c.version < 1) {
    console.warn(`[library] catalog.json has unrecognized version ${c.version}; ignoring`);
    return { version: 1, generatedAt: new Date().toISOString(), entries: [] };
  }
  if (c.version > 1) {
    console.warn(`[library] catalog.json is version ${c.version}, reader knows version 1 — reading entries optimistically`);
  }
  return { ...c, entries: c.entries.map(normalizeCatalogEntry) };
}

/** Normalize legacy field values on a freshly-read catalog entry. The
 *  rich-index → deep-index rename leaves on-disk catalogs with
 *  `indexed.state === "richIndexed"`; the rest of the codebase only
 *  knows about "deepIndexed", so we translate here. Idempotent. */
export function normalizeCatalogEntry(e: CatalogEntry): CatalogEntry {
  const legacyState = (e.indexed?.state as string | undefined);
  if (legacyState === "richIndexed") {
    return { ...e, indexed: { ...e.indexed, state: "deepIndexed" } };
  }
  return e;
}

export async function readCatalogVersion(
  root: FileSystemDirectoryHandle,
): Promise<string> {
  return (await readTextFile(root, ROOT_FILES.catalogVersion))?.trim() ?? "0";
}
