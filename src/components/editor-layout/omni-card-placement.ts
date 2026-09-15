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
 * per deck, so publishing it REPLACES whatever pin another card is holding —
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
  pinOwnerOf,
  DATA_OMNI_NATURAL_TOP,
} from "./omni-pin-store";
import { findOmniEntry } from "./event-bridges/open-for-card";
import { resolveAlignScroll } from "./layout-scroll";
import { mayReposition } from "@/lib/reposition-policy";

/** Where the gesture wants the card. `viewportY` is a screen Y (a click);
 *  `podTop` is already pod-relative (a jump's pre-scroll measurement, which
 *  is scroll-invariant and must NOT be re-derived from a post-scroll rect). */
export type DesiredCardTop = { viewportY: number } | { podTop: number };

interface Resolved {
  /** The deck this card belongs to (task 583) — the pod's stamped owner.
   *  Every read and write of the pin store names it, so one pane's gesture
   *  can neither replace nor consult another pane's pin. */
  owner: string;
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
  // A pod with no owner is a deck no subscriber reads, so a pin written for
  // it would be invisible AND would need a slot to land in — fail CLOSED,
  // like a missing wrapper.
  const owner = pinOwnerOf(wrapper);
  if (!wrapper || !pod || !owner) return null;
  const naturalTop = naturalTopOf(wrapper);
  if (!Number.isFinite(naturalTop)) return null;
  return {
    owner,
    wrapperId: wrapper.dataset.omniEntryWrapper ?? fallbackKey,
    wrapper,
    pod,
    naturalTop,
  };
}

/** A wrapper's published natural top, or NaN when absent/unreadable.
 *  `Number(null)` and `Number("")` are both 0, so the presence check is
 *  separate from the parse — a missing attribute must not read as an anchor
 *  sitting at the top of the pod. */
function naturalTopOf(wrapper: Element): number {
  const raw = wrapper.getAttribute(DATA_OMNI_NATURAL_TOP);
  return raw === null || raw.trim() === "" ? NaN : Number(raw);
}

/**
 * Is a HOLD needed at all, and is what it would hold a thing the deck itself
 * produced? (tasks 490 + 583 — the rules that stop a freeze becoming a
 * permanent placement nobody asked for.)
 *
 * > **A hold asserts nothing of its own: it re-states what the cascade already
 * > computed. So a hold that would change nothing writes nothing — the rule its
 * > sibling door already follows — and a hold never stores an offset the
 * > cascade's own rule could not have produced.**
 *
 *  1. **No transient can move the pressed card ⇒ write nothing.** Which cards
 *     CAN move is exactly readable off `resolveCascade`:
 *       - its forward pass sets row *i*'s top from its PREDECESSORS alone
 *         (`max(natural_i, prev.top + prev.height + MIN_GAP)`), so a card's
 *         top is INDEPENDENT of its own height;
 *       - its backward (up-pulling) pass — the only thing that makes a card's
 *         top depend on its own height (`prev.top = cur.top − prev.height −
 *         MIN_GAP`) — runs only when a pin resolves, and can only move rows
 *         BEFORE the pinned row in cascade order: every row after it was
 *         packed below its predecessor by the forward pass already, so the
 *         pull is the identity there.
 *     So a transient exists only for a card that sits ABOVE a pinned card
 *     that is live IN THIS DECK. Pressing the pinned card itself moves nothing
 *     either (its top IS the pin, and nothing above it depends on its height).
 *
 *     What a needless hold COSTS is the whole of Gabriel's task-490 report.
 *     The offset a hold stores is the DISPLACEMENT THE CASCADE PRODUCED at
 *     press time — how far the crowd above pushed this card off its anchor —
 *     and a live pin is never cleared except by a replacement. So the moment
 *     the crowd changes the deck's own answer moves and the pinned card does
 *     not: it stays displaced by an amount the deck no longer requires
 *     ("displacing to the same extent as they would be when open"). A hold is
 *     a freeze through a transient, not a placement; and where there is no
 *     transient there is nothing to freeze.
 *
 *     RENEGOTIATED (task 583). This rule used to ask only "is ANY pin standing
 *     on this side?", calling itself conservative — "a press on a card BELOW
 *     [the pin] is also a no-op … errs toward today's behaviour, which is the
 *     safe direction". It was not safe, because a live pin is never cleared:
 *     after ONE marker click every later press below the pinned card re-armed
 *     490 verbatim, and replaced the pin, snapping the previously pinned card
 *     back — a visible jump of a card the user did not touch. A pin naming a
 *     card no longer in the deck (archived, deleted) is inert in the cascade
 *     and was STILL enough to satisfy the old question. Asking the exact one
 *     costs one child scan of this pod, once, on a mousedown.
 *  2. **A hold never stores an offset ABOVE the anchor.** A hold's whole
 *     content is "the deck put me here", and the deck's own rule never puts a
 *     card above its anchor. A negative offset is therefore another card's pin
 *     showing through — a transient the user caused for a DIFFERENT card — and
 *     freezing it makes this card permanently contradict its own margin marker,
 *     which is precisely the decoupling task 362 exists to retire, arriving
 *     through the offset instead of through the coordinate.
 *
 * Cascade ORDER is `resolveCascade`'s own sort key: natural top ascending, and
 * — the sort being stable over the items list the pod renders wrappers in — DOM
 * order on a tie. Both come off the pod's own children, so this reads no rect.
 */
function holdIsNeeded(r: Resolved, desiredPodTop: number): boolean {
  const pin = omniPinStore.get(r.owner);
  if (!pin || pin.cardId === r.wrapperId) return false;
  // The pinned card, IN THIS POD — a relative scan of the pod's own wrappers
  // (direct children), never a document-global lookup. Not here ⇒ the pin is
  // inert in this deck's cascade ⇒ no transient.
  let pinned: HTMLElement | null = null;
  for (const child of Array.from(r.pod.children)) {
    if ((child as HTMLElement).dataset?.omniEntryWrapper === pin.cardId) {
      pinned = child as HTMLElement;
      break;
    }
  }
  if (!pinned) return false;
  const pinnedNatural = naturalTopOf(pinned);
  if (!Number.isFinite(pinnedNatural)) return false; // unmeasured ⇒ inert
  const above =
    r.naturalTop < pinnedNatural ||
    (r.naturalTop === pinnedNatural &&
      (r.wrapper.compareDocumentPosition(pinned) &
        Node.DOCUMENT_POSITION_FOLLOWING) !== 0);
  if (!above) return false;
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
    omniPinStore.requestPin(r.owner, r.wrapperId, desiredPodTop - r.naturalTop);
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
