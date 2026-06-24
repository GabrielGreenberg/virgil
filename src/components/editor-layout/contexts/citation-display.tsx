"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";

/**
 * Citation helpers shared by panels that host rich-text mini-editors
 * (notes, footnotes, archive, reports) and need to render citation
 * nodes or accept dropped citation commands.
 *
 * - `getCitationDisplayText(command)` resolves a `\cite{key}` to the
 *   display string per the current citation style (e.g. `[1]`).
 * - `onCitationCreated(command)` registers a brand-new citation so its
 *   card shows up in the citations panel, and returns the stable id +
 *   display for the mini-editor's Citation node to attach.
 * - `getRefDisplayText(label, refCommand)` resolves a `\ref`/`\getref`/
 *   `\getfullref` to its display number against the MAIN doc — the
 *   labelRef sibling of `getCitationDisplayText`. A footnote/note body
 *   owns no headings/examples/figures, and the doc-level ref-display
 *   pass (editor-extensions.ts) can't recurse into a footnote's opaque
 *   sub-doc, so a freshly-RELOADED footnote-nested ref would render as
 *   "??" without this. Returns null when no provider can resolve it
 *   (caller keeps whatever displayText it already had).
 */
export interface CitationDisplayContextValue {
  getCitationDisplayText: (command: string) => string;
  onCitationCreated: (command: string) => { id: string; displayText: string };
  getRefDisplayText?: (label: string, refCommand: string) => string | null;
}

const CitationDisplayCtx = createContext<CitationDisplayContextValue | null>(null);

export function CitationDisplayProvider({
  value,
  children,
}: {
  value: CitationDisplayContextValue;
  children: ReactNode;
}) {
  // Both host mounts (EditorLayout/EditorPane) pass an inline object literal,
  // so memoize here on the two function identities — otherwise every host
  // render gives the context a new identity and re-renders every consumer
  // (each BorrowedMainText card body) past its memo barriers. The callbacks
  // are useCallback-stable, keyed on bib data, so identity changes only when
  // resolution would actually differ.
  const memoValue = useMemo(
    () => value,
    [value.getCitationDisplayText, value.onCitationCreated, value.getRefDisplayText],
  );
  return <CitationDisplayCtx.Provider value={memoValue}>{children}</CitationDisplayCtx.Provider>;
}

export function useCitationDisplayContext(): CitationDisplayContextValue {
  const v = useContext(CitationDisplayCtx);
  if (!v) throw new Error("useCitationDisplayContext must be used inside CitationDisplayProvider");
  return v;
}

/** Nullable variant for consumers that must also render OUTSIDE a provider
 *  (e.g. `BorrowedMainText`, which mounts in reader/float surfaces too).
 *  Returns null instead of throwing when no provider is above. */
export function useCitationDisplayContextOrNull(): CitationDisplayContextValue | null {
  return useContext(CitationDisplayCtx);
}
