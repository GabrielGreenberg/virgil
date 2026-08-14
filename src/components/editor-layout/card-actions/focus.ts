import { useCallback } from "react";
import type { useFocusMode } from "@/hooks/useFocusMode";
import type { BlockAddress } from "@/lib/tiptap/block-address";

type FocusMode = ReturnType<typeof useFocusMode>;
type FocusHeading = { index: number; level: number };

/**
 * Focus-mode action handlers.
 *
 * `activate` still takes the shell-derived heading list + total block count:
 * its seed is the reader's CURRENT section, a continuously-recomputed value
 * with no captured row behind it.
 *
 * The three targeted mutations take neither (task 285). They are addressed by
 * a durable `BlockAddress`, and `regionForAddress` derives the heading list
 * from the same live doc it resolves that address against — threading a
 * render-time list in was a second stale clock, so these forwarders would have
 * been re-introducing the drift one argument over.
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

  const handleFocusMoveTo = useCallback((target: BlockAddress) => {
    focusMode.moveTo(target);
  }, [focusMode]);

  const handleFocusExpandTo = useCallback((target: BlockAddress) => {
    focusMode.expandTo(target);
  }, [focusMode]);

  const handleFocusSnapBoundary = useCallback(
    (edge: "top" | "bottom", target: BlockAddress) => {
      focusMode.snapBoundary(edge, target);
    },
    [focusMode],
  );

  return {
    handleFocusActivate,
    handleFocusMoveTo,
    handleFocusExpandTo,
    handleFocusSnapBoundary,
  };
}
