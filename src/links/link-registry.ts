/**
 * Single source of truth for the Link taxonomy.
 *
 * Mirrors `src/panels/panel-registry.ts`. Every link kind declares how it
 * binds to the document, how it renders, how many can point at the same
 * target card, and — for the fan-out `anchor` kind — how to resolve the
 * target card's panel/theme at runtime.
 *
 * DOM contract (uniform across all kinds, no exceptions):
 *   data-link-id   = "<linkId>"
 *   data-link-kind = "footnote" | "citation" | "anchor"
 *   data-link-card = "<cardKind>:<cardId>"
 *
 * Parsers (Claude Cowork especially) may assume exactly those three
 * attributes for every cross-document reference.
 */

import type { CardKind } from "@/panels/_shared/types";
import { getPanelByCardKind } from "@/panels/panel-registry";
import type { Link, LinkKind } from "./_shared/types";

export interface LinkRegistryEntry {
  kind: LinkKind;
  label: string;
  /** Per-kind folder path, relative to repo root. Used by Cowork to
   *  navigate directly to a kind's implementation. */
  folder: string;
  /** Structural shape of the anchor — drives resolver dispatch. */
  anchorType: "inline-atom" | "anchor";
  /** In-editor marker style. */
  marker: "atom-node" | "gutter-icon";
  /** Visible SVG connector between marker and card. */
  connector: "always" | "on-select" | "none";
  /** Multiplicity — how many Links may point at the same target card.
   *  Enforced at runtime in `createLink` (see `enforceMultiplicity`). */
  multiplicity: "one" | "many";
  /** Whether both directions (marker → card, card → marker) are supported. */
  bidirectional: boolean;
  /** Fixed card kind for 1:1 kinds (footnote → footnote, citation → citation).
   *  Fan-out kinds (anchor) read the target's cardKind directly. */
  cardKind: CardKind | "__from_target__";
  /** Coupled-highlight behavior. `marker-and-textrange` means hovering
   *  either the margin icon or the Mode B text range lights up both. */
  highlight: "marker-only" | "marker-and-textrange";
}

export const LINK_REGISTRY: Record<LinkKind, LinkRegistryEntry> = {
  footnote: {
    kind: "footnote",
    label: "Footnote",
    folder: "src/links/Footnote",
    anchorType: "inline-atom",
    marker: "atom-node",
    connector: "on-select",
    multiplicity: "one",
    bidirectional: true,
    cardKind: "footnote",
    highlight: "marker-only",
  },
  citation: {
    kind: "citation",
    label: "Citation",
    folder: "src/links/Citation",
    anchorType: "inline-atom",
    marker: "atom-node",
    connector: "on-select",
    multiplicity: "one",
    bidirectional: true,
    cardKind: "citation",
    highlight: "marker-only",
  },
  anchor: {
    kind: "anchor",
    label: "Anchor",
    folder: "src/links/Anchor",
    anchorType: "anchor",
    marker: "gutter-icon",
    connector: "none",
    multiplicity: "many",
    bidirectional: true,
    cardKind: "__from_target__",
    highlight: "marker-and-textrange",
  },
};

// ---------------------------------------------------------------------------
// DOM attribute names
// ---------------------------------------------------------------------------

/** On the in-editor marker. */
export const DATA_LINK_ID = "data-link-id";
/** On the in-editor marker. */
export const DATA_LINK_KIND = "data-link-kind";
/** On the in-editor marker AND on the panel card's outer element. */
export const DATA_LINK_CARD = "data-link-card";
/** On panel cards with multiple incoming links. Space-separated link ids. */
export const DATA_LINK_IDS = "data-link-ids";

/** `${cardKind}:${cardId}` — the canonical value for `data-link-card`.
 *  Matches the format used by `popKey()` in `panel-registry.ts`. */
export function linkCardKey(kind: CardKind, id: string): string {
  return `${kind}:${id}`;
}

/** Inverse of `linkCardKey`. Returns null if the string isn't well-formed. */
export function parseLinkCardKey(
  key: string,
): { kind: CardKind; id: string } | null {
  const idx = key.indexOf(":");
  if (idx <= 0) return null;
  const kind = key.slice(0, idx) as CardKind;
  const id = key.slice(idx + 1);
  if (!id) return null;
  return { kind, id };
}

// ---------------------------------------------------------------------------
// Resolved-theme helper
// ---------------------------------------------------------------------------

/** Resolve the card kind for a link. For 1:1 kinds this is fixed in the
 *  registry; for the fan-out `anchor` kind we read from the target. */
export function resolveCardKind(link: Link): CardKind {
  const entry = LINK_REGISTRY[link.kind];
  if (entry.cardKind === "__from_target__") return link.target.ref.kind;
  return entry.cardKind;
}

/** Look up the panel that owns the card this link points at. */
export function resolveLinkPanel(link: Link) {
  return getPanelByCardKind(resolveCardKind(link));
}

// ---------------------------------------------------------------------------
// Multiplicity enforcement
// ---------------------------------------------------------------------------

export class LinkMultiplicityError extends Error {
  constructor(
    public readonly kind: LinkKind,
    public readonly targetCardId: string,
    public readonly existingLinkId: string,
  ) {
    super(
      `Link kind "${kind}" has multiplicity "one"; target card ${targetCardId} ` +
        `is already linked by ${existingLinkId}.`,
    );
    this.name = "LinkMultiplicityError";
  }
}

/** Throws if `LINK_REGISTRY[kind].multiplicity === "one"` and `existing`
 *  already contains a link with the same target card id. Called from
 *  `createLink` — not yet wired to any callsite in Phase 0. */
export function enforceMultiplicity(
  kind: LinkKind,
  targetCardId: string,
  existing: Iterable<Link>,
): void {
  if (LINK_REGISTRY[kind].multiplicity !== "one") return;
  for (const link of existing) {
    if (link.kind === kind && link.target.ref.id === targetCardId) {
      throw new LinkMultiplicityError(kind, targetCardId, link.id);
    }
  }
}
