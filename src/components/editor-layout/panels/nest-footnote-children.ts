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
 * PHASE 2 — DOCKED SURFACE (implemented below): the same `nestedInFootnoteId`
 * datum, applied to the kind-segregated docked Citations panel
 * (`buildNestedFootnoteInfoMap` + `partitionDockedCitations`). A footnote-nested
 * cite is pulled out of the flat docked list and rendered as an indented child
 * tagged with its host footnote — the docked analog of the omni nesting.
 *
 * NOT A CARD KIND — `\ref`: a `\ref` (the `labelRef` inline atom) does NOT
 * surface as a panel card anywhere (no `ref`/`labelRef` `CardKind`, no Ref
 * panel, no ref omni builder — `card-actions/ref.ts` is the inline-atom CREATE
 * action only). So although a `\ref` CAN now live inside a footnote body and
 * round-trips through the serializer, there is no ref card to nest. Refs are
 * intentionally out of scope here; only citations have a nestable card. Block
 * cards (examples) are likewise out — footnote bodies hold only inline content.
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

// ---------------------------------------------------------------------------
// DOCKED SURFACE — the same nesting fact, applied to the kind-segregated
// docked panels (Phase 2 / Part B).
//
// Omni threads every kind through ONE list, so a footnote-nested cite can sit
// directly beneath its footnote card there (`nestFootnoteChildren` above). The
// DOCKED surface lists each kind in its OWN panel (Footnotes panel, Citations
// panel), so the footnote card isn't present in the Citations panel to sit
// under. The faithful docked analog — sanctioned by the feature memo §4d ("or
// at least suppressed from the flat docked Citations list + surfaced under the
// footnote") — keeps a nested cite in its HOME (Citations) panel but pulls it
// OUT of the flat top-level ordering and renders it as an indented child,
// tagged with its host footnote, grouped after the flat cites. This reuses the
// SAME snapshot-gated `nestedInFootnoteId` datum (no new doc walk) and the SAME
// 16px (`ml-4`) indent token as Omni, so the two surfaces stay unified.
// ---------------------------------------------------------------------------

/** The host-footnote context a docked nested cite carries for its label. */
export interface NestedFootnoteInfo {
  /** Host footnote's `footnoteId` (the same id the footnote card is keyed by). */
  footnoteId: string;
  /** Host footnote's current `number` attribute, for the "in footnote N"
   *  label. `null` when the footnote isn't in the snapshot (degrades to a
   *  numberless label rather than dropping the nesting). */
  footnoteNumber: number | null;
}

/**
 * Pure: derive `citationId → { footnoteId, footnoteNumber }` from a structure
 * snapshot — the docked-surface counterpart of `buildNestedFootnoteChildMap`,
 * enriched with the host footnote's live number so the docked Citations panel
 * can label a nested cite "in footnote N" without taking a dependency on the
 * Footnotes panel's data.
 *
 * O(citations + footnotes), snapshot-derived. The CALLER must gate this behind
 * the `useStructuralRevisions().citations` counter (which bumps on footnote-body
 * edits too) so it never runs per keystroke. Does no DOM/doc work.
 */
export function buildNestedFootnoteInfoMap(
  structure: DocStructure,
): Map<string, NestedFootnoteInfo> {
  const numberByFootnoteId = new Map<string, number>();
  for (const fn of structure.footnotes) numberByFootnoteId.set(fn.id, fn.number);

  const map = new Map<string, NestedFootnoteInfo>();
  for (const cit of structure.citations) {
    if (!cit.nestedInFootnoteId) continue;
    map.set(cit.id, {
      footnoteId: cit.nestedInFootnoteId,
      footnoteNumber: numberByFootnoteId.get(cit.nestedInFootnoteId) ?? null,
    });
  }
  return map;
}

/**
 * Pure: split an ordered docked-citations array into the flat (top-level) cites
 * and the footnote-nested children, preserving the input order WITHIN each
 * group. The nested group carries each cite's resolved `NestedFootnoteInfo` so
 * the panel can render the "in footnote N" affordance.
 *
 * Identity-stable when nothing nests: returns the SAME `citations` reference as
 * `topLevel` (and an empty `nested`) so a doc with no footnote-nested cites pays
 * zero churn and the panel's memoized list stays cached.
 *
 * A cite tagged nested whose host footnote is GONE (not in `infoByCitationId`)
 * stays in `topLevel` — it degrades to a normal flat card rather than dropping,
 * matching the omni orphan-fallback.
 */
export function partitionDockedCitations<T extends { id: string }>(
  citations: readonly T[],
  infoByCitationId: ReadonlyMap<string, NestedFootnoteInfo>,
): { topLevel: readonly T[]; nested: Array<{ citation: T; info: NestedFootnoteInfo }> } {
  if (infoByCitationId.size === 0) {
    return { topLevel: citations, nested: [] };
  }
  const topLevel: T[] = [];
  const nested: Array<{ citation: T; info: NestedFootnoteInfo }> = [];
  for (const cit of citations) {
    const info = infoByCitationId.get(cit.id);
    if (info) nested.push({ citation: cit, info });
    else topLevel.push(cit);
  }
  // Nothing actually resolved a present host → identity-stable passthrough.
  if (nested.length === 0) return { topLevel: citations, nested: [] };
  return { topLevel, nested };
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
