"use client";

/**
 * Card-RESTORE actions context — the "put this card's excerpt back into the
 * document" operation, consumed directly by `EditableCard` so every excerpt
 * card self-wires its restore affordance.
 *
 * Sibling of `card-archive-actions.tsx`, and deliberately the SAME shape: a
 * context, not a prop. The bug this replaces (task 106) is what happens when a
 * card action is threaded instead — `onInsert`/`onRestore` were declared on
 * `ArchivePanelProps`, drilled through `EditorPane → ArchiveHost →
 * ArchivePanel`, and never destructured in the panel body. Every layer
 * type-checked, the handlers were live, and the feature simply did not exist:
 * there was no way to un-archive text at all. Types can prove a prop was
 * PASSED; nothing proves it was USED. A context can't dead-end that way,
 * because the consumer is the renderer.
 *
 * Membership is registry-derived (`isExcerptCardKind`) rather than a per-panel
 * decision — see the predicate's note on why capture and restore are two
 * directions of one declaration.
 *
 * Wholly distinct from the per-card ARCHIVED (set-aside) flag, which is the
 * other context: that hides a card inside its panel, this hands its content
 * back to the prose and retires the card.
 */

import { createContext, useContext, type ReactNode } from "react";
import type { CardKind } from "@/cards/types";

export interface CardRestoreActionsApi {
  /** Whether restore-to-document is actually available here. `EditableCard`
   *  hides the affordance when false: tests mount no provider at all, and the
   *  restricted chromes that CAN mount one (the Library Reader hosts this same
   *  EditorPane) set it false, since a read-only editor swallows the insert and
   *  the control could only ever fail. */
  enabled: boolean;
  /** Hand the card's excerpt back to the document at the caret and drop the
   *  card. A NO-OP unless the content lands: the card body is the only copy of
   *  prose that was deleted from the document, so an insert that the schema
   *  refuses, or that a read-only host swallows, must leave the card standing
   *  (the host notifies). */
  restore: (kind: CardKind, id: string) => void;
}

const DEFAULT: CardRestoreActionsApi = {
  enabled: false,
  restore: () => {},
};

const CardRestoreActionsContext = createContext<CardRestoreActionsApi>(DEFAULT);

export function CardRestoreActionsProvider({
  value,
  children,
}: {
  value: CardRestoreActionsApi;
  children: ReactNode;
}) {
  return (
    <CardRestoreActionsContext.Provider value={value}>
      {children}
    </CardRestoreActionsContext.Provider>
  );
}

export function useCardRestoreActions(): CardRestoreActionsApi {
  return useContext(CardRestoreActionsContext);
}
