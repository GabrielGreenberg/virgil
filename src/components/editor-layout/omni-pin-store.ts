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
 * the wrapper (`data-omni-natural-top`). A gesture genuinely speaks in
 * screen coordinates ("put it where I clicked"); what is DURABLE about it
 * is the relationship to the anchor, and that is what is kept.
 *
 * Scroll invariance is unchanged and comes for free: the pod moves with
 * the row under the unified scroll, so both `naturalTop` and `offset` are
 * scroll-invariant and a pin change still costs zero DOM measurement.
 *
 * ## Two things the conversion is NOT, stated rather than implied
 *
 * **It is not a single-clock read.** The door's `podTop`/`rect` are LIVE
 * `getBoundingClientRect()` reads at gesture time; the natural top is the
 * value React last COMMITTED. They can disagree — most concretely during
 * task 328's 180 ms `.omni-entry-slide`, where a rect read returns the
 * INTERPOLATED transform, so a freeze fired mid-slide stores a mid-flight
 * offset. That is pre-existing (the absolute pin stored a mid-flight Y for
 * the same reason) and it self-corrects on the next committed measure,
 * which is the point of storing the relationship rather than the number.
 *
 * **The reference may be an ESTIMATE.** A card whose anchor is outside the
 * visible band carries an interpolated natural (`approxTopForPos`, wave-2b
 * C5), refined to exact on scroll idle — and moving an off-screen card is
 * precisely the case the necessity rule sanctions, so this is the ordinary
 * path, not an exotic one. The pinned card therefore MOVES by the
 * interpolation error when the refinement lands, where a pod-absolute pin
 * was immune to it by construction. Accepted deliberately: the correction
 * moves the card TOWARD its anchor (the offset the user chose, measured
 * from the truth), it lands on the very next pass because the pin has just
 * brought the card into view, it is bounded by the same interpolation task
 * 327 made non-absorbing, and the 328 slide renders it as a glide rather
 * than a teleport. Pinned as a contract in `omni-pin-anchor-lifecycle`.
 *
 * ## One pin per POD, keyed by its OWNER (task 583)
 *
 * > **A pin is a fact about ONE deck, so it lives in that deck's slot.** N
 * > `OmniViewPanel`s are mounted at once (multi-doc keep-alive, the Library
 * > Reader, both rails of a pane), and each one mints an OWNER token and
 * > stamps it on its pod (`data-omni-pin-owner`). Every read and write names
 * > the owner; nothing is keyed by side alone.
 *
 * Until 583 the store held ONE slot per SIDE for the whole app, so a marker
 * click in doc B released doc A's pinned card (it had snapped back by the time
 * the user returned), and A's standing pin satisfied B's hold rule — a
 * per-DOCUMENT value in a single module slot, the "Per-doc services under
 * multi-pane keep-alive" class. The owner is resolved from the DOM the gesture
 * already holds (`pinOwnerOf(wrapper)` — the wrapper's pod), which is the one
 * spelling of "wrapper → owner" both the placement door and the lift read.
 *
 * Within one owner there is still ONE pin: marker clicks track the selection,
 * and there's at most one selected card at a time, so a new marker click
 * simply REPLACES the prior pin atomically. Nothing else clears a LIVE pin —
 * the pin is untied from selection deliberately, so collapse-toggling a pinned
 * card doesn't snap it back to its cascaded position. (An earlier version of
 * this header claimed `OmniViewPanel` cleared the pin from a `useSelection()`
 * subscription; there is no such subscription and there has not been one
 * since the pin was made persistent.) What bounds a standing pin's REACH is
 * not a clear but the hold rule in `omni-card-placement.ts`, which since 583
 * asks whether the pinned card can actually move the pressed one.
 *
 * Two non-replacement clears: the card LIFT / pop-out gesture
 * (`panel-primitives.tsx`), which unmounts the wrapper from the cascade — it
 * clears by the WRAPPER's id, the same identity `requestPin` stores, because a
 * multi-anchor card's row is `<key>@N` and `clearPin`'s identity guard
 * declines a mismatch — and the owning panel's UNMOUNT (`releaseOwner`), so a
 * closed pane leaves no slot behind.
 */

import { useSyncExternalStore } from "react";

