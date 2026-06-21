import { Extension } from "@tiptap/react";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";
import { isAnchorableNode } from "@/lib/marginalia";
import { isDeferredInnerParagraph } from "@/lib/anchor-uuid";
import { readPendingDiff } from "@/lib/tiptap/doc-structure";

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
 * Walk every level of the doc and emit a `data-uuid` node-attribute
 * decoration for every anchorable block that has a UUID. Skips blocks
 * whose UUID is still null (lazy-hydration via `ensureAnchorUuid`
 * happens on first interaction — until then the block has no sticky
 * identity to expose).
 */
// Exported for the #49 decoration-gate regression test (it must assert that a
// container-nested body paragraph yields NO `data-uuid` decoration, the spec
// the grab-handle hover scan keys on). Otherwise an internal of the plugin.
export function buildUuidDecorations(doc: PMNode): DecorationSet {
  const decos: Decoration[] = [];
  doc.descendants((node, pos, parent) => {
    if (!isAnchorableNode(node.type)) return true;
    // A container-nested body paragraph (listItem / blockquote / codeBlock /
    // exampleItem / exampleBlock) defers its anchor identity to its container —
    // the container IS the grabbable text-object. It must NOT be decorated even
    // if it carries a stale/leftover uuid (a session-minted one before the mint
    // sites deferred it, or one loaded from an older .tex): the `data-uuid`
    // decoration is what the grab-handle hover scan keys on, so decorating it
    // produces a phantom SECOND handle ON the body text, right of the marker
    // (backlog #49 — single-example `(16)` + multi-example `b.`). This is the
    // authoritative gate; the mint sites (anchor-uuid / block-uuid-backfill)
    // merely stop creating the uuid, but a pre-existing one must still be
    // suppressed here. Same predicate as both mint sites (SSOT).
    if (isDeferredInnerParagraph(node, parent)) return true;
    const uuid = node.attrs?.uuid as string | null | undefined;
    if (uuid) {
      decos.push(
        Decoration.node(pos, pos + node.nodeSize, {
          "data-uuid": uuid,
          "data-text-object-kind": node.type.name,
        }),
      );
    }
    // Walk into anchorable containers: listItem and exampleItem are
    // themselves anchorable text objects (Phase B+ of the TextObject
    // refactor).
    return true;
  });
  return decos.length > 0 ? DecorationSet.create(doc, decos) : DecorationSet.empty;
}

/**
 * TipTap extension that sets `data-uuid` and `data-text-object-kind`
 * on the outer DOM element of every anchorable block, via a single
 * ProseMirror node-attribute decoration.
 *
 * Why a decoration and not `renderHTML` with `rendered: true`? Because
 * most anchorable nodes have a custom `NodeView`, and `renderHTML` does
 * not control the live DOM in that case — the NodeView's `dom` field
 * does. A node-attribute decoration is applied by ProseMirror to the
 * NodeView's outer element regardless of whether the node has one, so
 * it works uniformly across all anchorable types.
 *
 * Consumers:
 *   - `useMarginaliaRegistry` looks up blocks via
 *     `document.querySelector('[data-uuid="…"]')` and the margin drag
 *     hit-test uses `closest('[data-uuid]')`.
 *   - `TextObjectGrabHandle`'s hover resolver walks `closest('[data-uuid]')`
 *     ancestors and reads `data-text-object-kind` directly from DOM —
 *     no doc walk needed per mousemove.
 * Both depend on this decoration being installed.
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
            // Step 1: cheap forward map for any existing decorations
            // whose position shifted. Microseconds for a doc with N
            // decorations, no matter how big N is.
            let set = value.map(tr.mapping, tr.doc);
            if (!tr.docChanged) return set;

            // Step 2: consult the observer's diff. Add decorations for
            // any UUID that became live this transaction, drop them
            // for any UUID that left. The diff is computed once by
            // DocStructureObserver upstream of every consumer; we just
            // read its output.
            const diff = readPendingDiff(newState);
            if (!diff) {
              // Observer plugin not installed (e.g. tests). Fall back
              // to a full rebuild — correct, just slower.
              return buildUuidDecorations(newState.doc);
            }

            // Remove decorations for vanished UUIDs.
            if (diff.removedBlocks.length > 0) {
              const removedUuids = new Set(diff.removedBlocks.map((b) => b.uuid));
              const survivors = set.find().filter((d) => {
                const spec = (d as Decoration & { type?: { attrs?: Record<string, string> } });
                const uuid = spec.type?.attrs?.["data-uuid"];
                return !uuid || !removedUuids.has(uuid);
              });
              set = DecorationSet.create(newState.doc, survivors);
            }

            // Add decorations for newly-arrived UUIDs.
            if (diff.addedBlocks.length > 0) {
              const adds: Decoration[] = [];
              for (const b of diff.addedBlocks) {
                const node = newState.doc.nodeAt(b.pos);
                if (!node || !isAnchorableNode(node.type)) continue;
                // Suppress a container-nested body paragraph (#49) — same gate
                // as buildUuidDecorations. The parent is the node enclosing
                // b.pos; resolve(b.pos).parent IS that immediate container
                // (b.pos is the position just before the block's open token).
                if (
                  node.type.name === "paragraph" &&
                  isDeferredInnerParagraph(
                    node,
                    newState.doc.resolve(b.pos).parent,
                  )
                ) {
                  continue;
                }
                adds.push(
                  Decoration.node(b.pos, b.pos + node.nodeSize, {
                    "data-uuid": b.uuid,
                    "data-text-object-kind": node.type.name,
                  }),
                );
              }
              if (adds.length > 0) set = set.add(newState.doc, adds);
            }

            return set;
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
