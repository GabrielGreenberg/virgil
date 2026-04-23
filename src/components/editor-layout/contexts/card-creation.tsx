"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { CardCreationApi } from "../card-actions/card-creation";

/**
 * Exposes the centralized card-creation API (see `useCardCreation`) to any
 * descendant of the editor layout. Panel hosts, card-action handlers, and
 * toolbar buttons all read this instead of calling per-hook `add*` methods
 * directly, so the "mark pristine / set selection / open panel / pop
 * floating wrapper" chores stay consistent.
 */
const CardCreationCtx = createContext<CardCreationApi | null>(null);

export function CardCreationProvider({
  value,
  children,
}: {
  value: CardCreationApi;
  children: ReactNode;
}) {
  return <CardCreationCtx.Provider value={value}>{children}</CardCreationCtx.Provider>;
}

export function useCardCreationContext(): CardCreationApi {
  const v = useContext(CardCreationCtx);
  if (!v) throw new Error("useCardCreationContext must be used inside CardCreationProvider");
  return v;
}

export function useOptionalCardCreationContext(): CardCreationApi | null {
  return useContext(CardCreationCtx);
}
