/**
 * Error-card expansion pruning (R5 / A4 deferred #4).
 *
 * Error cards are non-anchored, so their expand axis has no slot in the
 * shared cardStore — the owner (EditorPane for the docked panel + omni;
 * EditorLayout for the code-view sidebar) holds a `Set<string>` of expanded
 * error ids and prunes it when the live error list changes, so dead ids
 * don't accumulate across lint runs.
 */

/**
 * Drop expansion ids that no longer exist in the live error list.
 *
 * - Identity-stable: returns the SAME set when nothing was pruned, so a
 *   state setter passed the result is a no-op render-wise.
 * - Empty-list guard built in: a transient mid-compile empty list must NOT
 *   wipe the user's expansion state — callers may apply this on every
 *   error-list change without re-implementing the gate.
 */
export function pruneExpanded(
  expanded: Set<string>,
  liveIds: readonly string[],
): Set<string> {
  if (liveIds.length === 0) return expanded;
  const live = new Set(liveIds);
  const next = new Set<string>();
  for (const id of expanded) {
    if (live.has(id)) next.add(id);
  }
  return next.size === expanded.size ? expanded : next;
}
