/**
 * Outline edit-mode drop geometry (task 114) — the SINGLE definition of where
 * a hover lands and where the indicator line paints, shared by handleDrop and
 * the indicator derivation so the two can never disagree.
 *
 * Sections move as units: a "below" hover on a heading lands after the
 * heading's ENTIRE section (blockIndex + blockCount). The original bug painted
 * the accent line at the hovered pod's own bottom edge — visually between an
 * EXPANDED heading and its first child — while the blocks landed pages later.
 * The indicator host is therefore derived from the LANDING index: the last
 * visible pod before it (for a collapsed heading this collapses to the pod
 * itself — unchanged behavior).
 */

export interface DropPod {
  id: string;
  blockIndex: number;
  blockCount: number;
}

/** Block index the moved section will be inserted at for this hover. */
export function landingBlockIndex(
  target: DropPod,
  position: "above" | "below",
): number {
  return position === "above"
    ? target.blockIndex
    : target.blockIndex + target.blockCount;
}

/**
 * Landing STRICTLY inside the dragged run — moving a section into itself.
 * Refused by both the indicator and the write, because there is no coherent
 * result to produce.
 */
export function isInsideOwnRange(
  sourceIndex: number,
  sourceCount: number,
  landing: number,
): boolean {
  return landing > sourceIndex && landing < sourceIndex + sourceCount;
}

/**
 * Landing on either BOUNDARY of the dragged run — its own start, or
 * immediately after its own end. The section does not move.
 *
 * The two questions are deliberately separate, and the split is a UX call
 * rather than an oversight (task 285's adversarial pass proposed folding them,
 * and the pre-existing suite had already pinned the answer). The WRITE must
 * refuse a no-op: dispatching a delete-and-reinsert that changes nothing costs
 * a history entry and an autosave for a gesture with no effect. The INDICATOR
 * must still light it: a section dropped back where it already is leaves the
 * document exactly as the user intended, so the lit line is honest — and going
 * dark there would paint a forbidden-looking band around the dragged section's
 * own position. This is not the 083 false-affordance class, which is a line
 * that promises a change and delivers none.
 */
export function isNoOpLanding(
  sourceIndex: number,
  sourceCount: number,
  landing: number,
): boolean {
  return landing === sourceIndex || landing === sourceIndex + sourceCount;
}

/**
 * True when the drop is a move-into-self and must not be offered: dropping on
 * the dragged pod itself, or landing strictly inside its own block range. A lit
 * line the drop then ignores is the 083 false-affordance class.
 *
 * This is the SNAPSHOT half — it keeps the affordance honest against what the
 * user can see. The live half runs in `handleReorderBlocks` against the
 * resolved spans, off the same `isInsideOwnRange` core plus `isNoOpLanding`,
 * and is what actually protects the document; under a concurrent write the two
 * can legitimately disagree, since only the second one knows what the document
 * is now.
 */
export function isRejectedDrop(
  source: DropPod | undefined,
  target: DropPod,
  landing: number,
): boolean {
  if (!source) return false;
  if (source.id === target.id) return true;
  return isInsideOwnRange(source.blockIndex, source.blockCount, landing);
}

/**
 * Which visible pod hosts the indicator line, and on which side.
 *
 * "above" paints on the hovered pod itself (landing === its blockIndex).
 * "below" paints below the LAST VISIBLE pod preceding the landing index —
 * the target section's last visible member. Child pods are hidden when the
 * heading is collapsed, so a collapsed target hosts its own line; an expanded
 * one hands it to its last visible descendant, exactly where the blocks land.
 * `visiblePods` is in document order.
 */
export function resolveDropIndicator(
  visiblePods: DropPod[],
  target: DropPod,
  position: "above" | "below",
  source: DropPod | undefined,
): { podId: string; position: "above" | "below" } | null {
  const landing = landingBlockIndex(target, position);
  if (isRejectedDrop(source, target, landing)) return null;
  if (position === "above") return { podId: target.id, position: "above" };
  let host = target;
  for (const p of visiblePods) {
    if (p.blockIndex < landing && p.blockIndex >= host.blockIndex) host = p;
  }
  return { podId: host.id, position: "below" };
}
