"use client";

import { createContext, useContext, type ReactNode } from "react";

/**
 * OmniContext — signals that a card is being rendered inside OmniViewPanel.
 *
 * The same card components render in two places: their native panel and
 * the mixed OmniView. Cards consult `useInOmni()` to decide whether to
 * show the type-label overline (e.g. "Citation", "Footnote") that helps
 * disambiguate cards in the mixed view.
 *
 * `null` (no provider) ⇒ rendered in a native panel.
 */
export interface OmniContextValue {
  side: "left" | "right";
}

const OmniCtx = createContext<OmniContextValue | null>(null);

export function OmniProvider({
  value,
  children,
}: {
  value: OmniContextValue;
  children: ReactNode;
}) {
  return <OmniCtx.Provider value={value}>{children}</OmniCtx.Provider>;
}

/** Returns the OmniContext value if rendered inside OmniViewPanel, else null. */
export function useInOmni(): OmniContextValue | null {
  return useContext(OmniCtx);
}
