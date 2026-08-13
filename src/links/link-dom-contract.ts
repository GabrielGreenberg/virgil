/**
 * The Link DOM contract — the attribute names every in-editor link marker
 * carries, and the `<cardKind>:<cardId>` grammar one of them holds.
 *
 * This module is deliberately NOT a registry. The link taxonomy (what the
 * three kinds are and how each binds to the document) is declared once, on
 * the `LinkKind` union in [`./_shared/types.ts`](./_shared/types.ts); the
 * per-kind behaviour is decided by the code that ships it. A parallel
 * per-kind table here would be a second description of the same facts with
 * no reader to keep it true — which is exactly what it became (task 202).
 *
 * DOM contract, as it ships:
 *
 *   data-link-id   = "<linkId>"       — on every marker, always
 *   data-link-kind = "footnote" | "citation" | "anchor"  — on every marker, always
 *   data-link-card = "<cardKind>:<cardId>" — on every marker EXCEPT a
 *     transient `linkedAnchor` range handle (a plain selection grab that no
 *     card has claimed yet): it carries no card, so it emits no attribute,
 *     and `.linked-anchor:not([data-link-card])` in globals.css is what
 *     paints it. See `linkedAnchorRenderAttrs`.
 *
 * `data-link-card` is also carried by the panel CARD's outer element — that
 * pairing is what makes the token an address both ends can be found by
 * (`panel-selection.ts`, `open-for-card.ts`, `useTextHoverBridge`).
 *
 * Parsers (Claude Cowork especially) may assume those attributes with that one
 * exception. Three rules keep the contract single-sourced, all pinned by
 * [`link-surface-honesty.test.ts`](./__tests__/link-surface-honesty.test.ts):
 *
 *  1. NOTHING in TypeScript spells a `data-link-*` attribute NAME as a literal
 *     — emitting, querying or reading. The constants below are the spelling.
 *     Two boundaries cannot participate and are stated rather than pretended
 *     away: `globals.css` (a stylesheet imports nothing) and a JSX attribute
 *     (there is no computed-name syntax, so `ExampleCard` / `CitationCard`
 *     write `data-link-card={linkCardKey(…)}` — name inline, VALUE through the
 *     builder).
 *  2. NOTHING spells a `<cardKind>:<cardId>` token by hand, whether it is
 *     emitting one or querying for one. `linkCardKey` builds it and
 *     `parseLinkCardKey` reads it. A query that restates the grammar is the
 *     dangerous copy: change the grammar and it stops MATCHING, silently, with
 *     no type error to catch it.
 *  3. A SELECTOR is part of the contract, not a caller's private string. The
 *     builders below compose a name with a value; nothing else does.
 *
 * Rule 3 is the one this module lacked, and its absence is why rule 1 used to
 * stop at producers (task 202 → task 204). A reader had no third rung to stand
 * on, so its only alternative to the literal was `` `[${DATA_LINK_CARD}="${k}"]` ``
 * — which genuinely reads worse than what it replaced, and a guard that makes
 * the correct form the ugly one loses. **The missing rung made the wrong answer
 * the better-reading one.** The sibling grammar had all three all along:
 * `data-card-key` has `cardPopKey` (build), `parseAnyKey` (read) AND
 * `cardDomSelector` (address), the last pinned byte-exact by
 * `card-key-seams-contract.test.ts`. This is that shape, for this grammar.
 *
 * Where there is no value to interleave — a PRESENCE test like
 * `` `.linked-anchor[${DATA_LINK_ID}]` `` — interpolate the constant directly.
 * That form reads fine, so it earns no builder and gets none.
 */

import type { CardKind } from "@/panels/_shared/types";
import type { LinkKind } from "./_shared/types";

// ---------------------------------------------------------------------------
// DOM attribute names
// ---------------------------------------------------------------------------

/** On the in-editor marker. */
export const DATA_LINK_ID = "data-link-id";
/** On the in-editor marker. */
export const DATA_LINK_KIND = "data-link-kind";
/** On the in-editor marker AND on the panel card's outer element. */
export const DATA_LINK_CARD = "data-link-card";

