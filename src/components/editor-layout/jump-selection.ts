/**
 * Total selection dispatch for the SearchHost cross-panel "jump to item".
 *
 * `openItemInPanel` (EditorPane) used to fan out to the per-kind selection
 * setters through a hand-written if-ladder — the same silently-dropped-scope
 * shape that `SCOPE_DISPATCH` (scope-dispatch.ts) retired on the search side
 * (SR-F3-02): a panel with a chip, a label, and a search function whose jump
 * never selected anything. `reports` was the repeat victim on BOTH ladders.
 *
 * `JumpSelectionSetters` is a `Record` over `SearchJumpPanel | "examples"` —
 * a TOTAL map. TypeScript fails the build if a panel is added to
 * `SCOPE_PANEL` (search-sources.ts) without a selection setter here, so the
 * omission is a compile error, not a runtime dead click. `"examples"` rides
 * along because it shares the jump path (the Omni host writes the same
 * selection slot) without being a search scope.
 */

import type { CardArchiveView, PanelId } from "@/hooks/useViewPrefs";
import { SCOPE_PANEL, type SearchJumpPanel } from "@/lib/search-sources";

/** Every panel the cross-panel jump can land a selection in. */
export type JumpSelectionPanel = SearchJumpPanel | "examples";

/** One selection setter per jump-landable panel — total, compile-enforced. */
export type JumpSelectionSetters = Record<
  JumpSelectionPanel,
  (id: string) => void
>;

/** Runtime enumeration of `JumpSelectionPanel` (for tests / totality pins).
 *  The filter only narrows the Partial-record value type — SCOPE_PANEL holds
 *  no undefined values at runtime. */
export const JUMP_SELECTION_PANELS: readonly JumpSelectionPanel[] = [
  ...new Set(
    Object.values(SCOPE_PANEL).filter((p): p is SearchJumpPanel => p != null),
  ),
  "examples",
];

/** The selection setter for a jump target, or null for panels without a
 *  native selection slot (mainText/heading hits pass no panel; shell ids
 *  like "omni"/"search"/"blank" aren't selection targets). */
export function jumpSelectionFor(
  setters: JumpSelectionSetters,
  panel: PanelId,
): ((id: string) => void) | null {
  const partial: Partial<Record<PanelId, (id: string) => void>> = setters;
  return partial[panel] ?? null;
}

/**
 * The archive-view half of landing a jump on a VISIBLE card (task 118).
 *
 * A card panel renders its list through the panel's archive view
 * (`CardListPanel` → `filterByArchiveView`), and the jump's selection setter
 * doesn't change that view — so selecting an archived card while the panel
 * shows "View Active" (the archived-search-hit case), or an active card while
 * it shows "View Archives", lands the selection on a card the panel doesn't
 * render: a silent dead click. This decides the view the jump must switch the
 * target panel to BEFORE selecting, or null when the target is already
 * visible under `view`.
 *
 * Widens to "all" (not the target's own state) so the landed card keeps its
 * neighbors for context; an "all" view is never narrowed. Pure — the caller
 * (`openItemInPanel`) supplies the panel's current view and the target's
 * archived state from the cross-panel `archivedIds` SSOT, so EVERY jump
 * caller gets the guarantee, not just search.
 */
export function planJumpArchiveView(
  view: CardArchiveView,
  targetArchived: boolean,
): CardArchiveView | null {
  const visible = view === "all" || (view === "archived") === targetArchived;
  return visible ? null : "all";
}
