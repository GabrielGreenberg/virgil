import type { PanelId } from "@/hooks/useViewPrefs";
import type { SelectionsContextValue } from "./contexts/selections";

/**
 * Map a panel id to its "which card is currently selected" state slot
 * plus the CSS selector used to find that card's DOM node. Used by the
 * strip-button click handler to auto-scroll to the selected card when a
 * panel is opened via its strip icon (e.g. pick a citation in Omni,
 * then click the Citations strip icon — Citations panel opens scrolled
 * to that citation).
 *
 * Returns null for panels with no selection concept (search, outline,
 * wordcount, cutter, revisions, errors, suggestions, bibliography,
 * omni, blank).
 */
export function getPanelSelection(
  panelId: PanelId,
  s: SelectionsContextValue,
): { selectedId: string; selector: string } | null {
  const id = panelSelectedId(panelId, s);
  if (!id) return null;
  const selector = panelSelector(panelId, id);
  if (!selector) return null;
  return { selectedId: id, selector };
}

function panelSelectedId(panelId: PanelId, s: SelectionsContextValue): string | null {
  switch (panelId) {
    case "footnotes": return s.selectedFootnoteId;
    case "citations": return s.selectedCitationId;
    case "archive": return s.selectedArchiveId;
    case "notes": return s.selectedNoteId;
    case "todo": return s.selectedTodoId;
    default: return null;
  }
}

function panelSelector(panelId: PanelId, id: string): string | null {
  // Panels render different DOM in list vs in-text view modes. Citations
  // emit `data-link-card` in both modes; the others emit their own
  // `data-<kind>-entry` always, plus `data-link-card` in in-text mode
  // for footnotes. We OR them so either mode resolves.
  switch (panelId) {
    case "footnotes":
      return `[data-footnote-entry="${id}"], [data-link-card="footnote:${id}"]`;
    case "citations":
      return `[data-link-card="citation:${id}"]`;
    case "archive":
      return `[data-archive-entry="${id}"]`;
    case "notes":
      return `[data-note-entry="${id}"]`;
    case "todo":
      return `[data-todo-entry="${id}"]`;
    default:
      return null;
  }
}
