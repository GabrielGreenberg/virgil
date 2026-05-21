import {
  Node,
  mergeAttributes,
  ReactNodeViewRenderer,
  NodeViewContent,
  NodeViewWrapper,
} from "@tiptap/react";

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
export const FigureCaption = Node.create({
  name: "figureCaption",
  group: "block",
  content: "inline*",
  defining: true,
  selectable: false,

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
