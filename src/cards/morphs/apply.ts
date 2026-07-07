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
  const out = convert(card) as T;
  // Preserve the shared record "envelope" in ONE place. Each of the 8 converter
  // literals in `index.ts` hand-enumerates the fields it carries, so any
  // record-level field the target shape CAN hold but the literal forgets is
  // silently dropped. `archived?: boolean` is the one such field none of the
  // converters touch — every morphable card interface carries it — so an
  // archived card would morph back with `archived` undefined (≡ active),
  // silently un-archiving (task 072). Carry it over here, at the single morph
  // chokepoint, so no converter (present or future) can drop it. Targeted merge
  // — NOT a blanket `...card` spread, which would leak stale wrong-shape fields
  // the converters deliberately drop.
  const archived = (card as { archived?: boolean } | null | undefined)?.archived;
  return archived ? ({ ...(out as object), archived } as T) : out;
}
