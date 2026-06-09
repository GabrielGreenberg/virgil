"use client";

/**
 * Module-scope store for per-card pin requests in the omni view.
 *
 * A "pin" is a one-shot "place this card at this pod-relative Y" request.
 * Marker clicks in the editor and the `virgil-card-jumped` event (from
 * card-body click jumps) both publish pin requests; `OmniViewPanel`
 * subscribes and overrides the card's natural transform for the pinned
 * card only. Other cards keep their `useInTextPositions`-computed natural
 * Y. No group transform, no global offset, no compensation listener.
 *
 * Pod-relative coordinates: the pin's Y is in the same space that
 * `useInTextPositions` produces (relative to the panel pod's top). The
 * viewport → pod conversion happens once at the publish site, against
 * the pod rect currently on screen. The cascade then reads a pre-baked
 * number and never re-derives from a live `podRect.top` — so pin changes
 * don't trigger DOM measurement, and the pin is scroll-invariant under
 * the unified row scroll (the pod moves with the row, so pod-relative
 * stays valid as the user scrolls naturally).
 *
 * Single pin per side: marker clicks track the selection, and there's at
 * most one selected card at a time. When the selection changes,
 * `OmniViewPanel` clears the stale pin via its subscription to
 * `useSelection()`. When a different marker is clicked, `requestPin`
 * replaces the prior pin atomically.
 */

import { useSyncExternalStore } from "react";

export type PinSide = "left" | "right";

export interface PinRequest {
  /** `data-omni-entry-wrapper` key — e.g. "citation:abc123". */
  cardId: string;
  /** Pod-relative Y (px) the card should be pinned at. Computed by the
   *  publisher as `viewportY - podRect.top` against the pod that hosts
   *  the absolute card wrappers. Scroll-invariant under unified scroll. */
  pinTop: number;
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

  /** Pin a card at the given pod-relative Y. Replaces any existing pin
   *  on this side. */
  requestPin(side: PinSide, cardId: string, pinTop: number): void {
    const cur = _pins[side];
    if (cur && cur.cardId === cardId && cur.pinTop === pinTop) {
      // Same payload — still bump version so any subscriber treats it as
      // a fresh request (e.g. user re-clicked the same marker after
      // scroll, intending to re-pin at the original Y).
      _pins[side] = { ...cur, version: ++_nextVersion };
      emit();
      return;
    }
    _pins[side] = { cardId, pinTop, version: ++_nextVersion };
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
