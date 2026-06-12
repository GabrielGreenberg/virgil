"use client";

import { createContext, useContext } from "react";

/**
 * Thread-safe, tree-global access to the per-card popout state managed by
 * `useViewPrefs`. Consumers:
 *   - `PanelCard`'s lift gesture spawns floats via `popOutAtRect`; cards
 *     without `onTogglePopout` threading still get popout this way.
 *   - The float dispatcher (`FloatHost`/`FloatWindow`) iterates
 *     `poppedKeys` and reads/writes float rects.
 *
 * Pop residue: a popped card's DOCKED render stays fully live in its panel
 * — the float is a second presence of the same card, not a relocation.
 * Cards must NOT skip their in-list render while popped (the historical
 * `isPopped(...) → return null` pattern was removed in ba90bd9).
 *
 * Card keys use the unified float grammar `float:card:<kind>:<id>`, built
 * ONLY via `cardPopKey`/`popKey` (panel-registry) → `buildFloatKey`
 * (floats/float-key). Text-object floats share the store with
 * `float:textobject:<kind>:<id>` keys.
 */
export interface CardRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PoppedCardsValue {
  /** Ordered list of popped card keys — used by FloatCard to stagger defaults. */
  poppedKeys: string[];
  isPopped: (key: string) => boolean;
  toggle: (key: string) => void;
  /** Toggle popout state, but on the docked → popped transition spawn the
   *  float near the supplied anchor rect (typically the docked card's
   *  bounding rect). Re-dock branch ignores the anchor. */
  toggleAtAnchor: (key: string, anchor: DOMRect | null) => void;
  /** Pop out a card with the float positioned at exactly the given rect.
   *  Used by the lift-off drag gesture (PanelCard) to spawn the float
   *  under the cursor for a continuous drag handoff. No-op if already
   *  popped. */
  popOutAtRect: (key: string, rect: CardRect) => void;
  close: (key: string) => void;
  /** Saved position/size for a card, if any. */
  getFloatPosition: (key: string) => CardRect | undefined;
  /** Persist a new position/size for a card. */
  setFloatPosition: (key: string, rect: CardRect) => void;
  /** Mark a popped card as the most recently focused floating window (for Cmd-W). */
  recordFocus?: (key: string) => void;
  /** Paint z-index for a float, derived from the MRU focus stack (raise-on-click).
   *  Omitted in the Reader shim → FloatWindow falls back to insertion order. */
  floatZIndex?: (key: string) => number;
}

export const PoppedCardsContext = createContext<PoppedCardsValue | null>(null);

/** Returns null when no provider is mounted — callers should tolerate that. */
export function usePoppedCards(): PoppedCardsValue | null {
  return useContext(PoppedCardsContext);
}
