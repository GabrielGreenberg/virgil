/**
 * Storage facade — re-exports from either the FSA or dev backend.
 *
 * `NEXT_PUBLIC_DEV_STORAGE` enables the dev backend at build time (e.g.
 * via the `dev:preview` npm script or .claude/launch.json). At runtime
 * we then only actually pick the dev backend when FSA is unavailable —
 * i.e. inside the Claude Preview iframe or a browser without
 * `showDirectoryPicker`. The same dev server, loaded in a normal tab,
 * uses the real FSA backend so users can pick real folders on disk.
 *
 * In production builds the env var is absent, so the FSA backend is
 * always selected and the dev module is tree-shaken out.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export { isDevStorage } from "@/lib/storage-mode";
import { isDevStorage } from "@/lib/storage-mode";
import { flushPendingForDoc } from "@/lib/multi-window/pending-saves";

// Pick the right backend at module load. On the client this runs after
// `window` is defined, so the runtime capability check above is honored.
const backend: typeof import("@/lib/storage-fsa") = isDevStorage
  ? (require("@/lib/storage-dev") as any)
  : (require("@/lib/storage-fsa") as any);

export const readSidecar = backend.readSidecar;
export const readSidecarIfExists = backend.readSidecarIfExists;
export const writeSidecar = backend.writeSidecar;
export const readSidecarBundle = backend.readSidecarBundle;
export const invalidateSidecarBundle = backend.invalidateSidecarBundle;
export const readTex = backend.readTex;
export const writeTex = backend.writeTex;
export const readDocBundle = backend.readDocBundle;
export const writeDocBundle = backend.writeDocBundle;
export const readBib = backend.readBib;
export const writeBib = backend.writeBib;
export const createDocFromPicker = backend.createDocFromPicker;
export const createDocInFolder = backend.createDocInFolder;
export const pickProjectFolder = backend.pickProjectFolder;
export const registerDocInFolder = backend.registerDocInFolder;
export const openExistingDocFromPicker = backend.openExistingDocFromPicker;
export const listDocs = backend.listDocs;
export const renameDoc = backend.renameDoc;
export const deleteDocFromIndex = backend.deleteDocFromIndex;
export const flushDoc = backend.flushDoc;

/**
 * Full drain: fire any pending React-debounced save (if useDocument has
 * one registered), then wait for the storage write queue to empty.
 * Prefer over `flushDoc` at every boundary that requires the doc's
 * latest edits to be on disk — doc switch, tab close, compile, delete.
 * `flushDoc` alone has no visibility into un-fired React debounces, so
 * an edit made within the autosave debounce window would be missed.
 */
export async function drainDoc(docId: string): Promise<void> {
  await flushPendingForDoc(docId);
  await backend.flushDoc(docId);
}
export const detectBibPackage = backend.detectBibPackage;
export const readPaperFolder = backend.readPaperFolder;
export const getTexFilename = backend.getTexFilename;
// Non-stamping resolver for the resolved .bib filename. Used by the
// external-change watcher to resolve the watched .bib NAME without reading the
// .bib content or stamping the disk ledger (the anti-flicker invariant —
// readBib is a pure reader, name resolution stamps nothing).
export const getBibFilename = backend.getBibFilename;
// Cheap {mtimeMs,size} file-stat for the external-change watcher. Backend-
// agnostic: FSA uses getFile(); dev issues HEAD requests to the dev route.
// `null` for a path means the file is absent; FSA re-throws on permission loss.
export const statFiles = backend.statFiles;
// Generic NON-stamping reader of an EXACT relPath, used by the external-change
// watcher for its prime + confirm-by-hash reads so the bytes hashed are the
// same file that was stat'd (no name re-resolution, no ledger stamp). `null`
// for absent; FSA re-throws on permission loss. Backend-agnostic: FSA walks the
// dir handle; dev GETs the dev route.
export const readTextFile = backend.readTextFile;
export const writePdf = backend.writePdf;
export const readPdf = backend.readPdf;
export const getPdfFilename = backend.getPdfFilename;
export const pdfFilenameFromTex = backend.pdfFilenameFromTex;
// Figure raster cache + source reader. Backend-agnostic surface used by
// the figure-rendering pipeline; see src/hooks/useResolvedFigureUrl.ts.
export const readFigureSource = backend.readFigureSource;
export const readFigureRaster = backend.readFigureRaster;
export const writeFigureRaster = backend.writeFigureRaster;
export const deleteFigureRaster = backend.deleteFigureRaster;
export const readFigureIndex = backend.readFigureIndex;
export const writeFigureIndex = backend.writeFigureIndex;
export const getDocWriteHandle = backend.getDocWriteHandle;
// Figure file importer — copies a picked file into the paper folder (or
// short-circuits when the FSA picker confirmed it's already inside).
// Backend dispatches: FSA uses `docHandle.resolve()` + `createWritable`,
// dev uses the existing PUT route. The `PickedFigureFile` contract is
// shared, produced by `src/lib/figures/pick-file.ts`.
export const importFigureFile = backend.importFigureFile;

// Re-export types (these are the same in both backends).
export type { DocBundle, BibReadResult, BibPackage, FolderPickResult, PaperFile, PickedFigureFile, FileStat } from "@/lib/storage-fsa";

// Re-export the pipeline handle type so storage callers don't need to
// import from the multi-window subdirectory.
export type { DocWriteHandle } from "@/lib/multi-window/doc-pipeline";
