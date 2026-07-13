/**
 * Focus-band drag commit decision (task 113).
 *
 * On mouseup the FocusBand drag commits its single snapBoundary write only if
 * the dragged edge actually landed on a different row than the one it STARTED
 * on. The baseline is the dragged edge's OWN committed block index — not the
 * opposite (fixed) edge's. Comparing against the fixed edge (the original bug)
 * silently dropped the standard shrink gesture: dragging an edge onto the
 * opposite edge's row (pending === fixed) read as "not moved", so the range
 * never shrank and the collapsed transient rect stayed painted.
 *
 * Pure so the decision is unit-testable independent of DOM measurement.
 */
export function resolveDragCommit({
  edge,
  pendingBlockIndex,
  startBlockIndex,
  endBlockIndex,
}: {
  edge: "top" | "bottom";
  /** Row the dragged edge is snapped to at release; null = no mousemove ran. */
  pendingBlockIndex: number | null;
  /** Committed range at drag start. */
  startBlockIndex: number;
  endBlockIndex: number;
}): { commit: false } | { commit: true; blockIndex: number } {
  const draggedBlockIndex = edge === "top" ? startBlockIndex : endBlockIndex;
  if (pendingBlockIndex == null || pendingBlockIndex === draggedBlockIndex) {
    return { commit: false };
  }
  return { commit: true, blockIndex: pendingBlockIndex };
}
