/**
 * WHICH presence of a multiply-rendered card the user is looking at — stated
 * once (task 1536).
 *
 * A card can be drawn in several places at once: its docked panel list, the
 * omni margin, and — when popped — a float window portalled to
 * `document.body` (a popped card's docked render "stays fully live",
 * `usePoppedCards`). Every presence stamps the SAME `data-card-key`, so a
 * `querySelectorAll` hands them back in DOM ORDER — an accident of where
 * `FloatingPanel` portals (body, i.e. AFTER the app root). Taking "the first
 * visible match" therefore picked the docked twin whenever the kind's panel
 * was open, even when the card had just been floated at the text.
 *
 * The ladder:
 *  1. **this card's own float, visible** — a candidate inside the float window
 *     whose `data-float-presence` names this card's key (stamped by
 *     `FloatingPanel` when it floats a `cardKey`). A float exists only because
 *     the card was popped, and it sits where the user is looking.
 *  2. **visible** — the first visible match (`isPaneElementVisible`, the ONE
 *     keep-alive visible rung): skips a `display:none` keep-alive twin or a
 *     compressed copy. A visible docked copy beats a HIDDEN pane's float.
 *  3. the card's own float, unmeasured (jsdom lays nothing out), then the
 *     first match at all.
 */
import { isPaneElementVisible } from "@/lib/keep-alive/pane-visibility";

/** Stamped on a FLOATING `FloatingPanel` root with the key of the card (or
 *  text object) it floats. Absent on docked shells and on non-card floats. */
export const FLOAT_PRESENCE_ATTR = "data-float-presence";

/** Is `el` inside the float window that floats `key`? */
export function isFloatPresenceOf(el: HTMLElement, key: string): boolean {
  const win = el.closest<HTMLElement>(`[${FLOAT_PRESENCE_ATTR}]`);
  return win !== null && win.getAttribute(FLOAT_PRESENCE_ATTR) === key;
}

export interface CardPresence {
  el: HTMLElement;
  /** True when `el` is the card's own float (rung 1). */
  isFloat: boolean;
}

/** Resolve the presence the user is looking at among `candidates` — every
 *  element stamped with `key`'s `data-card-key`. See the module ladder. */
export function pickCardPresence(
  candidates: readonly HTMLElement[],
  key: string,
): CardPresence | null {
  const floats = candidates.filter((el) => isFloatPresenceOf(el, key));
  const visibleFloat = floats.find(isPaneElementVisible);
  if (visibleFloat) return { el: visibleFloat, isFloat: true };
  const visible = candidates.find(isPaneElementVisible);
  if (visible) return { el: visible, isFloat: false };
  if (floats[0]) return { el: floats[0], isFloat: true };
  return candidates[0] ? { el: candidates[0], isFloat: false } : null;
}
