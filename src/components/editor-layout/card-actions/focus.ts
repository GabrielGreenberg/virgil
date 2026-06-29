import { useCallback } from "react";
import type { useFocusMode } from "@/hooks/useFocusMode";

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
}) {
  const { focusMode, outlineHeadings, outlineTotalBlocks } = deps;

  const handleFocusActivate = useCallback(() => {
    focusMode.activate(outlineHeadings, outlineTotalBlocks);
  }, [focusMode, outlineHeadings, outlineTotalBlocks]);

  const handleFocusMoveTo = useCallback((blockIndex: number) => {
    focusMode.moveTo(blockIndex, outlineHeadings, outlineTotalBlocks);
  }, [focusMode, outlineHeadings, outlineTotalBlocks]);

  const handleFocusExpandTo = useCallback((blockIndex: number) => {
    focusMode.expandTo(blockIndex, outlineHeadings, outlineTotalBlocks);
  }, [focusMode, outlineHeadings, outlineTotalBlocks]);

  const handleFocusSnapBoundary = useCallback(
    (edge: "top" | "bottom", blockIndex: number) => {
      focusMode.snapBoundary(edge, blockIndex, outlineHeadings, outlineTotalBlocks);
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
