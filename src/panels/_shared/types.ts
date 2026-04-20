/**
 * Shared types for the Panel architecture.
 *
 * `PanelKind` is the canonical identifier for every panel in the app —
 * the same string used by `useViewPrefs.PanelId`, minus the layout-only
 * slots (`blank`). The registry in `../panel-registry.ts` is keyed by
 * `PanelKind` and is the single source of truth for panel↔card
 * metadata.
 *
 * `CardKind` matches the keys of `CARD_THEMES` in `panel-primitives.tsx`,
 * with `"quotation"` added for the one card kind that has no themed
 * variant.
 */

import type { ReactNode } from "react";

export type PanelKind =
  | "outline"
  | "todo"
  | "notes"
  | "revisions"
  | "archive"
  | "footnotes"
  | "citations"
  | "bibliography"
  | "suggestions"
  | "cutter"
  | "quotations"
  | "search"
  | "wordcount"
  | "omni";

export type CardKind =
  | "note"
  | "footnote"
  | "archive"
  | "todo"
  | "bib"
  | "citation"
  | "comment"
  | "cut"
  | "quotation"
  | "ai";

/** A single item to render inside the Omni view. */
export interface OmniItem {
  /** Globally unique within the omni list. Shape: `${cardKind}:${id}`. */
  id: string;
  /** Editor document position (null for unanchored items). */
  pos: number | null;
  /** Pre-rendered card. Must include `data-omni-entry={id}` on its
   *  outermost element so `useInTextPositions` can measure it. */
  content: ReactNode;
}
