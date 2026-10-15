/**
 * "Which Links locate card `ref` in the editor?" — ONE answer (task 1133).
 *
 * Two hooks ask it: the anchor-highlight reconciler (hover / selection wash)
 * and placement (align the document to a selected card). Each used to carry
 * its own private copy of the inline-atom synthesis and its own hand-spelled
 * `footnote || citation` branch — and they had already drifted: the reconciler
 * learned the applied-change rung below, placement never did, so selecting an
 * APPLIED suggestion card aligned the document to a stale link `resolveLink`
 * could only degrade to the whole paragraph, while the wash painted the
 * AI-written span. Both now call {@link linksForCardRef}, so what the wash
 * paints and what placement scrolls to cannot disagree.
 */

import {
  CARD_ATOM_REGISTRY,
  type CardAtomKind,
  type CardAtomNodeName,
} from "@/lib/tiptap/atom-registry";
import { isInlineAtomCardKind } from "@/cards/predicates";
import type { EntityCollectionSlots } from "@/cards/entity-collections";
import type { AnchoredCardRef } from "./anchored-card-store";
import { findEntity } from "./entity-hover";
import type { Link } from "./types";

/** Synthesized Link for an inline-atom card (footnote / citation) — those
 *  aren't kept in collections, so we fabricate one for `resolveLink` to
 *  follow. The node name is read off the atom registry's row. */
export function linkForInlineAtom(kind: CardAtomKind, id: string): Link {
  const nodeName = CARD_ATOM_REGISTRY[kind].nodeName as CardAtomNodeName;
  return {
    id,
    kind,
    anchor: { type: "inline-atom", nodeName, pos: null },
    target: { type: "card", ref: { kind, id } },
    createdAt: "",
  };
}

/** Narrow view of a suggestion card for the applied-change synthesis.
 *  `findEntity` returns the widened `{id,kind?,links?}` shape, but a suggestion
 *  entity IS the full card at runtime, so we read `status` / `appliedChange`
 *  through this cast. */
type AppliedSuggestionEntity = {
  kind?: string;
  status?: string;
  appliedChange?: {
    anchorId: string;
    anchorUuid: string;
    replacement: string;
    originalText: string;
  };
};

/** Synthesized Mode-B link for an APPLIED pending-AI-change. Its persisted card
 *  links still point at the ORIGINAL span, whose text the splice replaced — so
 *  `resolveLink` can't find that mark and degrades to a whole-paragraph vertical
 *  bar. The live blue `linkedAnchor` mark is under `appliedChange.anchorId`
 *  instead; this link points the resolver at it, so the wash paints (and
 *  placement aligns to) the AI-written span, never the paragraph rail. Returns
 *  null unless `ref` is an applied suggestion — pending/stale/kept cards fall
 *  back to their persisted links, and a lost mark degrades to the paragraph as
 *  before. */
export function appliedChangeLink(
  ref: AnchoredCardRef,
  entity: { id: string; kind?: string; links?: Link[] },
): Link | null {
  if (ref.kind !== "revision-suggestion" && ref.kind !== "cutter-suggestion") {
    return null;
  }
  const sugg = entity as AppliedSuggestionEntity;
  if (
    sugg.kind !== "suggestion" ||
    sugg.status !== "applied" ||
    !sugg.appliedChange
  ) {
    return null;
  }
  const ac = sugg.appliedChange;
  return {
    id: ac.anchorId,
    kind: "anchor",
    anchor: {
      type: "textObject",
      targetKind: "linkedRange",
      textObjectIds: [ac.anchorUuid],
      textRange: {
        anchorId: ac.anchorId,
        textSnapshot: ac.replacement || ac.originalText,
      },
    },
    target: { type: "card", ref: { kind: ref.kind, id: ref.id } },
    createdAt: "",
  };
}

/** Every Link that locates `ref` in the editor: a synthesized inline-atom link
 *  for a Card-bearing atom kind; the applied-change link for an applied
 *  suggestion; otherwise the card's own persisted links. */
export function linksForCardRef(
  ref: AnchoredCardRef,
  collections: EntityCollectionSlots,
): Link[] {
  if (isInlineAtomCardKind(ref.kind)) {
    return [linkForInlineAtom(ref.kind, ref.id)];
  }
  const entity = findEntity(ref, collections);
  if (!entity) return [];
  const applied = appliedChangeLink(ref, entity);
  if (applied) return [applied];
  // (No open-AI-request branch. A second synthesis used to sit here, pointing
  // at the `pending-ai-request` MARK's anchorId so hovering a request card lit
  // the wash — and SUPPRESSING the card's real links to do it. Task 667 made
  // the wash a decoration, so there is no mark to point at and no reason to
  // suppress: a request card now lights exactly the way its own anchor does,
  // like every other card.)
  return entity.links ? [...entity.links] : [];
}
