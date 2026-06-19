"use client";

/**
 * Card-archive ACTIONS context — the per-card archive/unarchive operation +
 * archived-state lookup, consumed directly by `EditableCard` so every card
 * self-wires its archive button without each card component / host / panel
 * threading an `onArchive` prop.
 *
 * The provider (EditorPane) keeps this value's IDENTITY STABLE across card
 * edits: `isArchived` reads a ref that EditorPane refreshes each render, so a
 * card-body keystroke never changes the context value and never broadly
 * re-renders every card (the codebase's per-card memoization is preserved). A
 * card flips its own archived glyph because IT re-renders when its own sidecar
 * record changes, at which point `isArchived(id)` reads the fresh ref.
 *
 * Wholly distinct from the text-object Archive PANEL.
 */

import { createContext, useContext, type ReactNode } from "react";
import type { CardKind } from "@/cards/types";

export interface CardArchiveActionsApi {
  /** Whether per-card archiving is actually wired (a real provider is present).
   *  EditableCard hides the archive affordance when false (tests / Reader). */
  enabled: boolean;
  /** Whether the card with this id is currently archived. Stable identity —
   *  reads a ref, see the module doc. */
  isArchived: (id: string) => boolean;
  /** Toggle a card's archived state. For footnote/citation this splices the
   *  inline atom out of the doc (behind a confirm, unless suppressed) when
   *  archiving, and does NOT re-insert it when unarchiving. */
  archive: (kind: CardKind, id: string) => void;
}

const DEFAULT: CardArchiveActionsApi = {
  enabled: false,
  isArchived: () => false,
  archive: () => {},
};

const CardArchiveActionsContext = createContext<CardArchiveActionsApi>(DEFAULT);

export function CardArchiveActionsProvider({
  value,
  children,
}: {
  value: CardArchiveActionsApi;
  children: ReactNode;
}) {
  return (
    <CardArchiveActionsContext.Provider value={value}>
      {children}
    </CardArchiveActionsContext.Provider>
  );
}

export function useCardArchiveActions(): CardArchiveActionsApi {
  return useContext(CardArchiveActionsContext);
}
