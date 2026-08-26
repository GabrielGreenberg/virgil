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
 * `holdOmniCard` is the deliberate exception to the NECESSITY question and the
 * reason the two doors are spelled separately: there the pin IS the point. It
 * is NOT an exception to "a refused hold writes nothing" — see `holdIsNeeded`
 * (task 490), which is what stops an ordinary click freezing a displacement the
 * user never asked for.
 *
 * Coordinates: a gesture speaks in SCREEN Y, the necessity rule is asked in
 * POD-RELATIVE Y (against the pod that hosts the absolute wrappers, with the
 * wrapper's viewport rect and its scroll band supplying visibility), and the
 * store speaks ANCHOR-RELATIVE offsets (task 362 — see `omni-pin-store`'s
 * header for why the durable half of a pin is its offset from the anchor and
 * never a pod coordinate). All three conversions happen HERE, once, which is
 * what lets the store hold a value no later document edit can falsify.
 */

import {
  omniPinStore,
  DATA_OMNI_NATURAL_TOP,
  type PinSide,
} from "./omni-pin-store";
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
  /** The card's pod-relative NATURAL top — the position its ANCHOR gives
   *  it, published by the pod on the wrapper each measure. The reference
   *  every stored pin is expressed against (task 362). */
  naturalTop: number;
}

/** Everything a placement needs, from the wrapper element itself.
 *
 *  A wrapper with no readable `data-omni-natural-top` resolves to `null` —
 *  the same "there is nothing to pin" answer as a missing wrapper, and the
 *  fail-CLOSED direction on purpose: the alternative (fall back to storing
 *  an absolute Y) is precisely the decoupling task 362 exists to retire,
 *  and it would come back silently on whichever path lost the attribute.
 *  This costs nothing in practice, because the pod renders a positioned
 *  wrapper only for a card it has a measured natural top for. */
function resolveFrom(
  wrapper: HTMLElement | null,
  fallbackKey: string,
): Resolved | null {
  const pod = wrapper?.parentElement as HTMLElement | null;
  const sideEl = wrapper?.closest("[data-panel-column-side]") as HTMLElement | null;
  const side = sideEl?.dataset.panelColumnSide;
  if (!wrapper || !pod || (side !== "left" && side !== "right")) return null;
  // `Number(null)` and `Number("")` are both 0, so the presence check is
  // separate from the parse — a missing attribute must not read as an
  // anchor sitting at the top of the pod.
  const rawNatural = wrapper.getAttribute(DATA_OMNI_NATURAL_TOP);
  const naturalTop =
    rawNatural === null || rawNatural.trim() === "" ? NaN : Number(rawNatural);
  if (!Number.isFinite(naturalTop)) return null;
  return {
    side,
    wrapperId: wrapper.dataset.omniEntryWrapper ?? fallbackKey,
    wrapper,
    pod,
    naturalTop,
  };
}

/**
 * Is a HOLD needed at all, and is what it would hold a thing the deck itself
 * produced? (task 490 — the two rules that stop a freeze becoming a permanent
 * placement nobody asked for.)
 *
 * > **A hold asserts nothing of its own: it re-states what the cascade already
 * > computed. So a hold that would change nothing writes nothing — the rule its
 * > sibling door already follows — and a hold never stores an offset the
 * > cascade's own rule could not have produced.**
 *
 *  1. **No pin standing on this side ⇒ nothing can move ⇒ write nothing.**
 *     `resolveCascade`'s forward pass sets row *i*'s top from its PREDECESSORS
 *     alone (`max(natural_i, prev.top + prev.height + MIN_GAP)`), so a card's
 *     top is INDEPENDENT of its own height; and the backward (up-pulling) pass
 *     — the only thing that can make a card's top depend on its own height —
 *     runs ONLY when a pin exists, and is the IDENTITY unless the pin moved its
 *     card ABOVE the forward answer. So on a pin-free side the height change
 *     this click is about to cause cannot move the pressed card by a pixel, and
 *     the freeze held nothing.
 *
 *     What it COST is the whole of Gabriel's second report. The offset a hold
 *     stores is the DISPLACEMENT THE CASCADE PRODUCED at press time — how far
 *     the crowd above pushed this card off its anchor — and nothing ever clears
 *     a pin (`omni-pin-store`: "Nothing else clears one"). So the moment the
 *     crowd changes (the card above collapses, its stale height heals, a
 *     passage is archived away) the deck's own answer moves and the pinned card
 *     does not: it stays displaced by an amount the deck no longer requires.
 *     Pressed while the deck was full of EXPANDED cards, it is thereafter
 *     "displacing to the same extent as it would be when open", permanently —
 *     the report, word for word. A hold is a freeze through a transient, not a
 *     placement; and where there is no transient there is nothing to freeze.
 *  2. **A hold never stores an offset ABOVE the anchor.** A hold's whole
 *     content is "the deck put me here", and the deck's own rule never puts a
 *     card above its anchor. A negative offset is therefore another card's pin
 *     showing through — a transient the user caused for a DIFFERENT card — and
 *     freezing it makes this card permanently contradict its own margin marker,
 *     which is precisely the decoupling task 362 exists to retire, arriving
 *     through the offset instead of through the coordinate.
 *
 * Rule 1 is deliberately conservative rather than exact: the backward pass can
 * only reach cards ABOVE the pinned one, so a press on a card BELOW it is also
 * a no-op. Asking that would mean resolving the pinned card's wrapper and its
 * natural top at gesture time; asking "is a pin standing?" costs one map read
 * and errs toward today's behaviour, which is the safe direction for a freeze.
 */
