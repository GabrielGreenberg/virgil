/**
 * Anchor-resolution helpers — given a doc position about to be removed,
 * find a surviving sibling block whose uuid a freshly-created card can
 * adopt instead of orphaning.
 *
 * Motivating case (B2 of the post-refactor followup):
 *   Archiving a whole paragraph creates a new snippet card. Today the
 *   dispatcher anchors the snippet to the paragraph's own uuid, then
 *   immediately deletes that paragraph in the same transaction; the
 *   `TextObjectOrphanGuard` fires `virgil-textobject-orphaned`, the
 *   `useArchive` listener strips the just-created link, and the snippet
 *   floats with no anchor. The fix is to resolve a surviving anchor
 *   BEFORE deletion and bind the new card to that instead.
 *
 * This helper is the building block; the dispatcher calls it from the
 * archive branch in [drag-handle-actions.ts](../components/editor-layout/card-actions/drag-handle-actions.ts).
 * Other destructive-creative actions (e.g. a future "extract to footnote")
 * can reuse it without per-action knowledge.
 */

import type { Node as PMNode } from "@tiptap/pm/model";
import {
  TEXT_OBJECT_REGISTRY,
  isTextObjectKind,
} from "./text-object-registry";
import type { TextObjectKind } from "./types";

/** Container-kind type names whose "previous block" is best expressed
 *  by their LAST child (so a paragraph immediately after a bulletList
 *  anchors to the previous listItem, not the bulletList wrapper).
 *  Includes the invisible exampleItemList wrapper used inside
 *  exampleBlock.
 *
 *  **Deliberately NOT folded onto `TEXT_OBJECT_REGISTRY`** (task 205 M3,
 *  reviewed and declined — recorded here so a future audit doesn't re-file it
 *  as a forked taxonomy). This set and its two apparent siblings —
 *  `DEFERRING_PARENTS` (`@/lib/anchor-uuid`: an inner paragraph defers anchor
 *  identity UP) and the registry's own `removeOnEmptyChildren` — are three
 *  ORTHOGONAL structural facts, not one taxonomy split three ways: a
 *  `bulletList` descends but does not defer; `listItem`/`blockquote`/
 *  `codeBlock` defer but neither descend nor self-remove; only `exampleBlock`
 *  is in all three, because it genuinely plays three schema roles. Two of the
 *  three are already documented single owners. And the fold does not close:
 *  `exampleItemList` is not a registered `TextObjectKind` and has no registry
 *  row, so a per-kind `descendsToLastChild` boolean would have to be paired
 *  with a side-list for it — trading one honest set for a table plus the same
 *  set. */
const CONTAINER_DESCEND_KINDS: ReadonlySet<string> = new Set([
  "bulletList",
  "orderedList",
  "exampleBlock",
  "exampleItemList",
]);

export interface AnchorableBlock {
  uuid: string;
  kind: TextObjectKind;
}

/**
 * Walk backward from `pos - 1` looking for the nearest TextObject block
 * carrying a uuid attr. For top-level container kinds (lists / example
 * blocks), descend into the last child so the result is the user's
 * intuitive "block immediately above" (the last listItem, not the
 * bulletList wrapper).
 *
 * Returns `null` when no surviving anchor exists (the source was the
 * doc's first block, or every block above is a non-TextObject).
 *
 * Pure; no view-level deps. Safe to call from action-time inside the
 * dispatcher; cost is O(depth) at the resolved position.
 */
export function findPreviousAnchorableBlock(
  doc: PMNode,
  pos: number,
): AnchorableBlock | null {
  if (pos <= 0) return null;
  let probe: PMNode | null = null;
  try {
    const $pos = doc.resolve(Math.min(pos, doc.content.size));
    // Walk up depths; at each level, try to step to the previous sibling
    // at that depth. The first valid prior sibling we hit is the
    // candidate; deeper levels exist when the source was nested
    // (a listItem inside a bulletList inside the doc).
    for (let depth = $pos.depth; depth >= 0; depth--) {
      const parent = $pos.node(depth);
      const indexAtDepth = $pos.index(depth);
      if (indexAtDepth <= 0) continue; // no prior sibling at this depth
      const sibling = parent.child(indexAtDepth - 1);
      probe = sibling;
      break;
    }
  } catch {
    return null;
  }
  if (!probe) return null;
  return resolveAnchorableFromNode(probe);
}

/** From a candidate node (which may be a container), drill down into its
 *  last child while the container kind asks us to. Returns the first
 *  TextObject-kind node with a uuid; null if no descendant qualifies. */
function resolveAnchorableFromNode(node: PMNode): AnchorableBlock | null {
  let cur: PMNode = node;
  // Safety bound — schema doesn't nest containers more than a few deep,
  // but bound the walk anyway.
  for (let safety = 0; safety < 8; safety++) {
    const typeName = cur.type.name;
    const uuidAttr = cur.attrs?.uuid;
    // A container kind whose last child is the "block above" semantically.
    if (CONTAINER_DESCEND_KINDS.has(typeName) && cur.childCount > 0) {
      const last = cur.child(cur.childCount - 1);
      // Prefer descending if the last child is itself anchorable or a
      // deeper container. If the container is empty (no children), fall
      // through to the uuid check below.
      cur = last;
      continue;
    }
    if (isTextObjectKind(typeName) && typeof uuidAttr === "string" && uuidAttr) {
      return { uuid: uuidAttr, kind: typeName as TextObjectKind };
    }
    // Not a TextObject kind and not a container — give up. (e.g. a
    // doctype block, a not-yet-registered kind.)
    return null;
  }
  return null;
}

/** True when the kind is one the registry actually knows about and the
 *  uuid is non-empty. Useful when callers want to validate an arbitrary
 *  block before treating it as anchorable. */
export function isAnchorableBlock(
  kind: string,
  uuid: string | null | undefined,
): kind is TextObjectKind {
  return (
    typeof uuid === "string" &&
    uuid.length > 0 &&
    isTextObjectKind(kind) &&
    // linkedRange isn't a node — exclude even though the registry has it.
    !TEXT_OBJECT_REGISTRY[kind as TextObjectKind].isRange
  );
}
