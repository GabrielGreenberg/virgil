/**
 * Built-in document templates used by the "Create new document" flow.
 *
 * A template is the minimal set of files a fresh document starts with —
 * the main .tex, any sibling files the .tex depends on (e.g. a .bib), and
 * the `virgil/` subdirectory (created separately by the storage layer).
 *
 * Templates are now **derived from the canonical `DOC_TYPES` SSOT**
 * (`doc-types.ts`): each doc type (blank / article / book / report) fixes a
 * `\documentclass` and a starter-body shape, and the typed classes scaffold
 * bibliography material by default. This module is the thin compatibility
 * bridge that presents those doc types as the `DocumentTemplate` shape the
 * create-file pipeline (storage-fsa / storage-dev / dev route) already speaks;
 * `templateId` and `docType.id` are the same string.
 *
 * To add, rename, or retire a doc type, edit `doc-types.ts` — not this file.
 * There is no runtime template editor by design: we keep the starter set
 * curated in source.
 */

import {
  DOC_TYPES,
  DEFAULT_DOC_TYPE_ID,
  buildDocTypeFiles,
  type DocType,
} from "@/lib/doc-types";

export interface DocumentTemplate {
  /** Stable id used in URLs, logs, and as the picker default. */
  id: string;
  /** Display name in the picker. */
  name: string;
  /** Short one-liner shown under the name. */
  description: string;
  /**
   * The main .tex filename written to disk (e.g. "document.tex" or
   * "main.tex"). Stored on FsaDocMeta so later reads know which file
   * is the entry point.
   */
  mainTexFilename: string;
  /**
   * All files to create in the paper folder, keyed by filename. Values
   * are UTF-8 text. The main .tex must have a key matching
   * `mainTexFilename`.
   */
  files: Record<string, string>;
}

function docTypeToTemplate(dt: DocType): DocumentTemplate {
  return {
    id: dt.id,
    name: dt.label,
    description: dt.description,
    mainTexFilename: dt.mainTexFilename,
    files: buildDocTypeFiles(dt),
  };
}

export const DOCUMENT_TEMPLATES: DocumentTemplate[] =
  DOC_TYPES.map(docTypeToTemplate);

export function getTemplate(id: string): DocumentTemplate | undefined {
  return DOCUMENT_TEMPLATES.find((t) => t.id === id);
}

/** The default template used when the caller doesn't specify one. */
export const DEFAULT_TEMPLATE_ID = DEFAULT_DOC_TYPE_ID;
