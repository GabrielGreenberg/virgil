"use client";

import { createContext, useContext, type CSSProperties, type ReactNode } from "react";
import type { PanelKind } from "@/panels/_shared/types";
import {
  DEFAULT_PANEL_TYPOGRAPHY,
  type PanelBodyKey,
} from "@/lib/panel-typography";
import { usePanelBodyStyle } from "@/hooks/usePanelTypography";

/** Map from PanelKind (the canonical panel id) to the matching body-text
 *  typography key. Panels missing from this map have no card body text
 *  whose size can be tuned (Outline, Search, WordCount, Errors, Omni). */
const KIND_TO_BODY_KEY: Partial<Record<PanelKind, PanelBodyKey>> = {
  notes: "note",
  footnotes: "footnote",
  archive: "archive",
  cutter: "cut",
  revisions: "revision",
  todo: "todo",
  reports: "report",
  citations: "citation",
  bibliography: "bib",
  examples: "example",
};

export function bodyKeyForKind(kind: PanelKind | null | undefined): PanelBodyKey | null {
  if (!kind) return null;
  return KIND_TO_BODY_KEY[kind] ?? null;
}

const PanelKindContext = createContext<PanelKind | null>(null);

export function PanelKindProvider({ kind, children }: { kind: PanelKind; children: ReactNode }) {
  return <PanelKindContext.Provider value={kind}>{children}</PanelKindContext.Provider>;
}

/** Returns the PanelBodyKey for the enclosing Panel, or null when there's
 *  no enclosing Panel or the panel has no card body typography. */
export function useEnclosingPanelBodyKey(): PanelBodyKey | null {
  const kind = useContext(PanelKindContext);
  if (!kind) return null;
  return KIND_TO_BODY_KEY[kind] ?? null;
}

/** Returns inline CSS variables (`--panel-body-fontsize`, etc.) for the
 *  given panel's body typography. Used by `CardListPanel` to scope a
 *  font-size override per panel kind so per-panel cards don't each have
 *  to consume the typography hook themselves. The matching CSS rules in
 *  `globals.css` apply the variable to descendant text body elements
 *  within `.panel-body-typo`. */
export function usePanelBodyVarsForKind(kind: PanelKind | null | undefined): CSSProperties | undefined {
  const key = bodyKeyForKind(kind);
  const style = usePanelBodyStyle(key ?? undefined);
  if (!key) return undefined;
  // Only the fontsize vars have consumers in globals.css — family/color are
  // applied inline by the cards themselves (usePanelBodyStyle), so no
  // --panel-body-fontfamily / --panel-body-color vars are written here.
  const vars: Record<string, string> = {};
  if (style.fontSize) vars["--panel-body-fontsize"] = String(style.fontSize);
  vars["--panel-body-fontsize-default"] = `${DEFAULT_PANEL_TYPOGRAPHY[key].fontSize}px`;
  return vars as CSSProperties;
}
