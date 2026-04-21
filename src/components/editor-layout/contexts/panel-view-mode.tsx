"use client";

import { createContext, useContext, type ReactNode } from "react";

type ViewMode = "list" | "in-text";

/**
 * Persisted per-panel list/in-text view toggle. The shell owns the
 * backing map (localStorage-backed) and exposes a getter/setter pair
 * keyed by panel id.
 */
export interface PanelViewModeContextValue {
  getPanelViewMode: (panelId: string) => ViewMode;
  setPanelViewMode: (panelId: string, mode: ViewMode) => void;
}

const PanelViewModeCtx = createContext<PanelViewModeContextValue | null>(null);

export function PanelViewModeProvider({
  value,
  children,
}: {
  value: PanelViewModeContextValue;
  children: ReactNode;
}) {
  return <PanelViewModeCtx.Provider value={value}>{children}</PanelViewModeCtx.Provider>;
}

export function usePanelViewModeContext(): PanelViewModeContextValue {
  const v = useContext(PanelViewModeCtx);
  if (!v) throw new Error("usePanelViewModeContext must be used inside PanelViewModeProvider");
  return v;
}
