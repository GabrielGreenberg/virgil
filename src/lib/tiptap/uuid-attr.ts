import { Extension } from "@tiptap/react";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";
import { isAnchorableNode } from "@/lib/marginalia";

/**
 * Shared spec for the `uuid` attribute used by every anchorable node type.
 *
 * The UUID lives in node attrs (ProseMirror state). It is NOT serialized
 * to HTML on copy-paste — `parseHTML` returns null so paste always
 * produces a node without a UUID, which `ensureAnchorUuid` then hydrates
 * with a fresh one. That keeps UUIDs unique within a doc.
 *
 * Note: `renderHTML` here is only honored for nodes WITHOUT a custom
 * NodeView. Most anchorable nodes in Virgil (paragraph, heading, list,
 * blockquote-ish, code, math, latex-comment, expex, figure, etc.) DO
 * have NodeViews, so we cannot rely on renderHTML to put `data-uuid` on
 * the live DOM. That job belongs to `UuidAttrDecorator` below, which
 * uses a ProseMirror Decoration to set `data-uuid` on every anchorable
 * node's outer DOM element — works uniformly whether or not the node
 * has a NodeView.
 *
 * Spread into an extension's `addAttributes()`:
 *
 *   addAttributes() {
 *     return {
 *       ...this.parent?.(),
 *       ...UUID_ATTR_SPEC,
 *       // other attrs…
 *     };
 *   }
 */
export const UUID_ATTR_SPEC = {
  uuid: {
    default: null as string | null,
    // Don't carry UUID across copy-paste — fresh node, fresh identity.
    parseHTML: () => null,
    // Cosmetic: when a node is serialized to HTML (export, devtools
    // inspect) and has no NodeView in the way, emit `data-uuid` so the
    // representation matches the live DOM. For NodeView-bearing nodes
    // this is dead code; the live attribute comes from the decoration.
    renderHTML: (attrs: Record<string, unknown>) => {
      const uuid = attrs.uuid;
      return typeof uuid === "string" && uuid ? { "data-uuid": uuid } : {};
    },
  },
};

/**
 * Walk the doc top-level and emit a `data-uuid` node-attribute decoration
 * for every anchorable block that has a UUID. Skips blocks whose UUID
 * is still null (lazy-hydration via `ensureAnchorUuid` happens on first
 * interaction — until then the block has no sticky identity to expose).
 */
function buildUuidDecorations(doc: PMNode): DecorationSet {
  const decos: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (!isAnchorableNode(node.type)) return true;
    const uuid = node.attrs?.uuid as string | null | undefined;
    if (uuid) {
      decos.push(
        Decoration.node(pos, pos + node.nodeSize, { "data-uuid": uuid }),
      );
    }
    // Don't recurse into anchorable containers — the deferring-parent
    // rule (see anchor-uuid.ts) means inner anchorables don't carry
    // their own identity.
    return false;
  });
  return decos.length > 0 ? DecorationSet.create(doc, decos) : DecorationSet.empty;
}

/**
 * TipTap extension that sets `data-uuid` on the outer DOM element of
 * every anchorable block, via a ProseMirror node-attribute decoration.
 *
 * Why a decoration and not `renderHTML` with `rendered: true`? Because
 * most anchorable nodes have a custom `NodeView`, and `renderHTML` does
 * not control the live DOM in that case — the NodeView's `dom` field
 * does. A node-attribute decoration is applied by ProseMirror to the
 * NodeView's outer element regardless of whether the node has one, so
 * it works uniformly across all anchorable types.
 *
 * Consumers: `useMarginaliaRegistry` looks up blocks via
 * `document.querySelector('[data-uuid="…"]')` and the gutter drag
 * hit-test uses `closest('[data-uuid]')`. Both depend on this
 * decoration being installed.
 */
export const UuidAttrDecorator = Extension.create({
  name: "uuidAttrDecorator",

  addProseMirrorPlugins() {
    const key = new PluginKey<DecorationSet>("uuidAttrDecorator");
    return [
      new Plugin<DecorationSet>({
        key,
        state: {
          init(_config, state) {
            return buildUuidDecorations(state.doc);
          },
          apply(tr, value, _oldState, newState) {
            // Re-walk when the doc has changed structurally. We can't
            // cheaply tell "was a UUID added/removed/changed" from the
            // step list, so on any docChanged we rebuild. The walk is
            // O(top-level blocks) which is cheap; the decoration map
            // diff is what we'd otherwise be paying for anyway.
            if (!tr.docChanged) {
              return value.map(tr.mapping, tr.doc);
            }
            return buildUuidDecorations(newState.doc);
          },
        },
        props: {
          decorations(state) {
            return key.getState(state) ?? DecorationSet.empty;
          },
        },
      }),
    ];
  },
});
