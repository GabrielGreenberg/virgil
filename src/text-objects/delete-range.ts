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
 * Limitation: Mode A paragraph-anchor links on todos/quotations/examples/
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

/** Same inline-atom lookup as the duplicator. Kept in sync by colocation;
 *  if these grow further, lift into a shared module. */
const INLINE_ATOM_CARDS: Record<string, { cardKind: CardKind; idAttr: string }> = {
  footnote: { cardKind: "footnote", idAttr: "footnoteId" },
  citation: { cardKind: "citation", idAttr: "citationId" },
};

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
