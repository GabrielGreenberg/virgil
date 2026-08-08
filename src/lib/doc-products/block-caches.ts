/**
 * Per-block product caches — keyed on PM NODE IDENTITY.
 *
 * ProseMirror nodes are immutable and persistent: an untouched top-level
 * block keeps the same object reference across transactions, so a WeakMap
 * keyed on the node IS the incremental diff — a miss means the block
 * changed, a hit means its serialized products are still exact. This is the
 * shipped `exampleLatexCache` pattern (Editor.tsx) generalized (perf plan
 * Wave 1 / P2). No pruner: old nodes are released when unreferenced; the
 * one retention source is undo history pinning old doc trees, which bounds
 * stale entries by history depth.
 *
 * NOT keyed on uuid: blank paragraphs serialize `%!v:blank` without one,
 * and node identity is strictly finer-grained anyway.
 */

import type { Node as PMNode } from "@tiptap/pm/model";
import type { JSONContent } from "@tiptap/react";
import {
  serializeTopLevelBlock,
  type TopLevelBlockLatex,
} from "@/lib/latex-serializer";

const blockJsonCache = new WeakMap<PMNode, JSONContent>();
const blockLatexCache = new WeakMap<PMNode, TopLevelBlockLatex>();

/** Probe counters (read via __docProductsStats). */
export const blockCacheStats = {
  jsonMisses: 0,
  jsonHits: 0,
  latexMisses: 0,
  latexHits: 0,
};

export function getBlockJson(node: PMNode): JSONContent {
  const hit = blockJsonCache.get(node);
  if (hit) {
    blockCacheStats.jsonHits++;
    return hit;
  }
  blockCacheStats.jsonMisses++;
  const json = node.toJSON() as JSONContent;
  blockJsonCache.set(node, json);
  return json;
}

export function getBlockLatex(node: PMNode): TopLevelBlockLatex {
  const hit = blockLatexCache.get(node);
  if (hit) {
    blockCacheStats.latexHits++;
    return hit;
  }
  blockCacheStats.latexMisses++;
  const part = serializeTopLevelBlock(getBlockJson(node));
  blockLatexCache.set(node, part);
  return part;
}