/** `${cardKind}:${cardId}` — the canonical value for `data-link-card`. This is
 *  a SEPARATE grammar from the popout `data-card-key` (`cardPopKey` →
 *  `float:card:<kind>:<id>`): the link-atom layer keeps the flat `<kind>:<id>`
 *  shape and is intentionally NOT migrated to the `float:` grammar. Do not
 *  conflate the two. */
export function linkCardKey(kind: CardKind, id: string): string {
  return linkCardKeyFromToken(kind, id);
}

/** The separator, declared ONCE. Deliberately module-private: an exported
 *  separator is an invitation to re-derive the grammar from its pieces, which
 *  is the fork rule 2 exists to close. Its three readers are the builder, the
 *  parser, and the id-suffix selector — all below. */
const LINK_CARD_SEP = ":";

/** The same grammar built from a raw TOKEN rather than a spine `CardKind`.
 *  Two live shapes need it and neither is a `CardKind`: the legacy mark-kind
 *  namespace the anchor write path resolves through
 *  (`legacyKindToCardKindString` → `revision-comment`, the `cut` alias), and the
 *  kindful-but-idless `"<token>:"` a reload restore stamps when it knows the
 *  kind and not the card. Same one builder — the separator is declared once. */
export function linkCardKeyFromToken(token: string, id: string): string {
  return `${token}${LINK_CARD_SEP}${id}`;
}

/** Inverse of `linkCardKey`. Returns null if the string isn't well-formed. */
export function parseLinkCardKey(
  key: string,
): { kind: CardKind; id: string } | null {
  const idx = key.indexOf(LINK_CARD_SEP);
  if (idx <= 0) return null;
  const kind = key.slice(0, idx) as CardKind;
  const id = key.slice(idx + LINK_CARD_SEP.length);
  if (!id) return null;
  return { kind, id };
}

// ---------------------------------------------------------------------------
// Selectors — rule 3
// ---------------------------------------------------------------------------
//
// Each of these composes a contract NAME with a contract VALUE, which is the
// only form either is ever used in at a query site — and the only place both of
// this module's silent failure modes meet. A renamed attribute and a changed
// grammar each make a query stop MATCHING rather than stop compiling, so a
// hand-spelled selector fails in the one way nothing catches.

/** `[data-link-id="<linkId>"]` — the in-editor marker(s) addressed by a link id.
 *  Callers that want the Mode-B range span specifically prefix the class
 *  themselves (`` `.linked-anchor${linkIdSelector(id)}` ``): `.linked-anchor` is
 *  a stylesheet class, not part of this contract. */
export function linkIdSelector(linkId: string): string {
  return `[${DATA_LINK_ID}="${linkId}"]`;
}

/** `[data-link-kind="<kind>"]` — every marker of one link kind. */
export function linkKindSelector(kind: LinkKind): string {
  return `[${DATA_LINK_KIND}="${kind}"]`;
}

/** `[data-link-card="<cardKind>:<cardId>"]` — the exact address, which matches
 *  BOTH the in-editor marker and the panel card's outer element. That pairing
 *  is the point: it is what lets `panel-selection.ts` / `open-for-card.ts` /
 *  `CitationsPanel` find either end from one id.
 *
 *  Deliberately takes `(kind, id)` and not a pre-built token. A
 *  `linkCardKeySelector(key)` twin, for the callers that resolved their token
 *  through `linkCardKeyFromToken`, was written and then retired the same day:
 *  every legacy-token site BUILDS a `linkCard` mark attr, none QUERIES, so it
 *  would have shipped with no caller — the dead-export shape this directory's
 *  own census exists to fail. Add it back WITH its first real query site. */
export function linkCardSelector(kind: CardKind, id: string): string {
  return `[${DATA_LINK_CARD}="${linkCardKey(kind, id)}"]`;
}

/** `[data-link-card$=":<cardId>"]` — kind-AGNOSTIC: any card address ending in
 *  this id. The suffix form restates the separator as well as the name, so it
 *  is a second speller of the grammar in the exact way rule 2 forbids, which is
 *  why it lives here rather than at its one call site (`useInTextPositions`'s
 *  default entry selector, which must match whatever kind the panel rendered). */
export function linkCardIdSelector(cardId: string): string {
  return `[${DATA_LINK_CARD}$="${LINK_CARD_SEP}${cardId}"]`;
}
