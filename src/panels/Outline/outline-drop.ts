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
 * True when handleDrop would reject this hover: dropping on the dragged pod
 * itself, or landing strictly inside the dragged pod's own block range
 * (moving a section into itself). The indicator must not light for these —
 * a lit line the drop then ignores is the 083 false-affordance class.
 */
export function isRejectedDrop(
  source: DropPod | undefined,
  target: DropPod,
  landing: number,
): boolean {
  if (!source) return false;
  if (source.id === target.id) return true;
  return (
    landing > source.blockIndex &&
    landing < source.blockIndex + source.blockCount
  );
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
