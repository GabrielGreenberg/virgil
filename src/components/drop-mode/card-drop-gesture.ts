/**
 * Shared drop-button gesture — the one mousedown→drop-mode helper behind
 * EVERY "grab a card's drop button to (re)anchor it" surface:
 *
 *   - the docked card header (`CardDropButton`, chip B/C),
 *   - the float chrome button (chip D's `FloatChrome`),
 *   - the margin pin (chip H).
 *
 * It mirrors the two existing float-less producers that already drive a
 * drop session with `inPlace + externalCommit + their own mouseup`:
 *   - the in-text inline-atom grab (`@/lib/tiptap/inline-atom-grab`),
 *   - the lifted-overlay grab handle (`@/text-objects/TextObjectGrabHandle`).
 *
 * Contract (one call per mousedown):
 *   0. The press only PENDS (`pendDropSession`, task 1192): nothing below
 *      happens until the pointer travels past `DROP_DRAG_THRESHOLD_PX`, so a
 *      plain click has no drop-mode side effects at all and its own `click`
 *      reaches the pressed element (the margin marker's select). On that
 *      promote edge:
 *   1. `beginDropSession({ cardKey, origin, inPlace: true, externalCommit: true })`.
 *      - `inPlace` skips `markSourceFloat` (a docked card has no popout to dim;
 *        a float dims itself via FloatChrome, not this helper).
 *      - `externalCommit` skips the controller's own mouseup so THIS helper
 *        owns commit-vs-cancel — matching the atom-grab / lifted-overlay path.
 *   2. Arm the controller's one-shot commit-on-release (`armReleaseCommit`).
 *      Its lifetime is the SESSION's (task 772): Escape, the missed-release
 *      failsafe and a teardown all disarm it, so a stale release can never
 *      commit a later gesture's session.
 *   3. The caller's `onPromote` (the marker arms its trailing-click guard).
 *
 * The button itself owns the press-swallow (stopPropagation + preventDefault +
 * `draggable=false` + dragstart swallow) so the header drag-lift and the
 * card-root HTML5 anchor drag can't co-fire — see `CardDropButton`. This helper
 * assumes that guard is already in place and only manages the SESSION.
 *
 * Runtime LEAF beyond the controller: no card imports, no React. Safe for the
 * domain-neutral FloatChrome and the margin pin to call.
 */

import { armReleaseCommit } from "./controller";
import { pendDropSession } from "./pending-session";

export interface CardDropGestureOpts {
  /** The canonical `float:card:<kind>:<id>` key of the card being (re)anchored.
   *  `beginDropSession` looks the spec up from this. */
  cardKey: string;
  /** Viewport coords of the mousedown — the session origin (ESC / leave math). */
  origin: { x: number; y: number };
  /** Runs when the press became a drag AND the session began. */
  onPromote?: () => void;
}

/**
 * Pend a card drop session from a button mousedown; on the drag threshold it
 * begins the session and arms the one-shot commit-on-mouseup. Returns the
 * pending record's disposer (a no-op once it promoted or ended).
 */
export function beginCardDropGesture(opts: CardDropGestureOpts): () => void {
  return pendDropSession({
    cardKey: opts.cardKey,
    origin: opts.origin,
    inPlace: true,
    externalCommit: true,
    onPromote: () => {
      armReleaseCommit();
      opts.onPromote?.();
    },
  });
}
