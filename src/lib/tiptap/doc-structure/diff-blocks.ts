/**
 * DocStructureObserver — diff → touched-block resolver
 *
 * A tiny shared primitive for `appendTransaction` guards that need to react
 * to the top-level blocks a transaction touched, WITHOUT walking the whole
 * doc (the keystroke-sanctity law — AGENTS.md). It resolves the structural
 * diff's changed/added block entries to their live positions in the final
 * document, so a guard can inspect only those blocks.
 *
 * Cost is O(edit-size), never O(doc): a plain in-paragraph keystroke yields
 * exactly the one typed block; a paste yields the pasted blocks; a split
 * yields the re-uuid'd block (plus its sibling when `includeSiblings`). It is
 * the generalization of the "consume the diff, don't walk the doc" pattern
 * the sibling footnote renumber plugin already follows.
 */

import type { Node as PMNode } from "@tiptap/pm/model";
import type { DocStructure, StructureDiff } from "./types";

/**
 * The live top-level positions a transaction's diff touched — the union of
 * freshly-added blocks (`addedBlocks`), content-changed blocks
 * (`contentChangedUuids`, resolved to a current position through the
 * structure index) and changed headings (`changedHeadings`, e.g. a label /
 * level edit). Every returned position is the opening-token position of a
 * top-level node in `doc`.
 *
 * `includeSiblings` additionally returns each touched block's immediate
 * top-level neighbours. This is needed when a fix must react to a block that
 * was created ADJACENT to the edit but is not itself a clean diff entry — the
 * canonical case is the empty paragraph stranded by an Enter-at-start split:
 * the observer sees only the re-uuid'd content paragraph (backfill runs as a
 * trailing transaction, so `pendingDiff` describes the re-uuid, not the
 * split), and the stranded empty paragraph is that block's preceding sibling.
 *
 * Positions are returned in no particular order; callers that mutate should
 * sort descending before applying so earlier edits don't shift later ones.
 */
export function touchedBlockPositions(
  diff: StructureDiff,
  structure: DocStructure,
  doc: PMNode,
  includeSiblings = false,
): number[] {
  const positions = new Set<number>();
  const add = (pos: number) => {
    if (pos >= 0 && pos < doc.content.size) positions.add(pos);
  };

  for (const b of diff.addedBlocks) add(b.pos);
  for (const uuid of diff.contentChangedUuids) {
    const entry = structure.blocks.get(uuid);
    if (entry) add(entry.pos);
  }
  for (const h of diff.changedHeadings) add(h.pos);

  if (includeSiblings) {
    // Snapshot first — we're expanding the same set we iterate.
    for (const pos of [...positions]) {
      const $pos = doc.resolve(pos);
      const before = $pos.nodeBefore;
      if (before) add(pos - before.nodeSize);
      const node = doc.nodeAt(pos);
      if (node) add(pos + node.nodeSize);
    }
  }

  return [...positions];
}
