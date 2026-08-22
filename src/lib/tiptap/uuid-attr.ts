import type { Node as PMNode } from "@tiptap/pm/model";
import { isDeferredInnerParagraph } from "@/lib/anchor-uuid";

/**
 * `UUID_ATTR_SPEC` / `makeUuidAttr` are DECLARED in the import-free leaf
 * `@/lib/node-attr-sets` (task 402) and re-exported here so every existing
 * importer is unchanged.
 *
 * They moved because they are two of the nineteen node x attr pairs
 * `MAIN_STARTERKIT_NODE_ATTRS` has to state, and that table cannot import this
 * module — `stampTextObjectAttrs` below reaches `@/lib/anchor-uuid`, which
 * reaches the editor. A spec spelled twice is a spec that can drift, and the
 * drift this whole cluster is about cost the user their `\label{}`s.
 *
 * DOM exposure (typing-latency fix 2d — the per-block `UuidAttrDecorator`
 * decoration union is GONE; it cost a DecorationSet.map + a #blocks-sized
 * outer-deco reconcile per keystroke):
 *   - NodeView-bearing anchorable types stamp `data-uuid` +
 *     `data-text-object-kind` on their own outer `dom` via
 *     `stampTextObjectAttrs` below — at construction and again in `update()`
 *     when `attrs.uuid` changes (the BlockUuidBackfill mint arrives as an
 *     AttrStep, which fires `update`). MAIN surface only — the old decorator
 *     was main-only chrome, and `useMarginaliaRegistry` resolves blocks via
 *     `[data-uuid="…"]` queries, so a popped-out float must not carry a second
 *     copy of the attribute. The EXCERPT card body is the same rule read one
 *     surface over: it takes the attrs through `dataOnlyAttrs`, so they exist
 *     in its schema and never reach its DOM.
 *   - NodeView-less anchorable types (listItem, blockquote, codeBlock) get both
 *     attributes from `renderHTML` via `makeUuidAttr(typeName)`.
 *
 * Spread into an extension's `addAttributes()`:
 *
 *   addAttributes() {
 *     return {
 *       ...this.parent?.(),
 *       ...MAIN_STARTERKIT_NODE_ATTRS.paragraph,   // the whole row (preferred)
 *     };
 *   }
 */
export { UUID_ATTR_SPEC, makeUuidAttr } from "@/lib/node-attr-sets";

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
