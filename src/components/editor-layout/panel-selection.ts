import type { PanelId } from "@/hooks/useViewPrefs";
import type { CardKind } from "@/panels/_shared/types";
import type { SelectionsContextValue } from "./contexts/selections";
import { panelForCardKind } from "@/cards/predicates";
import { cardDomSelector } from "@/panels/panel-registry";
// Neither the attribute NAME nor the `<cardKind>:<cardId>` token is spelled
// here: a query that restates either is a second speller that silently stops
// matching if the contract ever changes (task 202 → 204).
import { linkCardSelector } from "@/links/link-dom-contract";

/**
 * "Which card is selected in this panel, and where is it in the DOM" — the
 * strip-button click handler's question when a panel is opened via its strip
 * icon (pick a report in Omni, click the Reports strip icon → the Reports
 * panel opens scrolled to that report).
 *
 * DERIVED, not listed (task 1172): the selected card is the store's ONE
 * `selected {kind,id}`, and it belongs to `panelId` exactly when the registry
 * SSOT says so (`panelForCardKind(kind) === panelId`). So every polymorphic
 * panel (notes ⇄ highlight, reports ⇄ report-request, cutter/revisions
 * comment ⇄ suggestion) and every panel added later is covered without a
 * per-panel switch — the hand switch this replaced covered five panels and
 * silently skipped Reports, Cutter, Revisions, Examples and highlights.
 *
 * Returns null when nothing is selected or the selection belongs to another
 * panel (or to no panel at all).
 */
export function getPanelSelection(
  panelId: PanelId,
  s: Pick<SelectionsContextValue, "selected">,
): { selectedId: string; selector: string } | null {
  const sel = s.selected;
  if (!sel) return null;
  if (panelForCardKind(sel.kind) !== panelId) return null;
  return { selectedId: sel.id, selector: cardEntrySelector(sel.kind, sel.id) };
}

/** The per-kind addresses a card is ALSO reachable at, beyond the canonical
 *  `data-card-key` every shell card stamps (`useAnchoredCardShell` →
 *  `PanelCard`). The ONE override table — `marker-clicks.ts` reads it through
 *  {@link cardEntrySelector} rather than keeping its own (task 1172 retired
 *  its `ENTRY_SELECTOR_BASE_OVERRIDE`, a second hand table with different
 *  coverage from the switch that used to live here).
 *
 *  - footnote / citation: the in-text view mode renders `data-link-card`
 *    rather than the shell card, so the link-card address is load-bearing.
 *  - the `data-<kind>-entry` rows: the legacy hook attribute those cards still
 *    stamp (`EditableCard`'s `dataAttr`); OR'd so a list renderer that carries
 *    only the legacy attribute still resolves. */
const EXTRA_ENTRY_ADDRESS: Partial<Record<CardKind, (id: string) => string>> = {
  footnote: (id) => `[data-footnote-entry="${id}"], ${linkCardSelector("footnote", id)}`,
  citation: (id) => linkCardSelector("citation", id),
  note: (id) => `[data-note-entry="${id}"]`,
  archive: (id) => `[data-archive-entry="${id}"]`,
  todo: (id) => `[data-todo-entry="${id}"]`,
  report: (id) => `[data-report-entry="${id}"]`,
  "report-request": (id) => `[data-report-request-entry="${id}"]`,
};

/**
 * The DOM address of card `(kind, id)` — the ONE answer, for every kind:
 * `cardDomSelector(kind, id)` OR'd with that kind's extra address, if any.
 *
 * Exported because `marker-clicks.ts` needs the SAME answer for its
 * `openForCard({ entrySelector })` calls and used to hand-copy rows of it — a
 * duplicated *composite* address, which drifts the way selectors always do:
 * silently, by not matching (task 204, again task 1172).
 */
export function cardEntrySelector(kind: CardKind, id: string): string {
  const extra = EXTRA_ENTRY_ADDRESS[kind];
  const canonical = cardDomSelector(kind, id);
  return extra ? `${canonical}, ${extra(id)}` : canonical;
}
