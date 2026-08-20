import { Node, mergeAttributes, ReactNodeViewRenderer } from "@tiptap/react";
import ForestBlockNodeView from "@/components/ForestBlockNodeView";
import { UUID_ATTR_SPEC } from "./uuid-attr";

/**
 * `forestBlock` — a `\begin{forest}…\end{forest}` environment, carried WHOLE.
 *
 * **The model is the bytes.** The authoritative attr is `source`: the entire
 * environment exactly as it was read, opener arguments and closer included. The
 * serializer emits it byte-for-byte plus the block's `%!v:` anchor, so
 * round-trip identity is a property of the representation rather than of a
 * structured model staying faithful — the `graphicsBlock.command` /
 * `texBlock.code` shape, one environment over.
 *
 * That is what satisfies the 342/356 refuse-whole law trivially: there is no
 * structured tree at the DOCUMENT layer to lose anything, so a renderer (task
 * 384) is a pure derivation over `source` that cannot subtract from it. A
 * renderer that meets syntax it does not understand refuses VISIBLY and the
 * bytes are untouched, exactly as an unmodelled env's carrier does today —
 * which is the behaviour this node must never regress below.
 *
 * Attr set mirrors `texBlock`'s (uuid + parTitle + collapsed), so the sidecar
 * round trip, the marginalia anchor and the fold state work by the existing
 * machinery — membership is declared in `node-attr-sets.ts` and CHECKED there
 * against the live schema.
 */
export interface ForestBlockOptions {
  /** Stamp gate for the NodeView data-uuid/kind exposure: only the MAIN
   *  document surface carries the attributes (decorator parity). */
  surface: "main" | "float";
  /** Compact static preview for every card-bearing rich-text surface, so a
   *  captured excerpt holding a tree round-trips instead of being silently
   *  dropped as an unknown node (the capture/schema-symmetry law). */
  cardContext: boolean;
}

export const ForestBlock = Node.create<ForestBlockOptions>({
  name: "forestBlock",
  group: "block textObject",
  atom: true,
  // PM would otherwise create a NodeSelection on mousedown that scrolls the
  // row before the pod's editor gets focus — `texBlock`'s rationale verbatim.
  selectable: false,

  addOptions() {
    return {
      cardContext: false,
      surface: "float" as "main" | "float",
    };
  },

  addAttributes() {
    return {
      /** The WHOLE `\begin{forest}…\end{forest}` slice, verbatim. */
      source: { default: "" },
      uuid: UUID_ATTR_SPEC.uuid,
      // Optional user-supplied title shown above the pod via the +T
      // affordance; persisted in the sidecar keyed by uuid (never emitted to
      // the `.tex`) — see `TITLED_NODE_TYPES`.
      parTitle: { default: null, renderHTML: () => ({}) },
      // Sticky collapse state, persisted beside `parTitle` — see
      // `COLLAPSIBLE_NODE_TYPES`.
      collapsed: { default: false, renderHTML: () => ({}) },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="forest-block"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, { "data-type": "forest-block" }),
    ];
  },

  addNodeView() {
    const surface = this.options.surface;
    return ReactNodeViewRenderer(ForestBlockNodeView, {
      attrs: ({ node }): Record<string, string> =>
        surface === "main" && node.attrs.uuid
          ? {
              "data-uuid": node.attrs.uuid as string,
              "data-text-object-kind": node.type.name,
            }
          : {},
    });
  },
});
