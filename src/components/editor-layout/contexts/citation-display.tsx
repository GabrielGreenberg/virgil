"use client";

import { createContext, useContext, type ReactNode } from "react";

/**
 * Citation helpers shared by panels that host rich-text mini-editors
 * (notes, footnotes, archive, quotations) and need to render citation
 * nodes or accept dropped citation commands.
 *
 * - `getCitationDisplayText(command)` resolves a `\cite{key}` to the
 *   display string per the current citation style (e.g. `[1]`).
 * - `onCitationCreated(command)` registers a brand-new citation so its
 *   card shows up in the citations panel, and returns the stable id +
 *   display for the mini-editor's Citation node to attach.
 */
export interface CitationDisplayContextValue {
  getCitationDisplayText: (command: string) => string;
  onCitationCreated: (command: string) => { id: string; displayText: string };
}

const CitationDisplayCtx = createContext<CitationDisplayContextValue | null>(null);

export function CitationDisplayProvider({
  value,
  children,
}: {
  value: CitationDisplayContextValue;
  children: ReactNode;
}) {
  return <CitationDisplayCtx.Provider value={value}>{children}</CitationDisplayCtx.Provider>;
}

export function useCitationDisplayContext(): CitationDisplayContextValue {
  const v = useContext(CitationDisplayCtx);
  if (!v) throw new Error("useCitationDisplayContext must be used inside CitationDisplayProvider");
  return v;
}
