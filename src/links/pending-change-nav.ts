/**
 * Task 023 — doc-order for the applied-pending NAVIGATOR (the omni bulk bar's
 * ▲/▼ + counter). A pure sort over the `PendingChangeIndex` keys, kept React-
 * free (like its siblings `pending-change-collect` / `pending-change-actions`)
 * so it's trivially unit-testable and so EditorPane can call it without pulling
 * the pill's component graph.
 */

import type { Node as PMNode } from "prosemirror-model";
import { findLinkedAnchorRange } from "@/lib/linked-anchor-range";
import type { PendingChangeIndex } from "@/components/PendingChangePill";

/**
 * Order the applied-pending `kind:id` keys by the DOC position of each change's
 * live blue range (`findLinkedAnchorRange(doc, anchorId).from`) — the same order
 * a reader scrolls past the changes, which the navigator steps through. A key
 * whose mark can't be resolved (deleted / not yet reanchored) sorts to the END,
 * with ties broken by the index's original insertion order so the result is
 * deterministic.
 *
 * PURE + doc-walking (`doc.descendants` via `findLinkedAnchorRange`), so it must
 * never gate on a `docVersion`-style counter. The applied set is tiny (<10), so
 * the walk is negligible; callers run it off a card-source change (the applied
 * set changing) or a nav click — never per keystroke.
 */
export function sortAppliedKeysByDocPos(
  index: PendingChangeIndex,
  doc: PMNode,
): string[] {
  const entries = Array.from(index.entries()).map(([key, target], i) => {
    const range = findLinkedAnchorRange(doc, target.anchorId);
    return { key, pos: range ? range.from : Number.POSITIVE_INFINITY, i };
  });
  entries.sort((a, b) => a.pos - b.pos || a.i - b.i);
  return entries.map((e) => e.key);
}
