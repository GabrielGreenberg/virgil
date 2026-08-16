/**
 * Per-NODE product caches — keyed on PM NODE IDENTITY.
 *
 * ProseMirror nodes are immutable and persistent: an untouched node keeps the
 * same object reference across transactions, so a WeakMap keyed on the node IS
 * the incremental diff — a miss means the node changed, a hit means its
 * serialized products are still exact. This is the shipped `exampleLatexCache`
 * pattern (Editor.tsx) generalized (perf plan Wave 1 / P2). No pruner: old
 * nodes are released when unreferenced; the one retention source is undo
 * history pinning old doc trees, which bounds stale entries by history depth.
 *
 * NOT keyed on uuid: blank paragraphs serialize `%!v:blank` without one,
 * and node identity is strictly finer-grained anyway.
 *
 * ## Granularity stops at the container, unless the cache recurses (task 337)
 *
 * PM re-creates every ANCESTOR of an edited node, so a cache keyed on top-level
 * children alone answers "what changed?" with "the whole top-level block". For
 * a paragraph that is the truth; for a container it is off by the container's
 * size. A keystroke in item 50 of a 100-item enumeration invalidated the list,
 * and both products were re-derived whole — a full `toJSON()` deep clone in the
 * 300 ms interactive tier (landing exactly as the user resumes typing after a
 * think-pause) and a full LaTeX re-serialization in the idle tier.
 *
 * So both products are now COMPOSITIONAL:
 *
 *  - **JSON** — `getNodeJson` composes a container's JSON from its children's
 *    cached JSON instead of calling `node.toJSON()`. Unchanged children keep
 *    their object identity at EVERY depth, so the cost of a keystroke is
 *    O(depth), not O(container). The compose predicate is SCHEMA-derived
 *    (`isBlock && !isTextblock`), so it needs no per-kind list and covers every
 *    container the schema has or gains: the boundary is exactly the schema's
 *    own block↔inline line, which is also where `toJSON` stops being expensive.
 *  - **LaTeX** — `getBlockLatex` passes `serializeMemo` down, so the serializer
 *    can reuse a child's bytes wherever a container's assembly is a pure
 *    concatenation of per-child pure functions (lists, blockquotes, list-item
 *    tails today; see the serializer's child-part memo header for why the expex
 *    walkers are deliberately NOT memoized — their separators are chosen from
 *    the previous piece's TYPE, and an example is bounded by its own construct
 *    where an enumeration is not).
 *
 * The JSON memo is what makes the LaTeX memo sound: it keys on JSON-object
 * identity, and only because composed JSON is cached per PM node (and never
 * mutated — see the read-only contract `writeDocBundle` / `needsUuidWork`
 * depend on) is that a faithful proxy for node identity.
 */

import type { Node as PMNode } from "@tiptap/pm/model";
import type { JSONContent } from "@tiptap/react";
import {
  serializeTopLevelBlock,
  type SerializedPart,
  type SerializeMemo,
  type TopLevelBlockLatex,
} from "@/lib/latex-serializer";

const nodeJsonCache = new WeakMap<PMNode, JSONContent>();
const blockLatexCache = new WeakMap<PMNode, TopLevelBlockLatex>();
/** Child-part memo for the serializer, keyed on the composed JSON object. */
const childPartCache = new WeakMap<JSONContent, Map<number, SerializedPart>>();

/** Probe counters (read via __docProductsStats). */
export const blockCacheStats = {
  jsonMisses: 0,
  jsonHits: 0,
  latexMisses: 0,
  latexHits: 0,
  /** Container CHILDREN re-serialized (task 337). One keystroke in a list
   *  must move this by the touched item's own subtree, never by the list. */
  partMisses: 0,
  partHits: 0,
};

/**
 * True where composing this node's JSON from per-child entries pays: a BLOCK
 * whose content is other blocks. A textblock's children are inline nodes —
 * `toJSON()` on them is cheap and per-child WeakMap entries would cost more
 * than they save — and an atom has no children at all.
 */
function composesFromChildren(node: PMNode): boolean {
  return node.isBlock && !node.isTextblock && node.content.size > 0;
}

/**
 * Mirror of prosemirror-model's `Node.toJSON`, with the content array built
 * from cached child entries. Byte-identical output, including PM's own
 * attrs-by-REFERENCE sharing (`obj.attrs = this.attrs`) — pinned by a
 * deep-equality leg against the real `toJSON` in the suite.
 */
function composeJson(node: PMNode): JSONContent {
  const obj: JSONContent = { type: node.type.name };
  for (const _ in node.attrs) {
    obj.attrs = node.attrs as Record<string, unknown>;
    break;
  }
  const content: JSONContent[] = [];
  node.forEach((child) => {
    content.push(getNodeJson(child));
  });
  if (content.length) obj.content = content;
  if (node.marks.length) obj.marks = node.marks.map((m) => m.toJSON());
  return obj;
}

/**
 * The shared JSON for one node. READ-ONLY for every caller: entries are shared
 * across generations and across the whole product pipeline, so a mutation
 * poisons every consumer's snapshot (see `needsUuidWork`'s deep-copy guard).
 *
 * Module-PRIVATE on purpose: `getBlockJson` is the one door, so nothing
 * outside this file can address a node at an arbitrary depth and start
 * treating a shared sub-entry as its own. A sibling call is not a consumer.
 */
function getNodeJson(node: PMNode): JSONContent {
  const hit = nodeJsonCache.get(node);
  if (hit) {
    blockCacheStats.jsonHits++;
    return hit;
  }
  blockCacheStats.jsonMisses++;
  const json = composesFromChildren(node)
    ? composeJson(node)
    : (node.toJSON() as JSONContent);
  nodeJsonCache.set(node, json);
  return json;
}

/** Top-level entry point (unchanged name — the pipeline's doc children). */
export function getBlockJson(node: PMNode): JSONContent {
  return getNodeJson(node);
}

const serializeMemo: SerializeMemo = {
  get(node, ctx) {
    const hit = childPartCache.get(node)?.get(ctx);
    if (hit) blockCacheStats.partHits++;
    else blockCacheStats.partMisses++;
    return hit;
  },
  set(node, ctx, part) {
    let byCtx = childPartCache.get(node);
    if (!byCtx) {
      byCtx = new Map();
      childPartCache.set(node, byCtx);
    }
    byCtx.set(ctx, part);
  },
};

export function getBlockLatex(node: PMNode): TopLevelBlockLatex {
  const hit = blockLatexCache.get(node);
  if (hit) {
    blockCacheStats.latexHits++;
    return hit;
  }
  blockCacheStats.latexMisses++;
  const part = serializeTopLevelBlock(getNodeJson(node), serializeMemo);
  blockLatexCache.set(node, part);
  return part;
}
