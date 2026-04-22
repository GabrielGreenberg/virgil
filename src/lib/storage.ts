/**
 * Storage facade — re-exports from either the FSA or dev backend.
 *
 * When `NEXT_PUBLIC_DEV_STORAGE` is set (e.g. via the `dev:preview` npm
 * script or .claude/launch.json), the dev backend is used so the app
 * works in headless previews without needing the File System Access API.
 *
 * In production builds the env var is absent, so the FSA backend is used
 * and the dev module is tree-shaken out.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export const isDevStorage = !!process.env.NEXT_PUBLIC_DEV_STORAGE;

// Dynamic re-export: pick the right backend at module load time.
// The ternary is evaluated at build/bundle time by Next.js, so the
// unused branch gets tree-shaken in production.
const backend: typeof import("@/lib/storage-fsa") = isDevStorage
  ? (require("@/lib/storage-dev") as any)
  : (require("@/lib/storage-fsa") as any);

export const readSidecar = backend.readSidecar;
export const writeSidecar = backend.writeSidecar;
export const readTex = backend.readTex;
export const writeTex = backend.writeTex;
export const readDocBundle = backend.readDocBundle;
export const writeDocBundle = backend.writeDocBundle;
export const readBib = backend.readBib;
export const writeBib = backend.writeBib;
export const readGeneralBib = backend.readGeneralBib;
export const pickGeneralBib = backend.pickGeneralBib;
export const createDocFromPicker = backend.createDocFromPicker;
export const createDocInFolder = backend.createDocInFolder;
export const pickProjectFolder = backend.pickProjectFolder;
export const registerDocInFolder = backend.registerDocInFolder;
export const openExistingDocFromPicker = backend.openExistingDocFromPicker;
export const listDocs = backend.listDocs;
export const renameDoc = backend.renameDoc;
export const deleteDocFromIndex = backend.deleteDocFromIndex;
export const flushDoc = backend.flushDoc;
export const detectBibPackage = backend.detectBibPackage;
export const readPaperFolder = backend.readPaperFolder;
export const getTexFilename = backend.getTexFilename;

// Re-export types (these are the same in both backends).
export type { DocBundle, BibReadResult, BibPackage, GeneralBibPickResult, GeneralBibContents, FolderPickResult, PaperFile } from "@/lib/storage-fsa";
