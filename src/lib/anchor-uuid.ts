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
 * Walk policy: a paragraph whose IMMEDIATE parent is a {@link DEFERRING_PARENTS}
 * container defers to that container — the parent is the real anchor target.
 * Inner-paragraph UUIDs inside those containers are stripped at serialization,
 * so anchoring to them is pointless.
 *
 * That last sentence was FALSE for two of the set's own members until task 346:
 * the `.tex` layer hand-listed three container names and never gained
 * `exampleItem`/`exampleBlock`, so every example body paragraph re-minted a
 * uuid on every open. The set is declared in `node-attr-sets.ts` now, where
 * both silos can read it.
 */

import type { EditorView } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";
import { isAnchorableNode } from "@/lib/marginalia";
import { generateShortId } from "@/lib/uuid";
import { markAnchorMint } from "@/lib/anchor-mint-signal";
import { isTextObjectKind } from "@/text-objects/text-object-registry";
import type { TextObjectKind } from "@/text-objects/types";

/**
 * The SSOT set of container kinds whose DIRECT-child `paragraph` defers its
 * anchor identity to the container — the container is the real text-object, and
 * the inner-paragraph uuid is stripped at serialization, so anchoring to it (or
 * grabbing it as its own text-object) is pointless and produces a phantom
 * second handle ON the body text (backlog #49).
 *
 * **Re-exported from [node-attr-sets.ts](./node-attr-sets.ts), where it now
 * lives** (task 346). It was declared here, and the `.tex` layer cannot import
 * this module — `EditorView`, `@/lib/marginalia` and the text-object registry
 * all arrive with it — so `latex-serializer.ts` re-typed the rule as a
 * `CONTAINER_TYPES` literal in three places. When `exampleItem`/`exampleBlock`
 * were added here, none of the three followed, and the stripping the doc
 * comment above promises simply did not happen for them. The set moved to the
 * import-free leaf so both silos read one declaration; every editor-side call
 * site is unchanged.
 */
export { DEFERRING_PARENTS } from "@/lib/node-attr-sets";
import { DEFERRING_PARENTS } from "@/lib/node-attr-sets";

/**
 * True iff `node` is a `paragraph` whose immediate `parent` is a
 * DEFERRING_PARENT container — i.e. an inner body paragraph that defers its
 * anchor identity to the container and must NOT receive its own uuid / grab
 * handle. The single predicate every surface uses (mint resolve, backfill,
 * decoration walk) so the "what is a grabbable text-object" boundary can't
 * drift between them.
 */
export function isDeferredInnerParagraph(
  node: { type: { name: string } },
  parent: { type: { name: string } } | null | undefined,
): boolean {
  return (
    node.type.name === "paragraph" &&
    !!parent &&
    DEFERRING_PARENTS.has(parent.type.name)
  );
}

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
    if (depth > 0 && isDeferredInnerParagraph(node, $pos.node(depth - 1))) {
      continue;
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
 * The anchorable UUID governing document position `pos` — the uuid of the
 * nearest ancestor that OWNS anchor identity, honoring the DEFERRING_PARENTS
 * rule: a deferred inner `paragraph` is SKIPPED in favour of its container (the
 * same policy {@link resolveAnchorableNode} applies for coordinate hits), so a
 * position inside a bullet-list item / blockquote / expex example resolves to
 * the CONTAINER uuid, not the deferred inner paragraph's (which never carries
 * one). Returns null when no governing ancestor carries a uuid, or `pos` is out
 * of range.
 *
 * This is the load/reconcile-path twin of `resolveAnchorableNode` (which needs
 * an `EditorView` for coordinate resolution): it works off a bare `doc` + `pos`
 * for the mark-scan reconcilers (`reconcileRequestMarks`' PRESENT scan) that
 * walk text descendants and must map each in-text mark back to its CONTAINER
 * anchor uuid. Reading the immediate text-parent uuid instead resolves a
 * container-anchored mark to the deferred inner paragraph's absent uuid `""`,
 * which never equals the desired container uuid → the mark is stripped and
 * re-stamped on every reconcile (thrash). See task 271.
 */
export function anchorableUuidAt(doc: PMNode, pos: number): string | null {
  try {
    const $pos = doc.resolve(pos);
    for (let depth = $pos.depth; depth >= 0; depth--) {
      const node = $pos.node(depth);
      if (depth > 0 && isDeferredInnerParagraph(node, $pos.node(depth - 1))) {
        continue; // deferred inner paragraph — its container owns anchor identity
      }
      if (node.attrs?.uuid) return node.attrs.uuid as string;
    }
  } catch {
    // pos out of range
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
