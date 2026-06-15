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
  /** Editor document position (null for unanchored items). */
  pos: number | null;
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
  /** Pre-rendered card. Must include `data-omni-entry={id}` on its
   *  outermost element so `useInTextPositions` can measure it. */
  content: ReactNode;
}
