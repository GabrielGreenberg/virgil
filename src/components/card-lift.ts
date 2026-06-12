"use client";

import { useEffect, useState } from "react";

/**
 * Shared signal for the card lift-off gesture (drag a docked card out of
 * its panel to spawn a popped-out floater). Two pieces of state:
 *
 *   - `liftTarget`: which card's bounding rect the lift outline should
 *     highlight. Set when the drag-out gesture crosses the activation
 *     threshold; cleared shortly after to drive the fade-out.
 *   - `liftHandoff`: one-shot drag handoff payload consumed by the
 *     freshly-mounted FloatingPanel. Lets the spawned float pick up the
 *     ongoing mouse drag at the cursor's current position so the user
 *     experiences a single continuous gesture from card-grab to
 *     float-drop.
 *
 * Module-level (not React Context) because the producer (PanelCard's
 * lift gesture) and consumers (CardLiftOutline + FloatCard) live in
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
