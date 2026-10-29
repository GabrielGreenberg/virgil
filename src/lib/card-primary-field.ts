/**
 * A card NAMES its primary field (task 1358) — the one a freshly-created card
 * should take the caret in (a note's rich body, a todo's title input, a
 * suggestion's first editable textarea, a citation's "Add from library…"
 * input). The card stamps that element (or a wrapper around it, for a body
 * whose contenteditable mounts asynchronously) with `data-card-primary-field`;
 * `focusNewCard` reads the stamp instead of guessing the field from DOM shape
 * per kind. WHICH kinds focus on create is `CARD_REGISTRY[kind].createFocus`.
 */

export const CARD_PRIMARY_FIELD_ATTR = "data-card-primary-field";

/** Spread onto the primary field (or its wrapper). */
export const cardPrimaryFieldProps = { [CARD_PRIMARY_FIELD_ATTR]: "" } as const;

const FOCUSABLE_FIELD =
  '[contenteditable="true"], textarea:not([readonly]), input:not([type]), input[type="text"]';

/** The card's stamped primary field, resolved to the focusable element:
 *  the stamped element itself when it is one, else the first focusable field
 *  inside it. `null` when the card stamps nothing, OR when the stamp exists but
 *  its field has not mounted yet (a RichTextField's editor is async) — the
 *  caller retries. */
export function findCardPrimaryField(card: HTMLElement): HTMLElement | null {
  const stamped = card.querySelector<HTMLElement>(`[${CARD_PRIMARY_FIELD_ATTR}]`);
  if (!stamped) return null;
  if (stamped.matches(FOCUSABLE_FIELD)) return stamped;
  return stamped.querySelector<HTMLElement>(FOCUSABLE_FIELD);
}

/** Does this card stamp a primary field at all (mounted or not)? */
export function cardStampsPrimaryField(card: HTMLElement): boolean {
  return card.querySelector(`[${CARD_PRIMARY_FIELD_ATTR}]`) !== null;
}
