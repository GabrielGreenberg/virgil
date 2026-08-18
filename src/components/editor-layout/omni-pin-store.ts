"use client";

/**
 * Module-scope store for per-card pin requests in the omni view.
 *
 * A "pin" is "hold this card at this OFFSET from where its anchor puts it".
 * Marker clicks in the editor and the `virgil-card-jumped` event (from
 * card-body click jumps) both publish pin requests; `OmniViewPanel`
 * subscribes and overrides the card's natural transform for the pinned
 * card only. Other cards keep their `useInTextPositions`-computed natural
 * Y. No group transform, no global offset, no compensation listener.
 *
 * ## Anchor-relative, not pod-absolute (task 362)
 *
 * > **A pin overrides WHERE a card sits relative to its anchor — never
 * > where it sits on the pod.** The absolute Y is a live function of the
 * > anchor's position, so a pin that stored one would be a frozen copy of
 * > a derived answer: every edit above the anchor moves the anchor (and
 * > its margin marker, which resolves the live block) while the pinned
 * > card stayed at the stale Y. Two renderers of one anchor, disagreeing.
 *
 * That is exactly what shipped until 362 — task 328's own recorded
 * residual ("a pin is still PERSISTENT … so a card pinned by a sanctioned
 * move decouples from its anchor if the document is later edited above
 * it"), and Gabriel reported it from a real paper: an archive card and its
 * marker in completely different places, with the anchor demonstrably
 * healthy.
 *
 * So the stored value is `offset` — pod-relative pixels from the card's
 * NATURAL top (`coordsAtPos(anchorPos).top - podRect.top`, the number
 * `useInTextPositions` measures for every card). The cascade re-derives
 * the absolute Y as `naturalTop + offset` on every measure, so a pinned
 * card rides its anchor through any edit while keeping the offset the
 * user's gesture chose. Nothing expires, because nothing can drift: the
 * invariant holds by construction rather than by a threshold.
 *
 * The absolute→relative conversion happens ONCE, at the publish site
 * (`omni-card-placement.ts`), against the natural top the pod published on
 * the wrapper (`data-omni-natural-top`) — the same pass that produced the
 * geometry the gesture was aimed at. A gesture genuinely speaks in screen
 * coordinates ("put it where I clicked"); what is DURABLE about it is the
 * relationship to the anchor, and that is what is kept.
 *
 * Scroll invariance is unchanged and comes for free: the pod moves with
 * the row under the unified scroll, so both `naturalTop` and `offset` are
 * scroll-invariant and a pin change still costs zero DOM measurement.
 *
 * Single pin per side: marker clicks track the selection, and there's at
 * most one selected card at a time, so a new marker click simply REPLACES
 * the prior pin atomically. Nothing else clears one — the pin is untied
 * from selection deliberately, so collapse-toggling a pinned card doesn't
 * snap it back to its cascaded position. (An earlier version of this
 * header claimed `OmniViewPanel` cleared the pin from a `useSelection()`
 * subscription; there is no such subscription and there has not been one
 * since the pin was made persistent. Corrected rather than left standing:
 * a header describing a lifecycle the code does not have is how the next
 * reader concludes the pin is already bounded.)
 *
 * The one non-replacement clear is the card LIFT / pop-out gesture
 * (`panel-primitives.tsx`), which unmounts the wrapper from the cascade.
 * It clears by the WRAPPER's id — the same identity `requestPin` stores —
 * because a multi-anchor card's row is `<key>@N` and `clearPin`'s identity
 * guard declines a mismatch, which used to leave a lifted multi-anchor
 * row's pin standing forever.
 */

import { useSyncExternalStore } from "react";

export type PinSide = "left" | "right";

/** The DOM channel the pod publishes each card's measured natural top on,
 *  and the ONE thing that makes the publish site able to speak in anchor-
 *  relative terms. Read by `omni-card-placement.ts`; written by
 *  `OmniViewPanel`'s positioned wrapper, which renders only once the card
 *  HAS a measured natural top — so a wrapper in the DOM always carries it. */
export const DATA_OMNI_NATURAL_TOP = "data-omni-natural-top";

export interface PinRequest {
  /** `data-omni-entry-wrapper` key — the canonical `float:card:<kind>:<id>`
   *  grammar, e.g. "float:card:citation:abc123". */
  cardId: string;
  /** Pod-relative pixels from the card's NATURAL top (the anchor-derived
   *  position `useInTextPositions` measures). Positive = below the anchor.
   *  The cascade resolves the absolute Y as `naturalTop + offset` on every
   *  measure, so the pin rides document edits with its anchor. */
  offset: number;
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

  /** Pin a card at the given offset from its natural (anchor-derived) top.
   *  Replaces any existing pin on this side.
   *
   *  MECHANISM, not policy: this writes whatever offset it is handed.
   *  Whether a card may be moved at all — and to which Y — is decided ONCE
   *  by `omni-card-placement.ts`, the only production caller (task 328;
   *  CI: `gutter-stability-census`), which is also the only place the
   *  absolute→anchor-relative conversion happens (task 362). Three
   *  publishers used to reach this directly and each moved its card
   *  unconditionally. */
  requestPin(side: PinSide, cardId: string, offset: number): void {
    const cur = _pins[side];
    if (cur && cur.cardId === cardId && cur.offset === offset) {
      // Same payload — still bump version so any subscriber treats it as
      // a fresh request (e.g. user re-clicked the same marker after
      // scroll, intending to re-pin at the original Y).
      _pins[side] = { ...cur, version: ++_nextVersion };
      emit();
      return;
    }
    _pins[side] = { cardId, offset, version: ++_nextVersion };
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