function holdIsNeeded(r: Resolved, desiredPodTop: number): boolean {
  if (!omniPinStore.get(r.side)) return false;
  return desiredPodTop - r.naturalTop >= 0;
}

/** `target` is either the EXACT wrapper (a caller holding the element it was
 *  clicked on) or a key to look up. The distinction matters under multi-pane
 *  keep-alive: N panes are mounted at once and `document.querySelector`
 *  answers with the first in DOM order, which may be a `display:none` warm
 *  pane whose rects all read zero — the task-329 shape. A caller that knows
 *  its element passes it; only the two event-driven publishers, which have
 *  nothing but a key, take the lookup. */
function publish(
  target: HTMLElement | { key: string },
  desired: DesiredCardTop | "hold",
): void {
  let retried = false;
  const apply = () => {
    const r =
      target instanceof HTMLElement
        ? resolveFrom(target, target.dataset.omniEntryWrapper ?? "")
        : resolveFrom(
            findOmniEntry(target.key, "data-omni-entry-wrapper"),
            target.key,
          );
    if (!r) {
      // The omni column may have been activated THIS render (a marker click
      // that opened the panel), so the wrapper isn't in the DOM yet. One
      // frame is enough for the column to commit its first render; a second
      // miss means there is no such card and there is nothing to pin.
      //
      // Only the KEY-lookup form retries, which is the only form the retry
      // was ever for: a caller holding its element (`holdOmniCard`, from a
      // mousedown on the wrapper itself) is holding a MOUNTED node, so a
      // second resolve of that same node re-reads the same answer. Since
      // this branch is now also reachable from the fail-closed natural-top
      // check, retrying it would burn a frame on every such mousedown to
      // reach a guaranteed second refusal.
      if (!retried && !(target instanceof HTMLElement)) {
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
    } else if (!holdIsNeeded(r, desiredPodTop)) {
      return; // nothing to hold: write nothing, move nothing
    }
    // Absolute → ANCHOR-RELATIVE, here and nowhere else (task 362). The
    // necessity question above is a SCREEN question (is the card visible,
    // is it far from where the user pointed?) and is rightly asked in
    // absolute pod space; what gets STORED is the durable half — the
    // offset from the anchor — so the card rides later edits instead of
    // decoupling from the marker that shares its anchor.
    omniPinStore.requestPin(r.side, r.wrapperId, desiredPodTop - r.naturalTop);
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
  publish({ key: cardKey }, desired);
}

/**
 * Freeze the omni card for `cardKey` at its current top.
 *
 * Same door, opposite intent: the wrapper's mousedown-capture calls this before
 * a click can toggle collapse/expand, so the card's top survives a height
 * change that could otherwise move it. It asks no NECESSITY question (there is
 * no move to sanction) but it does ask `holdIsNeeded` — read that comment for
 * the two rules, which exist because a hold that writes when nothing could have
 * moved is not a freeze: it releases whatever card was pinned before, lifts
 * every card above this one off its anchor, and (nothing ever clearing a pin)
 * makes both permanent.
 *
 * When a hold IS needed, the cost is the same one a refused placement
 * deliberately avoids — releasing the previously pinned card. That trade is
 * pre-328 behaviour and is what makes the freeze work at all.
 *
 * Takes the WRAPPER, not a key: this caller is holding the element the user
 * pressed, and looking it up again by key would be strictly worse under
 * multi-pane keep-alive (see `publish`).
 */
export function holdOmniCard(wrapper: HTMLElement): void {
  publish(wrapper, "hold");
}
