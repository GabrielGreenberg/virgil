// Subset of /Users/gabriel/Programming/virgil/src/lib/types.ts — only the
// types used by virgil-library. Phase 4 will fold these into a shared
// @virgil/core package.

export interface BibEntry {
  key: string;
  type: string;
  fields: Record<string, string>;
  raw: string;
}

export interface FootnoteRef {
  id: string;
  content: unknown;
  createdAt: string;
}

export interface FootnotesState {
  footnotes: FootnoteRef[];
}

export interface UserNote {
  id: string;
  title: string;
  content: unknown;
  createdAt: string;
  links: Link[];
}

export interface NotesState {
  notes: UserNote[];
}

export interface Link {
  id: string;
  href: string;
  label?: string;
}

// virgil.json paragraph-UUID sidecar (initialized empty per indexed paper).
export interface VirgilSidecar {
  paragraphs: Record<string, ParagraphMeta>;
}

export interface ParagraphMeta {
  id?: string;
  fingerprint?: string;
  title?: string;
}
