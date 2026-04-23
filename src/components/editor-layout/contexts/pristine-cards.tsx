"use client";

import { createContext, useContext, type ReactNode } from "react";
import type {
  CardKind,
  PristineCardManager,
  PristineKindApi,
} from "@/hooks/usePristineCardManager";

/**
 * Provides the app-level pristine-card manager. Card hooks read this to
 * mark newly-created blank cards and register discard callbacks; the
 * click-away watcher inside the manager triggers those callbacks when the
 * user clicks outside the card's DOM.
 */
const PristineCardsCtx = createContext<PristineCardManager | null>(null);

export function PristineCardsProvider({
  value,
  children,
}: {
  value: PristineCardManager;
  children: ReactNode;
}) {
  return <PristineCardsCtx.Provider value={value}>{children}</PristineCardsCtx.Provider>;
}

export function usePristineCardsContext(): PristineCardManager | null {
  return useContext(PristineCardsCtx);
}

export function usePristineKind(kind: CardKind): PristineKindApi | null {
  const mgr = useContext(PristineCardsCtx);
  return mgr ? mgr.forKind(kind) : null;
}
