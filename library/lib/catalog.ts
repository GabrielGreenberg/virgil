// catalog.json types and reader. The skill-side rebuilds this file after
// every run; the frontend never writes it (drag-drop only writes to
// pdfs/unsorted/ and queue/).

import { readJsonFile, ROOT_FILES, readTextFile } from "./library-storage";

export type IndexedState =
  | "none"
  | "queued"
  | "running"
  | "indexed"
  | "richIndexed"
  | "failed";

export type BibAuthState =
  | "none"
  | "unverified"
  | "authenticated"
  | "manuscript"
  | "failed";

export type SourceFormat = "pdf" | "docx";

export interface PdfStatus {
  present: boolean;
  filename?: string;
  sha256?: string;
  pageCount?: number;
  // Source format. Absent → treat as "pdf" (libraries indexed before
  // .docx support shipped won't have this field).
  format?: SourceFormat;
  // Lower-priority same-citekey source files kept on disk as archives.
  // Filenames only (relative to pdfs/). e.g., when a .docx supersedes a
  // .pdf, alternates = ["<citekey>.pdf"].
  alternates?: string[];
}

export interface IndexedStatus {
  state: IndexedState;
  lastIndexedAt?: string;
  extractor?: "marker" | "pymupdf" | "docx-native" | "docling" | "pdftotext-fallback";
  pgmarkCount?: number;
  // Where this document prints its page numbers — determined during
  // pgmark detection. Tells downstream tools which margin band to trust
  // when interpreting pgmark positions.
  //   "header"  — page numbers in top margin (e.g. Linguistic Inquiry)
  //   "footer"  — page numbers in bottom margin (e.g. Philosophical Review)
  //   "mixed"   — front matter and body use different bands
  //   "unknown" — no clean signal (DOCX sources, scanned PDFs, etc.)
  pgmarkPosition?: "header" | "footer" | "mixed" | "unknown";
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
  manuallyAcceptedAt?: string;
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
}

export interface Catalog {
  version: 1;
  generatedAt: string;
  entries: CatalogEntry[];
}

export async function readCatalog(
  root: FileSystemDirectoryHandle,
): Promise<Catalog> {
  const c = await readJsonFile<Catalog>(root, ROOT_FILES.catalog);
  if (!c || c.version !== 1) {
    return { version: 1, generatedAt: new Date().toISOString(), entries: [] };
  }
  return c;
}

export async function readCatalogVersion(
  root: FileSystemDirectoryHandle,
): Promise<string> {
  return (await readTextFile(root, ROOT_FILES.catalogVersion))?.trim() ?? "0";
}
