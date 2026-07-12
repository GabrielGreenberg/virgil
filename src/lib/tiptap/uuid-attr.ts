import type { Node as PMNode } from "@tiptap/pm/model";
import { isDeferredInnerParagraph } from "@/lib/anchor-uuid";

/**
 * Shared spec for the `uuid` attribute used by every anchorable node type.
 *
 * The UUID lives in node attrs (ProseMirror state). It is NOT serialized
 * to HTML on copy-paste — `parseHTML` returns null so paste always
 * produces a node without a UUID, which `ensureAnchorUuid` then hydrates
 * with a fresh one. That keeps UUIDs unique within a doc.
 *
 * DOM exposure (typing-latency fix 2d — the per-block `UuidAttrDecorator`
 * decoration union is GONE; it cost a DecorationSet.map + a #blocks-sized
 * outer-deco reconcile per keystroke):
 *   - NodeView-bearing anchorable types stamp `data-uuid` +
 *     `data-text-object-kind` on their own outer `dom` via
 *     `stampTextObjectAttrs` below — at construction and again in
 *     `update()` when `attrs.uuid` changes (the BlockUuidBackfill mint
 *     arrives as an AttrStep, which fires `update`). MAIN surface only —
 *     the old decorator was main-only chrome, and `useMarginaliaRegistry`
 *     resolves blocks via document-global `[data-uuid="…"]` queries, so a
 *     popped-out float must not carry a second copy of the attribute.
 *   - NodeView-less anchorable types (listItem, blockquote, codeBlock) get
 *     both attributes from `renderHTML` via `makeUuidAttr(typeName)`.
 *
 * Spread into an extension's `addAttributes()`:
 *
 *   addAttributes() {
 *     return {
 *       ...this.parent?.(),
 *       ...UUID_ATTR_SPEC,          // NodeView-bearing type
 *       // or: uuid: makeUuidAttr("listItem"),  // renderHTML-rendered type
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
    // this is dead code; the live attributes come from the NodeView stamp.
    renderHTML: (attrs: Record<string, unknown>) => {
      const uuid = attrs.uuid;
      return typeof uuid === "string" && uuid ? { "data-uuid": uuid } : {};
    },
  },
};

/**
 * uuid attr spec for anchorable types WITHOUT a NodeView (listItem,
 * blockquote, codeBlock): their live DOM comes from `renderHTML`, so it must
 * emit BOTH `data-uuid` and `data-text-object-kind` (the grab-handle hover
 * resolver reads the kind straight off the DOM). NodeView-bearing types use
 * `UUID_ATTR_SPEC` + `stampTextObjectAttrs` instead.
 */
export function makeUuidAttr(typeName: string) {
  return {
    default: null as string | null,
    parseHTML: () => null,
    renderHTML: (attrs: Record<string, unknown>) => {
      const uuid = attrs.uuid;
      return typeof uuid === "string" && uuid
        ? { "data-uuid": uuid, "data-text-object-kind": typeName }
        : {};
    },
  };
}

/**
 * Stamp (or clear) `data-uuid` + `data-text-object-kind` on an anchorable
 * NodeView's outer element. O(1) per call — call at NodeView construction
 * and from `update()` when `attrs.uuid` changed.
 *
 * The #49 gate lives HERE: a container-nested body paragraph (listItem /
 * blockquote / codeBlock / exampleItem / exampleBlock) defers its anchor
 * identity to its container — the container IS the grabbable text-object.
 * It must NOT carry `data-uuid` even if it holds a stale/leftover uuid attr
 * (a session-minted one before the mint sites deferred it, or one loaded
 * from an older .tex): `data-uuid` is what the grab-handle hover scan keys
 * on, so stamping it would produce a phantom SECOND handle ON the body
 * text (backlog #49). Same predicate as the mint sites (SSOT).
 *
 * Consumers of the stamped attributes:
 *   - `useMarginaliaRegistry` looks up blocks via
 *     `document.querySelector('[data-uuid="…"]')`; the margin drag hit-test
 *     uses `closest('[data-uuid]')`.
 *   - `TextObjectGrabHandle`'s hover resolver walks `closest('[data-uuid]')`
 *     ancestors and reads `data-text-object-kind` directly from DOM.
 *   - section-folding's chevron resync resolves via `closest('[data-uuid]')`.
 */
export function stampTextObjectAttrs(
  dom: HTMLElement,
  node: PMNode,
  parent: PMNode | null,
): void {
  const uuid = node.attrs?.uuid as string | null | undefined;
  if (!uuid || isDeferredInnerParagraph(node, parent)) {
    if (dom.hasAttribute("data-uuid")) {
      dom.removeAttribute("data-uuid");
      dom.removeAttribute("data-text-object-kind");
    }
    return;
  }
  if (dom.getAttribute("data-uuid") !== uuid) {
    dom.setAttribute("data-uuid", uuid);
  }
  if (dom.getAttribute("data-text-object-kind") !== node.type.name) {
    dom.setAttribute("data-text-object-kind", node.type.name);
  }
}
