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

import type { PanelId } from "@/hooks/useViewPrefs";
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
