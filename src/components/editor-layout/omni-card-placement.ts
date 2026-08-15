"use client";

/**
 * The ONE door every "place this omni card at Y" gesture enters (task 328).
 *
 * Three gestures publish omni pins — a marker click in the editor, the
 * `virgil-card-jumped` event a card→text jump fires, and the wrapper's own
 * mousedown "freeze me through the height change I'm about to cause". Before
 * this module each resolved the wrapper, converted to pod coordinates and
 * wrote `omniPinStore.requestPin` itself, unconditionally: a card the user
 * could already see moved anyway, and the whole deck re-cascaded around it.
 *
 * > **Every publisher asks the necessity rule, and a refused placement writes
 * > NOTHING — it does not write a no-op pin.**
 *
 * That second half is not fastidiousness. A pin at the card's own current top
 * looks deck-neutral, and in isolation it is (`resolveCascade`'s forward pass
 * reproduces the value it is then overridden with, and its backward pass is
 * the identity on a deck that already clears). But the store holds ONE pin
 * per side, so publishing it REPLACES whatever pin another card is holding —
 * and that card, released, snaps back to its natural position and re-packs
 * its neighbours. A "hold" that moved a different card would be this task's
 * own bug wearing the fix's clothes. Writing nothing leaves the deck exactly
 * as the user is looking at it, which is the whole ask.
 *
 * `holdOmniCard` is the deliberate exception and the reason the two doors are
 * spelled separately: there the pin IS the point.
 *
 * Coordinates: `omniPinStore` speaks POD-RELATIVE Y (see its header), so the
 * conversion happens here, once, against the pod that hosts the absolute
 * wrappers — and the necessity rule is asked in that same space, with the
 * wrapper's viewport rect and its scroll band supplying visibility.
 */

import { omniPinStore, type PinSide } from "./omni-pin-store";
import { findOmniEntry } from "./event-bridges/open-for-card";
import { resolveAlignScroll } from "./layout-scroll";
import { mayReposition } from "@/lib/reposition-policy";

/** Where the gesture wants the card. `viewportY` is a screen Y (a click);
 *  `podTop` is already pod-relative (a jump's pre-scroll measurement, which
 *  is scroll-invariant and must NOT be re-derived from a post-scroll rect). */
export type DesiredCardTop = { viewportY: number } | { podTop: number };

interface Resolved {
  side: PinSide;
  /** The wrapper's OWN id — a multi-anchor card's row is `…@N`, and the
   *  store's `pinRequest.cardId === item.id` match is against that, not
   *  against the bare key the caller passed. */
  wrapperId: string;
  wrapper: HTMLElement;
  pod: HTMLElement;
}

function resolve(cardKey: string): Resolved | null {
  const wrapper = findOmniEntry(cardKey, "data-omni-entry-wrapper");
  const pod = wrapper?.parentElement as HTMLElement | null;
  const sideEl = wrapper?.closest("[data-panel-column-side]") as HTMLElement | null;
  const side = sideEl?.dataset.panelColumnSide;
  if (!wrapper || !pod || (side !== "left" && side !== "right")) return null;
  return {
    side,
    wrapperId: wrapper.dataset.omniEntryWrapper ?? cardKey,
    wrapper,
    pod,
  };
}

function publish(cardKey: string, desired: DesiredCardTop | "hold"): void {
  let retried = false;
  const apply = () => {
    const r = resolve(cardKey);
    if (!r) {
      // The omni column may have been activated THIS render (a marker click
      // that opened the panel), so the wrapper isn't in the DOM yet. One
      // frame is enough for the column to commit its first render; a second
      // miss means there is no such card and there is nothing to pin.
      if (!retried) {
        retried = true;
        requestAnimationFrame(apply);
      }
      return;
    }
    const podTop = r.pod.getBoundingClientRect().top;
    const rect = r.wrapper.getBoundingClientRect();
    const currentPodTop = rect.top - podTop;
    const desiredPodTop =
      desired === "hold"
        ? currentPodTop
        : "podTop" in desired
          ? desired.podTop
          : desired.viewportY - podTop;
    if (desired !== "hold") {
      const scrollEl = resolveAlignScroll(r.wrapper);
      const band = scrollEl ? scrollEl.getBoundingClientRect() : null;
      const verdict = mayReposition({
        current: currentPodTop,
        target: desiredPodTop,
        rect,
        band,
      });
      if (verdict === "hold") return; // refused: write nothing, move nothing
    }
    omniPinStore.requestPin(r.side, r.wrapperId, desiredPodTop);
  };
  apply();
}

/**
 * Place the omni card for `cardKey` at `desired` — if the necessity rule
 * sanctions the move. A refused placement writes NOTHING, so neither this
 * card, nor its neighbours, nor a card an earlier gesture pinned shifts by a
 * pixel.
 */
export function requestOmniCardPlacement(
  cardKey: string,
  desired: DesiredCardTop,
): void {
  publish(cardKey, desired);
}

/**
 * Freeze the omni card for `cardKey` at its current top.
 *
 * Same door, opposite intent — and the ONE caller for which publishing a pin
 * IS the point: the wrapper's mousedown-capture calls this before a click can
 * toggle collapse/expand, so the card's top survives its own height change.
 * It asks no necessity question, because there is no move to sanction; what
 * it costs is the one thing a refused placement deliberately avoids, namely
 * releasing whatever card was pinned before. That trade is pre-328 behaviour
 * and is what makes the freeze work at all.
 */
export function holdOmniCard(cardKey: string): void {
  publish(cardKey, "hold");
}
