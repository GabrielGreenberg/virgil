"use client";

import { useEffect } from "react";
import { linkIdSelector, linkKindSelector } from "@/links/link-dom-contract";
import { VIEW_ONLY_CLASS } from "@/lib/view-only-chrome";

/** The bib-panel cross-highlight ring on an in-editor citation. VIEW state
 *  (which entry is selected in a panel), never document content — so every
 *  write of it pairs with `VIEW_ONLY_CLASS`. */
export const CITATION_HIGHLIGHT_BIB_CLASS = "citation-highlight-bib";

/** The slice of a pane citation this needs: its id and the cite keys it names. */
export interface BibHighlightCitation {
  citationId: string;
  keys: string[];
}

/**
 * Ring every in-text citation that cites the selected Bibliography entry.
 *
 * PANE-OWNED (task 870). The bib selection is per-pane state (`EditorPane`'s
 * `selectedBibKey`, written by the Bibliography panel and the bib float), so
 * the painter lives with it and paints only inside `root` — the pane's own
 * editor DOM. It used to live in EditorLayout, driven by a SHELL copy of
 * `selectedBibKey` that no panel wrote, so the ring never appeared; and it
 * queried `document`, so with two panes mounted it could ring a citation in a
 * hidden pane.
 *
 * Cost: runs only when the selection, the pane's citation list (gated on the
 * `citations` structural revision), or the root changes — never per keystroke.
 */
export function useBibCitationHighlight(
  root: HTMLElement | null,
  citations: readonly BibHighlightCitation[],
  selectedBibKey: string | null,
): void {
  useEffect(() => {
    if (!root || !selectedBibKey) return;
    const els: HTMLElement[] = [];
    for (const c of citations) {
      if (!c.keys.includes(selectedBibKey)) continue;
      const el = root.querySelector<HTMLElement>(
        `${linkKindSelector("citation")}${linkIdSelector(c.citationId)}`,
      );
      if (!el) continue;
      // Needed even though the print block already flattens
      // `.citation-node`'s background with `!important`: that flatten leaves
      // the 2px ring standing, so the view-only marker carries it (task 523).
      el.classList.add(CITATION_HIGHLIGHT_BIB_CLASS, VIEW_ONLY_CLASS);
      els.push(el);
    }
    return () => {
      for (const el of els) {
        el.classList.remove(CITATION_HIGHLIGHT_BIB_CLASS, VIEW_ONLY_CLASS);
      }
    };
  }, [root, citations, selectedBibKey]);
}
