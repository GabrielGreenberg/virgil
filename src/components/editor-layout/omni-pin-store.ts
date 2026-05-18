"use client";

/**
 * Module-scope store for per-card pin requests in the omni view.
 *
 * A "pin" is a one-shot "place this card at this viewport-Y" request.
 * Marker clicks in the editor and the `virgil-card-jumped` event (from
 * card-body click jumps) both publish pin requests; `OmniViewPanel`
 * subscribes and overrides the card's natural `top` style for the pinned
 * card only. Other cards keep their `useInTextPositions`-computed natural
 * Y. No group transform, no global offset, no compensation listener.
 *
 * Architecture rationale: the previous design used a per-side
 * `cardsOffset` (translateY on a wrapper around ALL cards), which meant
 * shifting one card meant shifting the entire deck. It also raced against
 * `useInTextPositions`' rAF-driven recompute pipeline — measurements
 * taken in the click handler were stale by the time the offset committed.
 * The fix: position cards individually. Pinning the clicked card is a
 * single per-card `top` override that the renderer applies directly. No
 * measurement, no race.
 *
 * Single pin per side: marker clicks track the transient selection, and
 * there's at most one transient at a time. When the transient changes,
 * `OmniViewPanel` clears the stale pin via its subscription to
 * `useTransient()`. When a different marker is clicked, `requestPin`
 * replaces the prior pin atomically.
 */

import { useSyncExternalStore } from "react";

export type PinSide = "left" | "right";

export interface PinRequest {
  /** `data-omni-entry-wrapper` key — e.g. "citation:abc123". */
  cardId: string;
  /** Viewport Y the user clicked (or wants the card pinned at). */
  clickY: number;
  /** Monotonically increasing version, so an identical-payload re-request
   *  still triggers an update via `useSyncExternalStore`. */
  version: number;
}

const _pins: Record<PinSide, PinRequest | null> = { left: null, right: null };
const _listeners = new Set<() => void>();
let _nextVersion = 0;

function emit(): void {
  for (const fn of _listeners) fn();
}

export const omniPinStore = {
  get(side: PinSide): PinRequest | null {
    return _pins[side];
  },

  /** Pin a card at the given viewport-Y. Replaces any existing pin on
   *  this side. */
  requestPin(side: PinSide, cardId: string, clickY: number): void {
    const cur = _pins[side];
    if (cur && cur.cardId === cardId && cur.clickY === clickY) {
      // Same payload — still bump version so any subscriber treats it as
      // a fresh request (e.g. user re-clicked the same marker after
      // scroll, intending to re-pin at the original Y).
      _pins[side] = { ...cur, version: ++_nextVersion };
      emit();
      return;
    }
    _pins[side] = { cardId, clickY, version: ++_nextVersion };
    emit();
  },

  /** Clear the pin on this side. If `cardId` is given, only clear if the
   *  current pin matches (so a stale clear doesn't drop someone else's
   *  fresh pin). */
  clearPin(side: PinSide, cardId?: string): void {
    if (!_pins[side]) return;
    if (cardId && _pins[side]!.cardId !== cardId) return;
    _pins[side] = null;
    emit();
  },

  /** Clear all pins on both sides. */
  clearAll(): void {
    if (!_pins.left && !_pins.right) return;
    _pins.left = null;
    _pins.right = null;
    emit();
  },

  subscribe(fn: () => void): () => void {
    _listeners.add(fn);
    return () => _listeners.delete(fn);
  },
};

const _getServerSnapshot = () => null;

/** Hook: subscribe to the current pin request for a given side. Returns
 *  the same object identity across renders if the underlying pin hasn't
 *  changed (so consumers can use it as a useEffect dependency without
 *  thrashing). */
export function usePinRequest(side: PinSide): PinRequest | null {
  return useSyncExternalStore(
    omniPinStore.subscribe,
    () => _pins[side],
    _getServerSnapshot,
  );
}
