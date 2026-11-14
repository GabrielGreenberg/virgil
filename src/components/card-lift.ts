"use client";

import { useEffect, useState } from "react";

/**
 * Shared signal for the card lift-off gesture (drag a docked card out of
 * its panel to spawn a popped-out floater). Two pieces of state:
 *
 *   - `liftTarget`: which card's bounding rect the lift outline should
 *     highlight. PULSED (`pulseCardLiftTarget`) when the drag-out gesture
 *     crosses the activation threshold: the STORE sets it and owns the
 *     brief clear that drives the fade-out (task 1618's sibling, 1619).
 *   - `liftHandoff`: one-shot drag handoff payload consumed by the
 *     freshly-mounted FloatingPanel. Lets the spawned float pick up the
 *     ongoing mouse drag at the cursor's current position so the user
 *     experiences a single continuous gesture from card-grab to
 *     float-drop.
 *
 * Module-level (not React Context) because the producer (PanelCard's
 * lift gesture) and consumers (DragOutlines' card-lift outline + FloatCard) live in
 * unrelated subtrees.
 *
 * Mirrors the shape of `dock-drag.ts` for panel undock — separate from
 * it because cards have no docking targets, only lift-off.
 */

export interface CardLiftRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface CardLiftTarget {
  cardKey: string;
  rect: CardLiftRect;
}

export interface CardLiftHandoff {
  cardKey: string;
  clientX: number;
  clientY: number;
  /** Set on a COLLAPSED-card lift: the spawn rect is the collapsed,
   *  header-only rect, and the float path runs its one-shot
   *  expand-to-content grow (capped by `capPopoutHeight`). Expanded
   *  lifts pop at exactly the source size and skip the grow. The
   *  float's spawn rect itself rides through `popOutAtRect`
   *  (`liftSpawnRect` in float-policy), not through this handoff. */
  expandToContent?: boolean;
}

let activeTarget: CardLiftTarget | null = null;
const targetListeners = new Set<() => void>();

export function setCardLiftTarget(target: CardLiftTarget | null) {
  const sameRect = (a?: CardLiftRect, b?: CardLiftRect) =>
    (!a && !b) ||
    (!!a && !!b &&
      a.left === b.left && a.top === b.top &&
      a.width === b.width && a.height === b.height);
  const same =
    activeTarget === target ||
    (!!activeTarget && !!target &&
      activeTarget.cardKey === target.cardKey &&
      sameRect(activeTarget.rect, target.rect));
  if (same) return;
  activeTarget = target;
  targetListeners.forEach((l) => l());
}

/** How long a lift's outline pulse holds before it fades out. */
export const CARD_LIFT_PULSE_MS = 150;

let pulseTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Clear the target only if it is still `expected` — a NEWER lift's target is
 * not this caller's to clear. Mirrors the omni pin store's `clearPin`
 * identity guard.
 */
export function clearCardLiftTarget(expected: CardLiftTarget) {
  if (activeTarget !== expected) return;
  setCardLiftTarget(null);
}

/**
 * Show `target`'s lift outline for {@link CARD_LIFT_PULSE_MS}, then fade it.
 *
 * The clear timer is the STORE's, not the lifted card's (task 1619): the lift
 * pops the card out, which UNMOUNTS the docked card on the next render — so a
 * timer owned by the card's view lifetime would be disposed before it fired
 * and the outline would stick. One pending clear at a time: a newer pulse
 * replaces it, and the clear is identity-guarded, so an earlier lift's fade
 * can never wipe a later lift's outline.
 */
export function pulseCardLiftTarget(target: CardLiftTarget) {
  if (pulseTimer !== null) clearTimeout(pulseTimer);
  setCardLiftTarget(target);
  // `activeTarget` may be an equal pre-existing object (setCardLiftTarget
  // bails on an equal rect), so guard on what the store actually holds.
  const held = activeTarget;
  pulseTimer = setTimeout(() => {
    pulseTimer = null;
    if (held) clearCardLiftTarget(held);
  }, CARD_LIFT_PULSE_MS);
}

export function getCardLiftTarget(): CardLiftTarget | null {
  return activeTarget;
}

export function useCardLiftTarget(): CardLiftTarget | null {
  const [t, setT] = useState<CardLiftTarget | null>(activeTarget);
  useEffect(() => {
    const sub = () => setT(getCardLiftTarget());
    targetListeners.add(sub);
    return () => {
      targetListeners.delete(sub);
    };
  }, []);
  return t;
}

let pendingHandoff: CardLiftHandoff | null = null;

export function setCardLiftHandoff(h: CardLiftHandoff | null) {
  pendingHandoff = h;
}

/**
 * Read-and-clear the handoff if it matches the given cardKey. FloatCard
 * calls this on mount so the spawned float picks up the in-flight drag
 * exactly once. Non-matching handoffs are left alone (a different
 * card's float is mounting concurrently — unlikely, but safe).
 */
export function consumeCardLiftHandoff(cardKey: string): CardLiftHandoff | null {
  if (pendingHandoff && pendingHandoff.cardKey === cardKey) {
    const h = pendingHandoff;
    pendingHandoff = null;
    return h;
  }
  return null;
}
