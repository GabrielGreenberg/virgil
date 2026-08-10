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
 * exception. Two rules keep the contract single-sourced, both pinned by
 * [`link-surface-honesty.test.ts`](./__tests__/link-surface-honesty.test.ts):
 *
 *  1. Every marker PRODUCER emits the attribute NAMES from the constants below
 *     (`linked-anchor-attrs.ts`, `footnote.ts`, `citation.ts`, and the drop-mode
 *     ghost's clone list, which must mirror them). A CSS selector — and a JSX
 *     attribute, which has no computed-name syntax — may write the name inline;
 *     `globals.css` has no other choice at all.
 *  2. NOTHING spells a `<cardKind>:<cardId>` token by hand, whether it is
 *     emitting one or querying for one. `linkCardKey` builds it and
 *     `parseLinkCardKey` reads it. A query that restates the grammar is the
 *     dangerous copy: change the grammar and it stops MATCHING, silently, with
 *     no type error to catch it.
 */

import type { CardKind } from "@/panels/_shared/types";

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
