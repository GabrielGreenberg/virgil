/**
 * Pure planning for the SearchHost cross-panel "jump to item" dock.
 *
 * `openItemInPanel` (EditorPane) selects the target item, then docks its panel
 * into the live `dockStack` so the jump actually surfaces it — the bug this
 * replaced only set a retired `activeLeftPanelKind` model that nothing renders
 * from, so the target never opened.
 *
 * The target docks on its placed/registry side (mirroring `resolveSide` in
 * `useViewPrefs`). When the search panel is itself docked on that SAME side it
 * is touched FIRST so the target's dock-open evicts the least-recently-used
 * band rather than search — the user is actively reading results from it.
 *
 * (Pre-485 this comment ended "in the Library Reader the search panel is never
 * docked, so `dockedSideOf(prefs,"search")` is null and only the target
 * docks." That is no longer true — `READER_CHROME` whitelists `search` — and
 * nothing here had to change for it: the rule reads the LIVE `dockStack`, so
 * the reader now takes the same both-docked branch the main app does. The
 * sentence is corrected rather than deleted because a comment describing a
 * premise the code no longer has is how the next reader concludes a branch is
 * unreachable.)
 *
 * Returned as an ordered list of `(id, side)` docks for the caller to apply via
 * `openPanelDocked`, so the side math stays unit-testable without rendering the
 * (very large) `EditorPane`.
 */
import type { PanelId, Side, ViewPrefs } from "@/hooks/useViewPrefs";
import { dockedSideOf } from "@/hooks/view-prefs-derived";
import { PANEL_REGISTRY } from "@/panels/panel-registry";

/** The side a jump-target panel docks on: its explicit placement, else its
 *  registry default, else "left" (matches `resolveSide`'s fallback chain). */
export function jumpTargetSide(prefs: ViewPrefs, panel: PanelId): Side {
  return (
    prefs.placements.find((pl) => pl.id === panel)?.side ??
    (PANEL_REGISTRY as Record<string, { defaultStripSide?: Side }>)[panel]
      ?.defaultStripSide ??
    "left"
  );
}

/** Ordered docks for a cross-panel jump: search first (only when it shares the
 *  target's side, so the LRU eviction doesn't drop it), then the target. */
export function planJumpDocks(
  prefs: ViewPrefs,
  panel: PanelId,
): Array<{ id: PanelId; side: Side }> {
  const targetSide = jumpTargetSide(prefs, panel);
  const searchSide = dockedSideOf(prefs, "search");
  const ops: Array<{ id: PanelId; side: Side }> = [];
  if (searchSide && searchSide === targetSide) {
    ops.push({ id: "search", side: searchSide });
  }
  ops.push({ id: panel, side: targetSide });
  return ops;
}
