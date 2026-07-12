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
import { carryCardEnvelope } from "../envelope";
import type { CardKind } from "../types";

export function applyCardMorph<T>(fromKind: CardKind, card: T): T {
  const convert = getCardMorphConverter(fromKind);
  if (!convert) return card;
  const out = convert(card) as T;
  // Preserve the shared record "envelope" (currently `archived`) in ONE place.
  // Each of the 8 converter literals in `index.ts` hand-enumerates the fields
  // it carries, so any record-level field the target shape CAN hold but the
  // literal forgets is silently dropped — an archived card would morph back
  // `archived: undefined` (≡ active), silently un-archiving (task 072). The
  // morph chokepoint and the clone literals (useNotes/useRevisions/useCutter/
  // useReports) now share `carryCardEnvelope` as the single envelope SSOT, so
  // no transform (present or future) can drop it.
  return carryCardEnvelope(card as { archived?: boolean } | null | undefined, out);
}
