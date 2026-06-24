/**
 * Shared types for the Panel architecture.
 *
 * `PanelKind` is the canonical identifier for every panel in the app —
 * the same string used by `useViewPrefs.PanelId`, minus the layout-only
 * slots (`blank`). The registry in `../panel-registry.ts` is keyed by
 * `PanelKind` and is the single source of truth for panel↔card
 * metadata.
 *
 * `CardKind` matches the keys of `CARD_THEMES` in `panel-primitives.tsx`.
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
  | "cutter"
  | "reports"
  | "examples"
  | "search"
  | "wordcount"
  | "errors"
  | "omni";

// `CardKind` canonical home moved to `src/cards/types.ts` (beside CARD_REGISTRY).
// Re-exported here for ripple-minimization — existing `@/panels/_shared/types`
// importers are unchanged.
export type { CardKind } from "@/cards/types";

/** A single item to render inside the Omni view. */
export interface OmniItem {
  /** Globally unique within the omni list. Shape: `float:card:<kind>:<id>`
   *  (built by `cardPopKey`/`popKey`); a multi-anchor card appends an
   *  `@<index>` suffix per anchor. */
  id: string;
  /** Editor document position (null for unanchored items).
   *
   *  NOTE: this is a *baked* position — captured by the builder's
   *  `findParagraphPos` only when the omni `items` memo last (structurally)
   *  rebuilt. It goes STALE as plain typing shifts content. Consumers that
   *  position a card inline (the `useInTextPositions` cascade, the
   *  anchored/orphaned binning) MUST prefer the LIVE position resolved from
   *  `anchorUuid` via the `DocStructureObserver` block snapshot — see
   *  `useLivePosResolver(editor, keyOf, paragraphAnchors)`. Falling back to this
   *  baked `pos` is the cause of the "note cards drift/stack at the top while
   *  typing" bug for paragraph-anchored kinds. */
  pos: number | null;
  /** Paragraph (text-object) UUID this item is anchored to, for
   *  paragraph-anchored kinds (note / todo / cutter / revision / report /
   *  archive). Lets `useLivePosResolver` re-resolve a LIVE document position
   *  from the per-transaction-remapped `DocStructureObserver` block snapshot,
   *  the same way footnotes / citations / examples already track live — so the
   *  card stays aligned with its paragraph during typing instead of riding the
   *  stale baked `pos`. Absent for entity-anchored kinds (their live pos comes
   *  from `cardPopKey(kind, entityId)`) and for `free` items (no anchor). */
  anchorUuid?: string;
  /** Where this item sits relative to the document:
   *  - `"anchored"`  — has a link AND it resolved to a live doc position.
   *  - `"free"`      — carries no link at all (no in-text marker / no
   *                    linked paragraph); lives only in its sidecar.
   *  - `"orphaned"`  — *intends* to anchor (has a link / in-text marker)
   *                    but the target is missing from the doc, so `pos`
   *                    came back null.
   *  The omni view routes `free` + `orphaned` into the unanchored bin and
   *  cascades only `anchored` items inline with the text. */
  anchorState: "anchored" | "free" | "orphaned";
  /** True when focus view is active and this card's anchor falls OUTSIDE the
   *  focused band. Its in-text anchor is hidden (`display:none`), so it can't
   *  cascade inline; the omni view routes it into the collapsed "N outside
   *  focus" bin instead of dropping it (which would read as data loss). Stamped
   *  by the omni-host focus filter; unset/false otherwise. */
  outsideFocus?: boolean;
  /** When set, this card NESTS under another omni card (its parent) — it
   *  stays a STANDALONE positioned card in the cascade (NOT a DOM child of
   *  the parent), but renders one indent step (16px, `ml-4`) to the right and
   *  is routed to the parent's filter category, so it reads visually like a
   *  bib card under its cite card. The value is the parent's omni-item `id`
   *  (the canonical `float:card:<kind>:<id>` key built by `cardPopKey`).
   *
   *  Phase 1 (shipped): a `\cite` nested inside a footnote body
   *  (`structure.citations[].nestedInFootnoteId`) → its footnote's omni item.
   *  The footnote-nested cite already shares the footnote's anchor `pos`, so
   *  the cascade already stacks it directly below the footnote card; this
   *  field adds the indent + the parent-following ordering + the category
   *  routing. Stamped in `nest-footnote-children.ts` from a snapshot-gated
   *  map (keystroke-safe — no per-keystroke doc walk).
   *
   *  Phase 2 (seam, NOT yet implemented): once `\ref` carries a
   *  `nestedInFootnoteId`-equivalent tag in the footnote-body walk, refs nest
   *  the same way for free. Block cards (examples) are out of scope — footnote
   *  bodies hold only inline content. */
  parentCardId?: string;
  /** Pre-rendered card. Must include `data-omni-entry={id}` on its
   *  outermost element so `useInTextPositions` can measure it. */
  content: ReactNode;
}
