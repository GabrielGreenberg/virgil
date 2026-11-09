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
import { isNodeTextObjectKind } from "./text-object-registry";
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

const NO_SKIP: ReadonlySet<string> = new Set();

/**
 * Walk backward from `pos` to the nearest TextObject block carrying a uuid.
 * For container kinds (lists / example blocks), descend into the last child
 * so the result is the user's intuitive "block immediately above" (the last
 * listItem, not the bulletList wrapper).
 *
 * "Nearest" is honoured, not approximated (task 1507): a sibling that does
 * not qualify — a `\maketitle` marker, an empty or unminted container, a
 * uuid-less paragraph, a block in `skip` — is WALKED PAST to the next sibling
 * up, and when a level runs out the walk climbs. Until 1507 it probed only the
 * first adjacent sibling and gave up there, so a displaced card lost its home
 * although a valid paragraph stood two blocks away.
 *
 * Returns `null` only when no qualifying block exists anywhere above (the
 * source was the doc's first block, or every block above is a non-TextObject,
 * uuid-less, or skipped).
 *
 * `skip` — uuids that must not be answered (the blocks a removal is about to
 * take out); they are walked past like any other non-qualifying block.
 *
 * Pure; no view-level deps. Action-time only; cost is O(distance to the
 * answer) in doc order, never O(doc) per keystroke.
 */
export function findPreviousAnchorableBlock(
  doc: PMNode,
  pos: number,
  skip: ReadonlySet<string> = NO_SKIP,
): AnchorableBlock | null {
  if (pos <= 0) return null;
  return walkSiblings(doc, pos, "last", skip);
}

/**
 * The mirror of {@link findPreviousAnchorableBlock}: walk FORWARD from `pos`
 * to the nearest TextObject block carrying a uuid, descending into a
 * container's FIRST child, walking past non-qualifying siblings and climbing
 * exactly as its backward twin does.
 *
 * It exists because "the block above" is not always available: a capture that
 * starts at the document's very first block has nothing before it, and the
 * honest neighbour is then the block that will sit immediately BELOW the hole.
 * Without it, archiving the first paragraph left the fresh snippet — and, since
 * task 491, every card the capture displaced — with no anchor at all.
 *
 * Pure; same cost class as its backward twin.
 */
export function findNextAnchorableBlock(
  doc: PMNode,
  pos: number,
  skip: ReadonlySet<string> = NO_SKIP,
): AnchorableBlock | null {
  if (pos >= doc.content.size) return null;
  return walkSiblings(doc, pos, "first", skip);
}

/** The one sibling walk behind both directions. `edge` names the direction
 *  by the container end that touches the gap: `"last"` walks BACKWARD (a
 *  candidate above presents its last item to us), `"first"` walks FORWARD.
 *
 *  At each depth, from the deepest outward, the siblings on the walk's side
 *  of `pos` are tried nearest-first; the first that yields an answer wins.
 *  At the resolved depth, `index(depth)` is the child starting at `pos`; at
 *  every shallower depth it is the ANCESTOR containing `pos` — already searched
 *  from the inside — so the forward walk starts one past it there. Inline
 *  levels are skipped: a text run is never a block neighbour. */
function walkSiblings(
  doc: PMNode,
  pos: number,
  edge: "first" | "last",
  skip: ReadonlySet<string>,
): AnchorableBlock | null {
  let $pos;
  try {
    $pos = doc.resolve(Math.max(0, Math.min(pos, doc.content.size)));
  } catch {
    return null;
  }
  for (let depth = $pos.depth; depth >= 0; depth--) {
    const parent = $pos.node(depth);
    if (parent.inlineContent) continue;
    const at = $pos.index(depth);
    if (edge === "last") {
      for (let i = at - 1; i >= 0; i--) {
        const hit = resolveAnchorableFromNode(parent.child(i), edge, skip);
        if (hit) return hit;
      }
    } else {
      const startAt = depth === $pos.depth ? at : at + 1;
      for (let i = startAt; i < parent.childCount; i++) {
        const hit = resolveAnchorableFromNode(parent.child(i), edge, skip);
        if (hit) return hit;
      }
    }
  }
  return null;
}

