/**
 * Shared types for the Link architecture.
 *
 * A `Link` is a connection between an in-editor anchor and a side-panel
 * card. Three kinds cover every cross-reference in the app:
 *
 *  - `footnote` / `citation` — inline atom nodes in the editor; 1:1 with
 *    a panel card; bidirectional jump.
 *  - `anchor` — anchored to a TextObject (any kind: paragraph, heading,
 *    listItem, exampleItem, atom block, linkedRange, …); always has a
 *    margin icon; many anchor links can point at the same card.
 *
 * Mode is derived, not declared: an `anchor` link is Mode B iff
 * `anchor.targetKind === "linkedRange"` (the TextObject kind is a
 * mark-backed range). Persistent-node kinds are Mode A. The legacy
 * `textRange` payload is still carried on Mode B links — its presence
 * is implied by `targetKind === "linkedRange"`, but kept as a distinct
 * field so Phase E (multi-paragraph linkedAnchor LaTeX round-trip) can
 * persist the snapshot + anchorId without a separate sidecar shape.
 *
 * Naming asymmetry to note: `LinkKind`'s `"anchor"` value (Link.kind)
 * stays unchanged — it's about "what kind of link is this" (footnote /
 * citation / anchor). The new `LinkAnchor` discriminator value is
 * `"textObject"` — it describes the anchor target's shape. The two are
 * deliberately distinct concepts; renaming `LinkKind.anchor` is a
 * future cleanup of its own.
 *
 * The `id` on `Link` is stable and independent of both endpoints, so
 * the link is addressable without describing the DOM marker or the card.
 */

import type { CardKind } from "@/panels/_shared/types";
import type { TextObjectKind } from "@/text-objects/types";

/** The link taxonomy, declared ONCE. Each kind's behaviour is decided by the
 *  code that ships it (the atom node specs, `createLinkedAnchor`, the
 *  highlight reconciler) — there is deliberately no parallel per-kind table
 *  restating it. One existed (`LINK_REGISTRY`) and drifted into fiction:
 *  it declared connector strokes for a component that had been deleted and a
 *  multiplicity rule nothing enforced (task 202). The DOM attributes each
 *  kind's marker carries are in `../link-dom-contract.ts`. */
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
      type: "textObject";
      /** The kind of TextObject this link anchors to. Drives marker
       *  placement and behavior. `"linkedRange"` is Mode B (range
       *  backed by a `linkedAnchor` mark); every other value is a
       *  persistent-node kind (Mode A, generalized to all TextObject
       *  kinds — paragraph, heading, listItem, exampleItem, atom
       *  blocks, etc.). */
      targetKind: TextObjectKind;
      /** TextObject UUID(s) the link is anchored to. Always present —
       *  a Mode B link also lives inside the containing TextObject(s).
       *  Multi-anchor (N > 1) is allowed for Mode A. */
      textObjectIds: string[];
      // NOTE (task 205): there is deliberately NO `margin: { side }` here any
      // more. It stored the side a card's margin chrome sits on — frozen at
      // create time from a hardcoded per-kind switch, and therefore blind to
      // where the owning panel is docked *now*, which is the only thing that
      // actually decides the side. Its single consumer (the Mode-A anchor rail)
      // resolves live through `marginSideForCardKind` (`@/lib/margin-side`), the
      // same authority the marginalia grid packs markers against. A stored copy
      // of a live answer is a drift-bomb, and one nothing reads is worse than
      // none at all ("A registry earns its name by being read", AGENTS.md).
      // Legacy sidecars still carrying the key are simply ignored.
      /** Mode-A self-healing snapshot. A plain-text capture of the
       *  anchored paragraph at write time, used by the reload reconciler
       *  to re-find the paragraph (UUID-first, snapshot-fallback) when its
       *  `%!v:` UUID failed to round-trip through the `.tex` and got
       *  re-minted on load. ADDITIVE + optional: legacy Mode-A links lack
       *  it and keep today's UUID-only behavior until re-written /
       *  backfilled. Distinct from `textRange.textSnapshot`, which is the
       *  Mode-B *range* snapshot; this is the *whole-paragraph* snapshot
       *  for a persistent-node (Mode-A) anchor. Symmetric with Mode B's
       *  `reanchorByText` recovery. */
      paragraphSnapshot?: string;
      /** Present iff `targetKind === "linkedRange"`. Carries the
       *  underlying `linkedAnchor` mark's id and a text snapshot used
       *  for re-anchoring if the mark is lost across a parse. */
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

/** A Mode B anchor link (targets a `linkedRange`). Not a separate runtime
 *  kind — just a type-level refinement. */
export type ModeBAnchorLink = Link & {
  kind: "anchor";
  anchor: Extract<LinkAnchor, { type: "textObject" }> & {
    targetKind: "linkedRange";
    textRange: NonNullable<Extract<LinkAnchor, { type: "textObject" }>["textRange"]>;
  };
};

export function isModeB(link: Link): link is ModeBAnchorLink {
  return link.anchor.type === "textObject" && link.anchor.targetKind === "linkedRange";
}

/** Result of looking up a link's current position in the live editor. */
export type LinkResolution =
  | { kind: "inline-atom"; pos: number; nodeSize: number; domEl: HTMLElement | null }
  | { kind: "text-range"; from: number; to: number; domEl: HTMLElement | null }
  | { kind: "paragraph"; paragraphId: string; pos: number; domEl: HTMLElement | null };
