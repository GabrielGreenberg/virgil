import {
  Node,
  mergeAttributes,
  ReactNodeViewRenderer,
  NodeViewContent,
  NodeViewWrapper,
} from "@tiptap/react";
import {
  SlotTextblockDeleteGuard,
  SlotTextblockEnterGuard,
} from "./slot-textblock-keymap";

// Inline-editable caption for `figureBlock`. Holds paragraph-grade content
// (`inline*`) so citations, footnotes, math, and inline marks all work
// natively — same content schema as a paragraph.
//
// The `Figure N:` bold prefix is rendered by the parent figureBlock's
// NodeView, not here — this node is just the pure inline-text container.
//
// The NodeView is configured with `as: "span"` + `contentDOMElementTag:
// "span"` so the caption renders inline with the prefix instead of getting
// wrapped in a block-level div (Tiptap's default for non-inline nodes).
//
// A SLOT, not a block (task 1042): no `group`, so `figureBlock`'s own content
// expression is the ONLY place the schema admits a caption — the
// `proseGlossRow`/`glossCell` precedent. In the `block` group a caption was a
// legal free-standing block, so every generic lift (`liftEmptyBlock` on Enter,
// `joinBackward`'s lift on Backspace at its start, `joinForward` from the
// paragraph above) could pull it OUT of its figure and drop the image. The
// figure side of the same boundary is `figureBlock.isolating`; the keyboard
// side (Enter, and Delete/Backspace in an empty caption) is the slot-textblock
// keymap registered below.
export const FigureCaption = Node.create({
  name: "figureCaption",
  content: "inline*",
  defining: true,
  selectable: false,

  addExtensions() {
    // Rides with the node, so EVERY surface that can host a caption (main,
    // floats, the borrowed card schemas) gets the same Enter answer.
    return [SlotTextblockDeleteGuard, SlotTextblockEnterGuard];
  },

  parseHTML() {
    return [{ tag: 'span[data-type="figure-caption"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, { "data-type": "figure-caption" }),
      0,
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(FigureCaptionNodeView, {
      as: "span",
      contentDOMElementTag: "span",
    });
  },
});

function FigureCaptionNodeView() {
  return (
    <NodeViewWrapper as="span" className="figure-caption-text">
      <NodeViewContent<"span"> as="span" />
    </NodeViewWrapper>
  );
}