/** From a candidate node (which may be a container), find the qualifying
 *  block nearest the gap we came from: a container is searched from its
 *  `edge` child inward (recursively — containers nest), and only when none of
 *  its children qualifies does the container's OWN identity answer. A plain
 *  node answers itself if it is an anchorable, un-skipped TextObject.
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
  skip: ReadonlySet<string>,
  nesting = 0,
): AnchorableBlock | null {
  const typeName = node.type.name;
  // Safety bound — the schema doesn't nest containers more than a few deep.
  if (CONTAINER_DESCEND_KINDS.has(typeName) && nesting < 8) {
    const n = node.childCount;
    for (let k = 0; k < n; k++) {
      const child = node.child(edge === "last" ? n - 1 - k : k);
      const hit = resolveAnchorableFromNode(child, edge, skip, nesting + 1);
      if (hit) return hit;
    }
    // Empty, or no child qualifies — fall through to the container itself.
  }
  const uuidAttr = node.attrs?.uuid;
  if (isAnchorableBlock(typeName, uuidAttr) && !skip.has(uuidAttr)) {
    return { uuid: uuidAttr, kind: typeName };
  }
  // Not a qualifying TextObject (a doctype block, a `\maketitle` marker, an
  // unminted block, a skipped one) — the caller walks on past it.
  return null;
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
 *
 * The answer carries the neighbour (`target`) PLUS which side of the captured
 * range it sits on (`below`, task 965). Rungs 1 and 2 answer a block at or ABOVE the
 * range — the passage came from just after it. Rung 3 (the forward fall at the
 * document's first block) answers a block BELOW — the passage came from just
 * before it. That direction is a fact only the capture can see: once the range
 * is gone, "the clip is anchored to B" no longer says which side of B it left,
 * so an archive that wants to put its text back where it came from must record
 * it now (`ArchivedSnippet.returnBefore`).
 */
export function resolveDisplacedAnchorPlacement(
  doc: PMNode,
  from: number,
  to: number,
  removed: ReadonlySet<string>,
): { target: AnchorableBlock; below: boolean } | null {
  // Rung 1 — a partially-captured host block keeps its identity.
  try {
    const $from = doc.resolve(Math.max(0, Math.min(from, doc.content.size)));
    if ($from.parent.isTextblock) {
      for (let depth = $from.depth; depth >= 0; depth--) {
        const node = $from.node(depth);
        const uuid = (node.attrs as { uuid?: string | null } | undefined)?.uuid;
        if (!isAnchorableBlock(node.type.name, uuid)) continue;
        // The FIRST anchorable ancestor is this position's identity (an inner
        // paragraph defers up to its listItem). It always SURVIVES: `from`
        // sits strictly inside it, and `collectRemovedAnchorUuids` counts only
        // blocks the range wholly contains — so no `removed` check is asked
        // here (task 937 deleted one that could never fire).
        return {
          target: { uuid: uuid as string, kind: node.type.name as TextObjectKind },
          below: false,
        };
      }
    }
  } catch {
    // Out-of-range position — fall through to the neighbour rungs.
  }
  return neighbourAnchor(doc, from, to, removed);
}

/** Rungs 2 and 3: above, else below. A block inside the removal is WALKED
 *  PAST, not refused — `nodesBetween` containment and the sibling walk are
 *  different questions, and a cascade-extended range can swallow a sibling the
 *  walk would otherwise hand back; refusing it after the fact (pre-1507) gave
 *  up on the whole direction although a surviving block stood just beyond. */
function neighbourAnchor(
  doc: PMNode,
  from: number,
  to: number,
  removed: ReadonlySet<string>,
): { target: AnchorableBlock; below: boolean } | null {
  const prev = findPreviousAnchorableBlock(doc, from, removed);
  if (prev) return { target: prev, below: false };
  const next = findNextAnchorableBlock(doc, to, removed);
  if (next) return { target: next, below: true };
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
    // A range kind (linkedRange) isn't a node — exclude even though the
    // registry has it.
    isNodeTextObjectKind(kind)
  );
}
