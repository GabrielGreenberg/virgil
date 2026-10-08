/**
 * Where to paint an error's highlight in the visual editor (task 1008).
 *
 * An error is located in the SOURCE (a line), which `paragraphByErrorId` maps
 * to a block uuid. The highlight lives INSIDE that block, never elsewhere:
 *
 *   1. If the error names an offending key (`err.detail` — an undefined
 *      `\ref`-family label or a `\cite` key missing from the bibliography),
 *      highlight the ATOM inside the block that carries it: a `labelRef` whose
 *      `label` is the key, or a `citation` whose command lists it.
 *   2. Else the whole block.
 *   3. Else (block not in the live doc) null.
 *
 * The retired version searched the WHOLE document's prose for the key text.
 * In the visual editor `\ref`/`\cite` are atoms, so the key is never prose —
 * that search could only ever hit an incidental substring ("def" inside
 * "defined") in some unrelated paragraph, and it won before the paragraph
 * fallback was consulted.
 *
 * Cost: uuid → pos through the DocStructure snapshot (O(1)); a nested or
 * snapshot-less block falls back to one walk. Then O(block) for the atom.
 * Runs on a selection gesture / lint pass, never per keystroke.
 */

import type { Node as PMNode } from "@tiptap/pm/model";
import type { DocStructure } from "@/lib/tiptap/doc-structure/types";
import { parseCiteCommand } from "@/lib/cite-command-model";

export interface HighlightRange {
  from: number;
  to: number;
}

/** Position of the block whose `uuid` attr is `uuid`, or null. */
function findBlockPos(
  doc: PMNode,
  structure: DocStructure | null,
  uuid: string,
): number | null {
  const entry = structure?.blocks.get(uuid);
  if (entry) {
    const n = entry.pos < doc.content.size ? doc.nodeAt(entry.pos) : null;
    if (n?.attrs?.uuid === uuid) return entry.pos;
  }
  // Snapshot stale/absent, or the block is nested (the snapshot indexes
  // top-level blocks only).
  let found: number | null = null;
  doc.descendants((node, pos) => {
    if (found !== null) return false;
    if (node.attrs?.uuid === uuid) {
      found = pos;
      return false;
    }
    return true;
  });
  return found;
}

/** Does this inline atom carry the offending key? */
function atomCarriesKey(node: PMNode, key: string): boolean {
  if (node.type.name === "labelRef") return node.attrs?.label === key;
  if (node.type.name === "citation") {
    const command = node.attrs?.command;
    if (typeof command !== "string" || !command) return false;
    return parseCiteCommand(command)?.keys.includes(key) ?? false;
  }
  return false;
}

export function resolveErrorHighlightRange(
  doc: PMNode,
  structure: DocStructure | null,
  paragraphUuid: string | undefined,
  detail: string | undefined,
): HighlightRange | null {
  if (!paragraphUuid) return null;
  const blockPos = findBlockPos(doc, structure, paragraphUuid);
  if (blockPos === null) return null;
  const block = doc.nodeAt(blockPos);
  if (!block) return null;

  if (detail) {
    let hit: HighlightRange | null = null;
    block.descendants((node, offset) => {
      if (hit) return false;
      if (atomCarriesKey(node, detail)) {
        const from = blockPos + 1 + offset;
        hit = { from, to: from + node.nodeSize };
        return false;
      }
      return true;
    });
    if (hit) return hit;
  }

  return { from: blockPos + 1, to: blockPos + block.nodeSize - 1 };
}