/** The DOM channel the pod publishes each card's measured natural top on,
 *  and the ONE thing that makes the publish site able to speak in anchor-
 *  relative terms. Read by `omni-card-placement.ts`; written by
 *  `OmniViewPanel`'s positioned wrapper, which renders only once the card
 *  HAS a measured natural top — so a wrapper in the DOM always carries it. */
export const DATA_OMNI_NATURAL_TOP = "data-omni-natural-top";

/** The DOM channel each pod stamps its pin OWNER on (task 583). Written by
 *  `OmniViewPanel` (a bare JSX attribute — JSX has no computed-attribute
 *  syntax); read only through `pinOwnerOf`. */
export const DATA_OMNI_PIN_OWNER = "data-omni-pin-owner";

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

const _pins = new Map<string, PinRequest>();
const _listeners = new Set<() => void>();
let _nextVersion = 0;
let _nextOwner = 0;

function emit(): void {
  for (const fn of _listeners) fn();
}

/** Mint a pin owner for one omni deck. Called once per `OmniViewPanel`
 *  instance (`useState(mintPinOwner)`). */
export function mintPinOwner(): string {
  return `omni-pin-${++_nextOwner}`;
}

/** The ONE spelling of "which deck does this wrapper belong to?": the owner
 *  its pod stamped. A wrapper is a direct child of the pod (the placement
 *  door already takes `wrapper.parentElement` as the pod). `null` when the
 *  pod carries no owner — callers fail CLOSED on that: a pin with no owner
 *  is a pin no deck reads. */
export function pinOwnerOf(wrapper: Element | null | undefined): string | null {
  const owner = wrapper?.parentElement?.getAttribute(DATA_OMNI_PIN_OWNER);
  return owner ? owner : null;
}

export const omniPinStore = {
  get(owner: string): PinRequest | null {
    return _pins.get(owner) ?? null;
  },

  /** Pin a card at the given offset from its natural (anchor-derived) top.
   *  Replaces any existing pin for this OWNER — and no other owner's.
   *
   *  MECHANISM, not policy: this writes whatever offset it is handed.
   *  Whether a card may be moved at all — and to which Y — is decided ONCE
   *  by `omni-card-placement.ts`, the only production caller (task 328;
   *  CI: `gutter-stability-census`), which is also the only place the
   *  absolute→anchor-relative conversion happens (task 362). */
  requestPin(owner: string, cardId: string, offset: number): void {
    const cur = _pins.get(owner);
    if (cur && cur.cardId === cardId && cur.offset === offset) {
      // Same payload — still bump version so any subscriber treats it as
      // a fresh request (e.g. user re-clicked the same marker after
      // scroll, intending to re-pin at the original Y).
      _pins.set(owner, { ...cur, version: ++_nextVersion });
      emit();
      return;
    }
    _pins.set(owner, { cardId, offset, version: ++_nextVersion });
    emit();
  },

  /** Clear this owner's pin. If `cardId` is given, only clear if the
   *  current pin matches (so a stale clear doesn't drop someone else's
   *  fresh pin). */
  clearPin(owner: string, cardId?: string): void {
    const cur = _pins.get(owner);
    if (!cur) return;
    if (cardId && cur.cardId !== cardId) return;
    _pins.delete(owner);
    emit();
  },

  /** Drop an owner's slot entirely — the owning deck unmounted. */
  releaseOwner(owner: string): void {
    if (!_pins.delete(owner)) return;
    emit();
  },

  /** Test seam: forget every owner's pin. */
  clearAll(): void {
    if (_pins.size === 0) return;
    _pins.clear();
    emit();
  },

  subscribe(fn: () => void): () => void {
    _listeners.add(fn);
    return () => _listeners.delete(fn);
  },
};

const _getServerSnapshot = () => null;

/** Hook: subscribe to the current pin request for one deck's owner. Returns
 *  the same object identity across renders if the underlying pin hasn't
 *  changed (so consumers can use it as a useEffect dependency without
 *  thrashing). */
export function usePinRequest(owner: string): PinRequest | null {
  return useSyncExternalStore(
    omniPinStore.subscribe,
    () => _pins.get(owner) ?? null,
    _getServerSnapshot,
  );
}
