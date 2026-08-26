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
  return resolveAnchorableFromNode(probe, "last");
}

/** From a candidate node (which may be a container), drill down into its
 *  edge child while the container kind asks us to. Returns the first
 *  TextObject-kind node with a uuid; null if no descendant qualifies.
 *
 *  `edge` is which end of the container reads as "the block adjacent to the
 *  gap we came from": `"last"` for a candidate found ABOVE (its final item is
 *  the one touching us), `"first"` for one found BELOW. The two are exact
 *  mirrors — stated as one parameter rather than two walkers so a container
 *  kind added to {@link CONTAINER_DESCEND_KINDS} is covered in both
 *  directions by declaring itself. */
function resolveAnchorableFromNode(
  node: PMNode,
  edge: "first" | "last",
): AnchorableBlock | null {
  let cur: PMNode = node;
  // Safety bound — schema doesn't nest containers more than a few deep,
  // but bound the walk anyway.
  for (let safety = 0; safety < 8; safety++) {
    const typeName = cur.type.name;
    const uuidAttr = cur.attrs?.uuid;
    // A container kind whose edge child is the "block adjacent" semantically.
    if (CONTAINER_DESCEND_KINDS.has(typeName) && cur.childCount > 0) {
      // Prefer descending if the edge child is itself anchorable or a
      // deeper container. If the container is empty (no children), fall
      // through to the uuid check below.
      cur = edge === "last" ? cur.child(cur.childCount - 1) : cur.child(0);
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

/**
 * The mirror of {@link findPreviousAnchorableBlock}: walk FORWARD from `pos`
 * to the nearest TextObject block carrying a uuid, descending into a
 * container's FIRST child.
 *
 * It exists because "the block above" is not always available: a capture that
 * starts at the document's very first block has nothing before it, and the
 * honest neighbour is then the block that will sit immediately BELOW the hole.
 * Without it, archiving the first paragraph left the fresh snippet — and, since
 * task 491, every card the capture displaced — with no anchor at all.
 *
 * Pure; O(depth). Same cost class as its backward twin.
 */
export function findNextAnchorableBlock(
  doc: PMNode,
  pos: number,
): AnchorableBlock | null {
  if (pos >= doc.content.size) return null;
  let probe: PMNode | null = null;
  try {
    const $pos = doc.resolve(Math.max(0, Math.min(pos, doc.content.size)));
    // Mirror of the backward walk: at each depth, the child AT `index(depth)`
    // is the sibling that starts at (or spans) this position — the first one
    // still ahead of us. Deeper levels exist when the position was nested.
    for (let depth = $pos.depth; depth >= 0; depth--) {
      const parent = $pos.node(depth);
      const indexAtDepth = $pos.index(depth);
      if (indexAtDepth >= parent.childCount) continue; // nothing after us here
      probe = parent.child(indexAtDepth);
      break;
    }
  } catch {
    return null;
  }
  if (!probe) return null;
  return resolveAnchorableFromNode(probe, "first");
}

/**
 * Every anchorable uuid a removal of `[from, to)` would take out of the doc.
 *
 * "Would take out" is STRICT CONTAINMENT, not intersection: a block the range
 * merely reaches into (the source paragraph of a sub-range archive, the two
 * partially-covered ends of a text selection) survives the delete and keeps its
 * uuid, so a card anchored to it is not displaced and must not be moved. Only a
 * node lying wholly inside the range actually goes away.
 *
 * Nested blocks count too — a cascade-extended `bulletList` removal takes its
 * `listItem`s with it, and cards anchor to items far more often than to lists.
 *
 * O(range), not O(doc): `nodesBetween` visits only the subtree the range
 * touches. Action-time only — never a keystroke.
 */
export function collectRemovedAnchorUuids(
  doc: PMNode,
  from: number,
  to: number,
): Set<string> {
  const removed = new Set<string>();
  if (to <= from) return removed;
  const lo = Math.max(0, Math.min(from, doc.content.size));
  const hi = Math.max(lo, Math.min(to, doc.content.size));
  doc.nodesBetween(lo, hi, (node, pos) => {
    if (pos < lo || pos + node.nodeSize > hi) return true; // survives (partial)
    const uuid = (node.attrs as { uuid?: string | null } | undefined)?.uuid;
    if (isAnchorableBlock(node.type.name, uuid)) removed.add(uuid as string);
    return true;
  });
  return removed;
}

/**
 * **Where the margin context displaced by a capture of `[from, to)` should
 * re-home** (task 491).
 *
 * Gabriel's ruling: archiving a passage that carries another card's anchor must
 * not "lose" that card — *"they should just stack up on the preceding
 * paragraph."* An archive is a deliberate SET-ASIDE, not a destruction, so the
 * reader's margin context survives on the surviving neighbour. This resolves
 * that neighbour, ONCE, for the whole gesture: the fresh snippet and every
 * displaced card take the SAME answer, which is what makes them stack instead
 * of scattering.
 *
 * Three rungs, in the order a reader would look:
 *
 *  1. **The block that CONTAINS the range start and survives it.** A sub-range
 *     capture (a text selection inside one paragraph) leaves its own paragraph
 *     standing, and that paragraph — not its neighbour — is where the context
 *     belongs. Asked only when `from` sits inside a textblock: at a block
 *     boundary the enclosing node is the doc, or a list wrapper the user did
 *     not point at, and answering with it would put the displaced cards
 *     somewhere the snippet is not.
 *  2. **The nearest surviving block ABOVE** — the reported case, and the
 *     paragraph the archive snippet has anchored to since B2.
 *  3. **The nearest surviving block BELOW**, for a capture that starts at the
 *     document's first block. Rung 2 answers `null` there, and a null answer
 *     means everything orphans; falling forward keeps the class whole.
 *
 * `null` — no anchorable block survives anywhere (the capture emptied the
 * document) — is a real answer: the caller leaves every card on the ordinary
 * orphan path rather than inventing a home.
 */
export function resolveDisplacedAnchorTarget(
  doc: PMNode,
  from: number,
  to: number,
  removed: ReadonlySet<string>,
): AnchorableBlock | null {
  // Rung 1 — a partially-captured host block keeps its identity.
  try {
    const $from = doc.resolve(Math.max(0, Math.min(from, doc.content.size)));
    if ($from.parent.isTextblock) {
      for (let depth = $from.depth; depth >= 0; depth--) {
        const node = $from.node(depth);
        const uuid = (node.attrs as { uuid?: string | null } | undefined)?.uuid;
        if (!isAnchorableBlock(node.type.name, uuid)) continue;
        // The FIRST anchorable ancestor is this position's identity (an inner
        // paragraph defers up to its listItem). If that one is going away, the
        // range covers the whole host — fall through to the neighbour rungs
        // rather than climbing to a wrapper the user never pointed at.
        return removed.has(uuid as string)
          ? neighbourAnchor(doc, from, to, removed)
          : { uuid: uuid as string, kind: node.type.name as TextObjectKind };
      }
    }
  } catch {
    // Out-of-range position — fall through to the neighbour rungs.
  }
  return neighbourAnchor(doc, from, to, removed);
}

/** Rungs 2 and 3: above, else below. A candidate that is itself inside the
 *  removal is refused — `nodesBetween` containment and the sibling walk are
 *  different questions, and a cascade-extended range can swallow a sibling the
 *  backward walk would otherwise hand back. */
function neighbourAnchor(
  doc: PMNode,
  from: number,
  to: number,
  removed: ReadonlySet<string>,
): AnchorableBlock | null {
  const prev = findPreviousAnchorableBlock(doc, from);
  if (prev && !removed.has(prev.uuid)) return prev;
  const next = findNextAnchorableBlock(doc, to);
  if (next && !removed.has(next.uuid)) return next;
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
