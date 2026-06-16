/**
 * Shared drop-button gesture — the one mousedown→drop-mode helper behind
 * EVERY "grab a card's drop button to (re)anchor it" surface:
 *
 *   - the docked card header (`CardDropButton`, chip B/C),
 *   - the float chrome button (chip D's `FloatChrome`),
 *   - the gutter pin (chip H).
 *
 * It mirrors the two existing float-less producers that already drive a
 * drop session with `inPlace + externalCommit + their own mouseup`:
 *   - the in-text inline-atom grab (`@/lib/tiptap/inline-atom-grab`),
 *   - the lifted-overlay grab handle (`@/text-objects/TextObjectGrabHandle`).
 *
 * Contract (one call per mousedown):
 *   1. `beginDropSession({ cardKey, origin, inPlace: true, externalCommit: true })`.
 *      - `inPlace` skips `markSourceFloat` (a docked card has no popout to dim;
 *        a float dims itself via FloatChrome, not this helper).
 *      - `externalCommit` skips the controller's own mouseup so THIS helper
 *        owns commit-vs-cancel — matching the atom-grab / lifted-overlay path.
 *   2. Install a ONE-SHOT `window` mouseup that calls `commitDropSession()`
 *      and self-removes. Esc / leaving the window still cancel through the
 *      controller's own keydown/mouseleave listeners; `commitDropSession`
 *      no-ops cleanly if the session was already cancelled.
 *
 * The button itself owns the press-swallow (stopPropagation + preventDefault +
 * `draggable=false` + dragstart swallow) so the header drag-lift and the
 * card-root HTML5 anchor drag can't co-fire — see `CardDropButton`. This helper
 * assumes that guard is already in place and only manages the SESSION.
 *
 * Runtime LEAF beyond the controller: no card imports, no React. Safe for the
 * domain-neutral FloatChrome and the gutter pin to call.
 */

import { beginDropSession, commitDropSession } from "./controller";

export interface CardDropGestureOpts {
  /** The canonical `float:card:<kind>:<id>` key of the card being (re)anchored.
   *  `beginDropSession` looks the spec up from this. */
  cardKey: string;
  /** Viewport coords of the mousedown — the session origin (ESC / leave math). */
  origin: { x: number; y: number };
}

/**
 * Start a card drop session from a button mousedown and arm the one-shot
 * commit-on-mouseup. Returns true if a session started (a spec exists, no
 * other session active, a DropCtx is registered), false otherwise — callers
 * may use the result to skip arming a press-suppressor, but the listener is
 * only installed when a session actually started, so a false return leaves no
 * dangling listener.
 */
export function beginCardDropGesture(opts: CardDropGestureOpts): boolean {
  const started = beginDropSession({
    cardKey: opts.cardKey,
    origin: opts.origin,
    inPlace: true,
    externalCommit: true,
  });
  if (!started) return false;

  if (typeof window !== "undefined") {
    const onUp = () => {
      window.removeEventListener("mouseup", onUp);
      // Owns the commit (session started with `externalCommit`). Safe if Esc /
      // window-leave already cancelled — `commitDropSession` no-ops without a
      // live session.
      void commitDropSession();
    };
    window.addEventListener("mouseup", onUp);
  }
  return true;
}
