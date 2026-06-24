/**
 * nest-footnote-children — stamp `parentCardId` + reorder omni items so a
 * footnote-owned card nests under its footnote card (bib-under-cite style).
 *
 * PHASE 1 — citations only. A `\cite` that lives inside a footnote body is
 * tagged `nestedInFootnoteId` on the DocStructureObserver `CitationEntry`
 * (`structure.citations[].nestedInFootnoteId`, load-only `buildInitial`). That
 * datum is already in the structure snapshot — this module is PURE rendering
 * plumbing: it does NO doc walk. The host derives the
 * `citationId → footnoteId` map from the snapshot under a structural gate
 * (`useStructuralRevisions().citations`), so it never runs on a plain keystroke
 * (keystroke sanctity — see AGENTS.md "Card-source derivation").
 *
 * The transform is intentionally NOT containment: a nested cite stays a
 * STANDALONE omni item (it keeps cascading as its own card, sharing its host
 * footnote's `pos`). All this does is:
 *   1. stamp `parentCardId` = the footnote's omni-item id (the
 *      `cardPopKey("footnote", footnoteId)` key the footnote builder uses), so
 *      `OmniViewPanel` can indent it + route it to the footnote's filter
 *      category; and
 *   2. REORDER `items` so each child immediately follows its parent footnote
 *      item — the cascade's stable sort on equal `naturalTop` then preserves
 *      parent→child order (two nested cites under one footnote stay in order).
 *
 * Orphan fallback: a nested cite whose host footnote item is MISSING from
 * `items` (footnote deleted / not built) is left UNCHANGED (no `parentCardId`)
 * so it degrades to a normal flat card rather than dropping.
 *
 * PHASE 2 SEAM (not implemented): once `\ref` (and any future nestable inline
 * atom) carries a `nestedInFootnoteId`-equivalent tag, build its
 * `childId → footnoteId` entries into the same map and this transform nests it
 * for free. Block cards (examples) are out of scope — footnote bodies hold only
 * inline content.
 */

import { cardPopKey } from "@/panels/panel-registry";
import type { OmniItem } from "@/panels/_shared/types";
import type { DocStructure } from "@/lib/tiptap/doc-structure/types";

/**
 * Pure: derive the `nestedChildId → footnoteId` map from a structure snapshot.
 *
 * PHASE 1: keyed by the citation's `id` (the citation node's `citationId`,
 * which is the SAME id space the omni citation builder keys its items by —
 * `popKey("citations", cit.id)`), valued by the host footnote's id. Only
 * citations carrying `nestedInFootnoteId` contribute.
 *
 * O(citations) and snapshot-derived — the CALLER must gate this behind a
 * structural counter (`useStructuralRevisions().citations`, which bumps on
 * citation add/remove/reorder AND on footnote-body edits) so it is not run per
 * keystroke. This function itself does no DOM/doc work.
 */
export function buildNestedFootnoteChildMap(
  structure: DocStructure,
): Map<string, string> {
  const map = new Map<string, string>();
  for (const cit of structure.citations) {
    if (cit.nestedInFootnoteId) {
      map.set(cit.id, cit.nestedInFootnoteId);
    }
  }
  return map;
}

/**
 * Pure: given the assembled omni `items` and a `childId → footnoteId` nesting
 * map, return a NEW array with:
 *   - `parentCardId` stamped on each child whose parent footnote item exists;
 *   - items reordered so each child immediately follows its parent footnote.
 *
 * Identity-stable when nothing nests: returns the SAME `items` reference if no
 * child resolved a present parent (so a doc with no footnote-nested cites pays
 * zero churn and downstream memos stay cached).
 *
 * The child id space is the OMNI-ITEM id of the citation card. The map is keyed
 * by the raw citation id; we resolve it to the citation's omni key via
 * `cardPopKey("citation", citId)` so we never have to re-derive item keys.
 */
export function nestFootnoteChildren(
  items: OmniItem[],
  childToFootnoteId: ReadonlyMap<string, string>,
): OmniItem[] {
  if (childToFootnoteId.size === 0) return items;

  // Index items by id for O(1) parent-existence checks.
  const byId = new Map<string, OmniItem>();
  for (const it of items) byId.set(it.id, it);

  // Resolve each child's OMNI-ITEM id → its parent footnote's OMNI-ITEM id,
  // keeping only children whose parent footnote item is actually present.
  // childItemId → parentItemId
  const childItemToParentItem = new Map<string, string>();
  // parentItemId → ordered childItemIds (preserve document order via the
  // structure-derived map's insertion order, which mirrors citation order).
  const parentToChildItems = new Map<string, string[]>();

  for (const [citId, footnoteId] of childToFootnoteId) {
    const childItemId = cardPopKey("citation", citId);
    const parentItemId = cardPopKey("footnote", footnoteId);
    // Both the child cite card AND its host footnote card must be present in
    // the current items for nesting to apply; otherwise leave the child flat.
    if (!byId.has(childItemId) || !byId.has(parentItemId)) continue;
    childItemToParentItem.set(childItemId, parentItemId);
    const arr = parentToChildItems.get(parentItemId);
    if (arr) arr.push(childItemId);
    else parentToChildItems.set(parentItemId, [childItemId]);
  }

  if (childItemToParentItem.size === 0) return items;

  // Stamp `parentCardId` on resolved children (new object, don't mutate input).
  const stamped = new Map<string, OmniItem>();
  for (const it of items) {
    const parentItemId = childItemToParentItem.get(it.id);
    stamped.set(
      it.id,
      parentItemId ? { ...it, parentCardId: parentItemId } : it,
    );
  }

  // Reorder: walk the original item order; emit each item once, and when we
  // emit a footnote that owns children, splice its children in right after it
  // (skipping them when they'd otherwise be visited in their original slot).
  const childItemIds = new Set(childItemToParentItem.keys());
  const out: OmniItem[] = [];
  for (const it of items) {
    // A child is emitted only as part of its parent's run, never at its own
    // original position.
    if (childItemIds.has(it.id)) continue;
    out.push(stamped.get(it.id)!);
    const ownedChildren = parentToChildItems.get(it.id);
    if (ownedChildren) {
      for (const childItemId of ownedChildren) {
        out.push(stamped.get(childItemId)!);
      }
    }
  }
  return out;
}
