import type { PanelId } from "@/hooks/useViewPrefs";
import type { SelectionsContextValue } from "./contexts/selections";
// Neither the attribute NAME nor the `<cardKind>:<cardId>` token is spelled
// here: a query that restates either is a second speller that silently stops
// matching if the contract ever changes (task 202 → 204).
import { linkCardSelector } from "@/links/link-dom-contract";

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
  const selector = panelEntrySelector(panelId, id);
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

/**
 * The DOM address of one panel's card, by panel + entity id.
 *
 * Exported because `marker-clicks.ts` needs the SAME answer for its
 * `openForCard({ entrySelector })` calls and used to hand-copy two of these
 * rows byte-for-byte — a duplicated *composite* address, which drifts in the
 * way selectors always do: silently, by not matching (task 204).
 */
export function panelEntrySelector(panelId: PanelId, id: string): string | null {
  // Panels render different DOM in list vs in-text view modes. Citations
  // emit `data-link-card` in both modes; the others emit their own
  // `data-<kind>-entry` always, plus `data-link-card` in in-text mode
  // for footnotes. We OR them so either mode resolves.
  switch (panelId) {
    case "footnotes":
      return `[data-footnote-entry="${id}"], ${linkCardSelector("footnote", id)}`;
    case "citations":
      return linkCardSelector("citation", id);
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
