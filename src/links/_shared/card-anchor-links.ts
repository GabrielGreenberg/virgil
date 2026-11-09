/**
 * "Which card does `ref` locate in the editor?" — ONE answer (task 1133).
 *
 * Two hooks ask it: the anchor-highlight reconciler (hover / selection wash)
 * and placement (align the document to a selected card). Each used to carry
 * its own private copy of the inline-atom synthesis and its own hand-spelled
 * `footnote || citation` branch — and they had already drifted: the reconciler
 * learned the applied-change rung below, placement never did. Both now call
 * {@link anchorCardOfRef}, so what the wash paints and what placement scrolls
 * to cannot disagree.
 *
 * It answers a CARD, not a link list (task 1505): both hooks hand that card to
 * the anchor authority (`buildCardAnchorPass` — `paintRows` / `jumpTarget`),
 * which is what draws the margin markers. They used to walk the links through
 * `resolveLink`'s own per-link ladder — stored pids (a Mode-B link's BIRTH
 * record), no dormant rung, a loose snapshot re-find — so hover lit, and
 * selection scrolled to, paragraphs that carried no marker.
 */

import {
  CARD_ATOM_REGISTRY,
  type CardAtomKind,
  type CardAtomNodeName,
} from "@/lib/tiptap/atom-registry";
import { isInlineAtomCardKind, isSuggestionKind } from "@/cards/predicates";
import { isAppliedPendingSuggestion } from "@/cards/suggestion-status";
import type { EntityCollectionSlots } from "@/cards/entity-collections";
import type { AnchoredCardRef } from "./anchored-card-store";
import { findEntity } from "./entity-hover";
import type { Link } from "./types";
import type { CardWithLinks } from "../links";

/** Synthesized Link for an inline-atom card (footnote / citation) — those
 *  aren't kept in collections, so we fabricate one (inline atoms are the
 *  one address the anchor authority does not resolve — `resolveInlineAtomLink`
 *  does). The node name is read off the atom registry's row. */
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
 *  the authority can't find that mark and degrades to a whole-paragraph vertical
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
  if (!isSuggestionKind(ref.kind)) return null;
  const sugg = entity as AppliedSuggestionEntity;
  if (!isAppliedPendingSuggestion(sugg)) return null;
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

/** The card that locates `ref` in the editor, as the anchor authority reads
 *  it: a Card-bearing atom kind → a card carrying its synthesized inline-atom
 *  link; an applied suggestion → a card carrying ONLY its applied-change link;
 *  otherwise the entity itself (its own persisted links). `null` when the
 *  entity is gone. */
export function anchorCardOfRef(
  ref: AnchoredCardRef,
  collections: EntityCollectionSlots,
): CardWithLinks | null {
  if (isInlineAtomCardKind(ref.kind)) {
    return { id: ref.id, links: [linkForInlineAtom(ref.kind, ref.id)] };
  }
  const entity = findEntity(ref, collections);
  if (!entity) return null;
  const applied = appliedChangeLink(ref, entity);
  if (applied) return { id: ref.id, links: [applied] };
  // (No open-AI-request branch. A second synthesis used to sit here, pointing
  // at the `pending-ai-request` MARK's anchorId so hovering a request card lit
  // the wash — and SUPPRESSING the card's real links to do it. Task 667 made
  // the wash a decoration, so there is no mark to point at and no reason to
  // suppress: a request card now lights exactly the way its own anchor does,
  // like every other card.)
  return entity;
}
