/**
 * Shared types for the Link architecture.
 *
 * A `Link` is a connection between an in-editor anchor and a side-panel
 * card. Three kinds cover every cross-reference in the app:
 *
 *  - `footnote` / `citation` — inline atom nodes in the editor; 1:1 with
 *    a panel card; bidirectional jump.
 *  - `anchor` — paragraph-anchored (Mode A) or text-range-anchored
 *    (Mode B); always has a margin-gutter icon; many anchor links can
 *    point at the same card.
 *
 * Mode is derived, not declared: an `anchor` link is Mode B iff
 * `anchor.textRange` is populated. Mode A has only `paragraphIds` + a
 * margin icon.
 *
 * The `id` on `Link` is stable and independent of both endpoints, so
 * the link is addressable without describing the DOM marker or the card.
 */

import type { CardKind } from "@/panels/_shared/types";

export type LinkKind = "footnote" | "citation" | "anchor";

export type LinkAnchor =
  | {
      type: "inline-atom";
      /** Node name of the inline atom (footnote | citation). */
      nodeName: "footnote" | "citation";
      /** ProseMirror doc position, or null when unanchored. */
      pos: number | null;
    }
  | {
      type: "anchor";
      /** Paragraph UUID(s) the link is anchored to. Always present — a
       *  Mode B link also lives inside one paragraph (the containing one).
       *  Multi-anchor is allowed for Mode A. */
      paragraphIds: string[];
      /** Every `anchor` link carries a margin-gutter entry. */
      margin: { side: "left" | "right" };
      /** Present iff Mode B. Pin-points a specific text range via the
       *  `linkedAnchor` mark. */
      textRange?: {
        /** The mark's anchor id (same value lives on the mark's attrs). */
        anchorId: string;
        /** Snapshot of the linked text; used for re-anchoring if the
         *  mark is lost across a parse. */
        textSnapshot: string;
      };
    };

export type LinkTarget = {
  type: "card";
  ref: { kind: CardKind; id: string };
};

export interface Link {
  /** Stable UUID — addressable independently of either endpoint. */
  id: string;
  kind: LinkKind;
  anchor: LinkAnchor;
  target: LinkTarget;
  createdAt: string;
}

/** A Mode B anchor link (has a textRange). Not a separate runtime kind —
 *  just a type-level refinement. */
export type ModeBAnchorLink = Link & {
  kind: "anchor";
  anchor: Extract<LinkAnchor, { type: "anchor" }> & {
    textRange: NonNullable<Extract<LinkAnchor, { type: "anchor" }>["textRange"]>;
  };
};

export function isAnchorLink(link: Link): link is Link & { anchor: Extract<LinkAnchor, { type: "anchor" }> } {
  return link.anchor.type === "anchor";
}

export function isModeB(link: Link): link is ModeBAnchorLink {
  return link.anchor.type === "anchor" && !!link.anchor.textRange;
}

/** Result of looking up a link's current position in the live editor. */
export type LinkResolution =
  | { kind: "inline-atom"; pos: number; nodeSize: number; domEl: HTMLElement | null }
  | { kind: "text-range"; from: number; to: number; domEl: HTMLElement | null }
  | { kind: "paragraph"; paragraphId: string; pos: number; domEl: HTMLElement | null };
