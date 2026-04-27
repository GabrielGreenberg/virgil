"use client";

import { createContext, useContext } from "react";

/**
 * Thread-safe, tree-global access to the per-card popout state managed by
 * `useViewPrefs`. Wrapper cards (NoteCard, FootnoteCard, etc.) read this
 * context to:
 *   1. Skip their in-list render when popped (so `<FloatingCards>` can own
 *      the single render of the card inside a `FloatingPanel`).
 *   2. Wire up their `onTogglePopout` button handler without requiring
 *      every host panel to thread props through.
 *
 * Card keys are shaped `${kind}:${id}` where `kind` discriminates the card
 * variant (e.g. `note`, `footnote`, `archive`, `cut`, `todo`, `bib`,
 * `citation`, `revision`, `quotation`, `ai`).
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
  close: (key: string) => void;
  /** Saved position/size for a card, if any. */
  getFloatPosition: (key: string) => CardRect | undefined;
  /** Persist a new position/size for a card. */
  setFloatPosition: (key: string, rect: CardRect) => void;
  /** Mark a popped card as the most recently focused floating window (for Cmd-W). */
  recordFocus?: (key: string) => void;
}

export const PoppedCardsContext = createContext<PoppedCardsValue | null>(null);

/** Returns null when no provider is mounted — callers should tolerate that. */
export function usePoppedCards(): PoppedCardsValue | null {
  return useContext(PoppedCardsContext);
}
