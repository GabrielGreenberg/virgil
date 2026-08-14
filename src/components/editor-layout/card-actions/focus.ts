import { useCallback } from "react";
import type { useFocusMode } from "@/hooks/useFocusMode";
import type { BlockAddress } from "@/lib/tiptap/block-address";

type FocusMode = ReturnType<typeof useFocusMode>;
type FocusHeading = { index: number; level: number };

/**
 * Focus-mode action handlers. Thin forwarders that thread the outline
 * heading list and total block count into the focus-mode hook — those
 * two arguments are shared by ALL the section-aware mutations (activate /
 * moveTo / expandTo / snapBoundary) and live in the shell because they're
 * derived from the latest doc snapshot. `snapBoundary` is now section-aware
 * too (a drag edge onto a heading confines to its section), so it forwards
 * the heading list + total — the OutlinePanel drag call keeps its
 * (edge, blockIndex) signature; the heading context is closed over here.
 */
export function useFocusActions(deps: {
  focusMode: FocusMode;
  outlineHeadings: FocusHeading[];
  outlineTotalBlocks: number;
  /** Top-level block index of the CURRENT section to seed focus-mode from when
   *  it's first enabled — the innermost active heading, or the doc-start
   *  par-title region, or null when nothing is measured yet (→ first section). */
  currentSeedBlockIndex: number | null;
}) {
  const { focusMode, outlineHeadings, outlineTotalBlocks, currentSeedBlockIndex } = deps;

  const handleFocusActivate = useCallback(() => {
    focusMode.activate(outlineHeadings, outlineTotalBlocks, currentSeedBlockIndex);
  }, [focusMode, outlineHeadings, outlineTotalBlocks, currentSeedBlockIndex]);

  // Task 285: the outline addresses its target by durable block uuid; the
  // heading list + total stay live-derived and are threaded here as before.
  const handleFocusMoveTo = useCallback((target: BlockAddress) => {
    focusMode.moveTo(target, outlineHeadings, outlineTotalBlocks);
  }, [focusMode, outlineHeadings, outlineTotalBlocks]);

  const handleFocusExpandTo = useCallback((target: BlockAddress) => {
    focusMode.expandTo(target, outlineHeadings, outlineTotalBlocks);
  }, [focusMode, outlineHeadings, outlineTotalBlocks]);

  const handleFocusSnapBoundary = useCallback(
    (edge: "top" | "bottom", target: BlockAddress) => {
      focusMode.snapBoundary(edge, target, outlineHeadings, outlineTotalBlocks);
    },
    [focusMode, outlineHeadings, outlineTotalBlocks],
  );

  return {
    handleFocusActivate,
    handleFocusMoveTo,
    handleFocusExpandTo,
    handleFocusSnapBoundary,
  };
}
