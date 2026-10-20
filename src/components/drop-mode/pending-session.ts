/**
 * # A press is not a drag until it moves (task 1192)
 *
 * A drop session has GLOBAL side effects the moment it begins: the body's
 * `data-drop-mode-active` attribute (which makes the margin markers, the `+K`
 * overflow pill and the lifted-overlay grab handle click-through — the task-351
 * perf rule, correct DURING a drag), the crosshair cursor, the content
 * `LayoutGestureBus` begin (every geometry follower parks), the global
 * `user-select:none`, and the session-scoped payload resolutions. A producer
 * that began its session on the PRESS therefore paid all of that for a plain
 * click — and the margin marker paid it fatally: by the mouseup the marker was
 * click-through, the release hit-tested to the editor beneath, the browser
 * dispatched `click` to the common ancestor, and the marker's select never ran.
 *
 * So a press-started drop gesture has a PENDING phase. `pendDropSession`
 * records the press and installs one window `mousemove` plus the held-press
 * end watcher (`watchHeldPress`: mouseup / missed release / contextmenu /
 * blur). It resolves NOTHING and touches no global state. Then exactly one of:
 *
 *   - the pointer travels past {@link DROP_DRAG_THRESHOLD_PX} → PROMOTE: the
 *     record is dropped and `beginDropSession` runs with the press's options,
 *     unchanged — every begin-edge effect still happens on the begin edge, it
 *     is only that the begin edge is now the drag's, not the press's. The
 *     caller's `onPromote` runs on the same edge (the card gesture arms its
 *     release commit there; the marker arms its trailing-click guard there, so
 *     the guard and the session can never disagree about "was this a drag");
 *   - the press ends first (release, missed release, context menu, blur) or
 *     Escape is pressed → the record is discarded silently. Nothing became
 *     click-through, so the browser's own click reaches the pressed element.
 *
 * At most ONE press is pending: a new press supersedes an old record (whose
 * release we evidently never saw). A pending record holds no `DropCtx`: the
 * ctx is resolved at promote, inside `beginDropSession`, so a pane torn down
 * while a press is pending has nothing to cancel.
 *
 * `pendDrag` is the primitive under it, for a producer whose drag is more than
 * a bare session (the text-object float's drop button → `LiftHost.beginLift`).
 *
 * Producers that already gate their session on a movement threshold of their
 * own (the in-text inline-atom grab, the lifted-overlay grab via
 * `TextObjectGrabHandle` → `LiftHost.beginLift`) call `beginDropSession`
 * directly on their threshold edge; every PRESS-started producer goes through
 * this door. `drop-session-press-census.test.ts` pins the split.
 */

import { beginDropSession } from "./controller";
import {
  claimGestureKey,
  isMissedRelease,
  watchHeldPress,
} from "@/lib/pane-resize/pointer-invariants";

/** The ONE "this press became a drag" distance for press-started drop
 *  producers (px, per axis — the same Chebyshev test the marker's own watcher
 *  used before it was folded here). */
export const DROP_DRAG_THRESHOLD_PX = 3;

export type BeginDropSessionOpts = Parameters<typeof beginDropSession>[0];

export interface PendDropSessionOpts extends BeginDropSessionOpts {
  /** Runs on the promote edge, only when `beginDropSession` accepted. */
  onPromote?: () => void;
}

let disposePending: (() => void) | null = null;

/** Is a press currently pending (recorded, not yet a drag)? Probe for tests. */
export function hasPendingDropSession(): boolean {
  return disposePending !== null;
}

/** Discard the pending press, if any. Idempotent. */
export function cancelPendingDropSession(): void {
  disposePending?.();
}

/**
 * The primitive: record a press at `origin` and run `onPromote` with the move
 * that first carries it past {@link DROP_DRAG_THRESHOLD_PX} — or never, if the
 * press ends (or Escape) first. For a producer whose drag is more than a bare
 * `beginDropSession` (the text-object float's drop button starts a lifted
 * overlay, `LiftHost.beginLift`, which begins the session itself). Returns a
 * disposer that discards the record (no-op once it promoted or ended).
 */
export function pendDrag(opts: {
  origin: { x: number; y: number };
  onPromote: (e: MouseEvent) => void;
}): () => void {
  if (typeof window === "undefined") return () => {};
  cancelPendingDropSession();

  const { x: startX, y: startY } = opts.origin;
  let live = true;

  const dispose = () => {
    if (!live) return;
    live = false;
    window.removeEventListener("mousemove", onMove, true);
    window.removeEventListener("keydown", onKey, true);
    unwatchPress();
    if (disposePending === dispose) disposePending = null;
  };

  function onMove(e: MouseEvent) {
    // The held-press watcher owns the missed-release ending; never promote on
    // a move whose button is already up (it is not part of any drag).
    if (isMissedRelease(e)) return;
    if (
      Math.abs(e.clientX - startX) <= DROP_DRAG_THRESHOLD_PX &&
      Math.abs(e.clientY - startY) <= DROP_DRAG_THRESHOLD_PX
    ) {
      return;
    }
    dispose();
    opts.onPromote(e);
  }

  function onKey(e: KeyboardEvent) {
    if (e.key !== "Escape") return;
    // A held press is the innermost transient thing on screen even before it
    // is a drag — one press ends exactly one thing (task 504), so the gesture
    // CLAIMS it: the press stops being a would-be drag and nothing else closes.
    claimGestureKey(e);
    dispose();
  }

  // Registered BEFORE the move listener so a missed-release move ends the
  // record ahead of the threshold test (both are window-capture).
  const unwatchPress = watchHeldPress(dispose);
  window.addEventListener("mousemove", onMove, true);
  window.addEventListener("keydown", onKey, true);
  disposePending = dispose;
  return dispose;
}

/**
 * Record a press that MAY become a drop session; on the threshold it begins
 * the session with these options, unchanged (the PRESS point stays its
 * origin). Call from the producer's primary-button mousedown, after its own
 * press guards.
 */
export function pendDropSession(opts: PendDropSessionOpts): () => void {
  const { onPromote, ...begin } = opts;
  return pendDrag({
    origin: opts.origin,
    onPromote: () => {
      if (beginDropSession(begin)) onPromote?.();
    },
  });
}
