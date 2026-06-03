/**
 * Sidecar-cleanup walker for the drag-handle Delete action. Walks a doc
 * range and, for every sidecar-bearing element inside it, calls the
 * registered lifecycle's `delete` op. The actual `tr.delete` of the
 * range is the dispatcher's job — this helper just makes sure no
 * sidecar entry survives the deletion as an orphan.
 *
 * Same registry-driven discipline as [duplicate-slice.ts](./duplicate-slice.ts):
 *
 *   • Inline atoms (`footnote`, `citation`) — looked up via the same
 *     `INLINE_ATOM_CARDS` map literal as the duplicator. Adding a new
 *     inline-atom kind is one entry there (kept in the duplicator
 *     module to avoid an extra shared-state file).
 *
 *   • `linkedAnchor` marks — the mark's `linkCard` attr names the
 *     `CardKind:cardId`; we delegate to `getCardLifecycle(kind).delete(id)`
 *     uniformly. No per-kind branching in the walker.
 *
 * Limitation: Mode A paragraph-anchor links on todos/examples/
 * archive cards that pointed at deleted paragraphs are NOT proactively
 * cleaned up — those are visible-but-stale "remembered" anchors. The
 * existing orphan listener (`virgil-anchor-orphaned`) handles Mode B
 * anchor death; Mode A paragraph-link death is not currently swept.
 * Acceptable for MVP; address in a follow-up if it turns up in testing.
 */

import type { Node as PMNode } from "@tiptap/pm/model";
import type { CardLifecycleApi } from "@/panels/card-lifecycle-registry";
import type { CardKind } from "@/panels/_shared/types";
import { parseLinkCardKey } from "@/links/link-registry";
import {
  TEXT_OBJECT_REGISTRY,
  isTextObjectKind,
} from "./text-object-registry";

/** Same inline-atom lookup as the duplicator. Kept in sync by colocation;
 *  if these grow further, lift into a shared module. */
const INLINE_ATOM_CARDS: Record<string, { cardKind: CardKind; idAttr: string }> = {
  footnote: { cardKind: "footnote", idAttr: "footnoteId" },
  citation: { cardKind: "citation", idAttr: "citationId" },
};

// ---------------------------------------------------------------------------
// Cascade — when the deletion would leave a structural wrapper empty,
// extend the deletion range to include the wrapper. See
// ACTION-MENU-DIAGNOSIS.md cluster C6.
//
// Two sources of truth for "remove when empty":
//   • Registry flag `removeOnEmptyChildren: true` — declared per kind in
//     `text-object-registry.ts`. Currently set on `bulletList`,
//     `orderedList`, `exampleBlock`. Not set on `blockquote` (an empty
//     blockquote can be intentional).
//   • `INVISIBLE_WRAPPERS` below — schema-internal wrapper node types
//     that aren't TextObjects but ARE structural noise when empty
//     (`exampleItemList`).
//
// Both sources funnel through `shouldRemoveWhenEmpty(typeName)` so the
// cascade helper has a single decision predicate.
// ---------------------------------------------------------------------------

const INVISIBLE_WRAPPERS: ReadonlySet<string> = new Set(["exampleItemList"]);

function shouldRemoveWhenEmpty(typeName: string): boolean {
  if (INVISIBLE_WRAPPERS.has(typeName)) return true;
  if (!isTextObjectKind(typeName)) return false;
  return TEXT_OBJECT_REGISTRY[typeName].removeOnEmptyChildren === true;
}

/**
 * Given a deletion range `outer`, walk up the parent chain and expand
 * the range to include any ancestor wrapper that would be left empty
 * after the deletion. The cascade stops at the first ancestor that
 * either (a) would still have surviving siblings or (b) doesn't carry
 * the remove-on-empty intent.
 *
 * Runs once per action (Delete or Archive), with `outer` produced by
 * `outerRangeFor`. Pure — no transactions dispatched, no side effects.
 *
 * Sequencing matters: the expanded range MUST be passed to BOTH
 * `cleanupLinksInRange` and the `tr.delete` step in the same
 * transaction, otherwise PM's content-rule auto-fill would inject a
 * placeholder child (e.g. `\item %!v:<new>`) before the cascade gets
 * its chance.
 */
export function expandCascadeRange(
  doc: PMNode,
  outer: { from: number; to: number },
): { from: number; to: number } {
  let from = outer.from;
  let to = outer.to;
  // Walk up; each iteration checks whether the immediate wrapper would
  // be empty after removing [from, to). If so, swallow the wrapper and
  // continue up one level.
  for (let safety = 0; safety < 8; safety++) {
    if (from <= 0 || to >= doc.content.size) break;
    let resolved;
    try {
      resolved = doc.resolve(from);
    } catch {
      break;
    }
    const depth = resolved.depth;
    if (depth <= 0) break;
    const wrapper = resolved.node(depth);
    const wrapperFrom = resolved.before(depth);
    const wrapperTo = resolved.after(depth);
    // The wrapper's content spans (wrapperFrom + 1, wrapperTo - 1).
    // If the deletion covers exactly that, the wrapper is left empty.
    if (from !== wrapperFrom + 1 || to !== wrapperTo - 1) break;
    if (!shouldRemoveWhenEmpty(wrapper.type.name)) break;
    from = wrapperFrom;
    to = wrapperTo;
  }
  return { from, to };
}

export function cleanupLinksInRange(
  doc: PMNode,
  from: number,
  to: number,
  lifecycle: CardLifecycleApi,
): void {
  if (to <= from) return;
  // Track ids already passed to delete so a mark spanning multiple text
  // nodes doesn't fire delete() N times for the same card.
  const seenAnchors = new Set<string>();
  doc.nodesBetween(from, to, (node) => {
    // Inline-atom card cleanup
    const atom = INLINE_ATOM_CARDS[node.type.name];
    if (atom) {
      const id = node.attrs?.[atom.idAttr];
      if (typeof id === "string" && id) {
        lifecycle.get(atom.cardKind)?.delete(id);
      }
    }
    // linkedAnchor mark cleanup — one mark can cover several text nodes,
    // hence the seen-set keyed by anchorId.
    for (const mark of node.marks) {
      if (mark.type.name !== "linkedAnchor") continue;
      const anchorId =
        typeof mark.attrs.anchorId === "string" ? mark.attrs.anchorId : "";
      if (!anchorId || seenAnchors.has(anchorId)) continue;
      seenAnchors.add(anchorId);
      const linkCard =
        typeof mark.attrs.linkCard === "string" ? mark.attrs.linkCard : "";
      const parsed = parseLinkCardKey(linkCard);
      if (parsed) lifecycle.get(parsed.kind)?.delete(parsed.id);
    }
    return true;
  });
}
