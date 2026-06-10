/**
 * `applyCardMorph` — the per-doc hooks' one-line entry into the registered
 * morph transforms (A9 §D). Given the card's CURRENT spine kind and the card
 * record, it returns the morphed record (flipped data kind + salvaged fields).
 * Returns the card unchanged if the kind has no registered converter (a no-op
 * guard — should never happen for a morphing kind once `cards/morphs` is
 * imported, which `assertMorphCoverage` enforces).
 *
 * The hook resolves the FROM spine kind itself (it knows its own pair), then
 * maps the card by id inside its `update`:
 *
 *     update((prev) => ({ ...prev, cards: prev.cards.map((c) =>
 *       c.id === id ? applyCardMorph("cutter-comment", c) : c) }));
 */
import { getCardMorphConverter } from "../card-registry";
import type { CardKind } from "../types";

export function applyCardMorph<T>(fromKind: CardKind, card: T): T {
  const convert = getCardMorphConverter(fromKind);
  if (!convert) return card;
  return convert(card) as T;
}
