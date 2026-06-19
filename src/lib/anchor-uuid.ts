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
import { markAnchorMint } from "@/lib/anchor-mint-signal";
import { isTextObjectKind } from "@/text-objects/text-object-registry";
import type { TextObjectKind } from "@/text-objects/types";

const DEFERRING_PARENTS = new Set([
  "listItem",
  "blockquote",
  "codeBlock",
  "exampleItem",
]);

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
 * Resolve the anchorable node at `pos`, minting its UUID if missing, and
 * return the freshly-resolved `{ uuid, node }` pair WITHOUT a stale re-read of
 * the node after the `setNodeMarkup` dispatch.
 *
 * `setNodeMarkup` replaces the node in the doc, so re-reading `node.attrs.uuid`
 * off the OLD `resolveAnchorableNode` result (or re-resolving by position after
 * the dispatch) is fragile. Instead we keep the resolved `node` object — its
 * `type.name` is what callers need for the kind and is unchanged by the mint —
 * and return the uuid string we just generated. This is the single mint surface
 * both `ensureAnchorUuid` and `resolveAnchorUuidAndKind` factor through.
 *
 * Returns null when no anchorable node was found OR the mint dispatch threw.
 */
function ensureAnchorUuidNode(
  view: EditorView,
  pos: number,
): { uuid: string; node: PMNode } | null {
  const result = resolveAnchorableNode(view, pos);
  if (!result) return null;
  const { node, nodePos } = result;
  if (node.attrs?.uuid) return { uuid: node.attrs.uuid as string, node };
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
    // Tag the mint so the autosave forces an immediate doc-bundle flush — the
    // paragraph UUID must persist on the card's fast clock, not the doc's 1500 ms
    // clock (see @/lib/anchor-mint-signal + the SYNTHESIS memo).
    markAnchorMint(tr);
    view.dispatch(tr);
    // Return the uuid we just minted + the pre-mint node object. We do NOT
    // re-read `node.attrs.uuid` (the dispatched node is a fresh instance) — but
    // `node.type.name` is invariant across the mint, so the kind is faithful.
    return { uuid: newUuid, node };
  } catch {
    return null;
  }
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
  return ensureAnchorUuidNode(view, pos)?.uuid ?? null;
}

/**
 * Resolve the anchorable node at `pos` to `{ uuid, kind }`, minting the UUID if
 * missing. The `kind` is the resolved node's real type name when it is a
 * recognized text-object kind (heading, listItem, blockquote, codeBlock, …),
 * else `"paragraph"`.
 *
 * This is the Path-A primitive for the lightning/Cmd-/ action surface: it stops
 * the menu from flattening every caret anchor to a fake `{kind:"paragraph"}`
 * dispatch ref. `resolveAnchorableNode` already computes the real kind; this fn
 * surfaces it (alongside the uuid) so `runAction` can emit the REAL node kind
 * and `resolveRefRange` resolves a non-null range for heading/listItem carets
 * (the BUG2 fix — see docs/memos/action-menu-anchor-bugs/).
 *
 * Returns null on the same conditions as `ensureAnchorUuid` (no anchorable node
 * / mint dispatch threw), so callers can keep the old `if (!uuid) return;` gate.
 */
export function resolveAnchorUuidAndKind(
  view: EditorView,
  pos: number,
): { uuid: string; kind: TextObjectKind } | null {
  const resolved = ensureAnchorUuidNode(view, pos);
  if (!resolved) return null;
  const name = resolved.node.type.name;
  return {
    uuid: resolved.uuid,
    kind: isTextObjectKind(name) ? name : "paragraph",
  };
}
