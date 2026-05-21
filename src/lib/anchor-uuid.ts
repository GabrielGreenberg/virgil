/**
 * Anchor-UUID resolution + lazy hydration for the editor.
 *
 * Virgil paragraphs, headings, lists, list items, blockquotes, code blocks
 * and a few other block kinds declare a `uuid` attribute in the schema, but
 * the attribute defaults to null. UUIDs are *lazily* hydrated on interaction
 * — when the user reaches for an anchor (drag handle, drop target, action
 * button, etc.). This module is that hydration surface: every entry point
 * that needs a stable anchor identity should call `ensureAnchorUuid`.
 *
 * Walk policy: paragraphs nested inside `listItem` / `blockquote` / `codeBlock`
 * defer to their parent container — those parents are the real anchor target.
 * Inner-paragraph UUIDs inside those containers are stripped at serialization,
 * so anchoring to them is pointless.
 */

import type { EditorView } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";
import { isAnchorableNode } from "@/lib/marginalia";
import { generateShortId } from "@/lib/uuid";

const DEFERRING_PARENTS = new Set(["listItem", "blockquote", "codeBlock"]);

/**
 * Resolve a ProseMirror position to the nearest anchorable node, handling
 * both container nodes (paragraph, heading, list, listItem) and atom blocks
 * (displayMath, latexComment) where posAtCoords lands before/after the atom.
 *
 * A `paragraph` inside `listItem` / `blockquote` / `codeBlock` is skipped in
 * favour of the parent container — only one anchor identity per item, not
 * two.
 */
export function resolveAnchorableNode(
  view: EditorView,
  pos: number,
): { node: PMNode; nodePos: number } | null {
  const $pos = view.state.doc.resolve(pos);
  for (let depth = $pos.depth; depth >= 0; depth--) {
    const node = $pos.node(depth);
    if (!isAnchorableNode(node.type)) continue;
    if (depth > 0 && node.type.name === "paragraph") {
      const parent = $pos.node(depth - 1);
      if (DEFERRING_PARENTS.has(parent.type.name)) continue;
    }
    const nodePos = depth === 0 ? 0 : $pos.before(depth);
    return { node, nodePos };
  }
  // Fallback: check adjacent nodes (e.g. pos 0 is before the first heading)
  if ($pos.nodeAfter && isAnchorableNode($pos.nodeAfter.type)) {
    return { node: $pos.nodeAfter, nodePos: pos };
  }
  if ($pos.nodeBefore && isAnchorableNode($pos.nodeBefore.type)) {
    return { node: $pos.nodeBefore, nodePos: pos - $pos.nodeBefore.nodeSize };
  }
  return null;
}

/**
 * Ensure the anchorable node at `pos` has a UUID. Assigns one if missing.
 * Collects all existing UUIDs in the document to avoid collisions.
 * Returns the UUID or null if no anchorable node was found.
 */
export function ensureAnchorUuid(
  view: EditorView,
  pos: number,
): string | null {
  const result = resolveAnchorableNode(view, pos);
  if (!result) return null;
  const { node, nodePos } = result;
  if (node.attrs?.uuid) return node.attrs.uuid as string;
  const existing = new Set<string>();
  view.state.doc.descendants((n) => {
    if (n.attrs?.uuid) existing.add(n.attrs.uuid as string);
  });
  const newUuid = generateShortId(existing);
  try {
    const tr = view.state.tr.setNodeMarkup(nodePos, undefined, {
      ...node.attrs,
      uuid: newUuid,
    });
    tr.setMeta("addToHistory", false);
    view.dispatch(tr);
    return newUuid;
  } catch {
    return null;
  }
}
