import { Node, Extension, mergeAttributes } from "@tiptap/react";
import { Plugin, PluginKey } from "@tiptap/pm/state";

/**
 * Clears parTitle (and uuid) from empty paragraphs.
 * This prevents stranded titles when a paragraph is split (e.g. Enter at start).
 */
export const EmptyParagraphTitleCleaner = Extension.create({
  name: "emptyParagraphTitleCleaner",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("emptyParagraphTitleCleaner"),
        appendTransaction(transactions, _oldState, newState) {
          if (!transactions.some((tr) => tr.docChanged)) return null;

          const { doc, schema } = newState;
          const paragraphType = schema.nodes.paragraph;
          let tr: typeof newState.tr | null = null;

          doc.forEach((node, pos) => {
            if (node.type !== paragraphType) return;
            if (!node.attrs.parTitle) return;
            // If paragraph has no text content, clear its title and uuid
            if (node.textContent.trim() === "") {
              if (!tr) tr = newState.tr;
              tr.setNodeMarkup(pos, undefined, { ...node.attrs, parTitle: null, uuid: null });
            }
          });

          return tr;
        },
      }),
    ];
  },
});

const FIELD_LABELS: Record<string, string> = {
  title: "Title",
  author: "Author",
  date: "Date",
};

/** Block node with editable content, annotated "Title" / "Author" / "Date". */
export const TitleField = Node.create({
  name: "titleField",
  group: "block",
  content: "inline*",

  addAttributes() {
    return {
      field: { default: "title" },
      rawPrefix: { default: null },
      isToday: { default: false },
      uuid: { default: null, rendered: false },
      // True when this title/author/date originated from the preamble
      // (i.e. before `\begin{document}`). Serializer uses this flag to
      // emit the command back into the preamble instead of the body.
      fromPreamble: { default: false, rendered: false },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="title-field"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-type": "title-field",
        "data-field": HTMLAttributes.field,
      }),
      0,
    ];
  },

  addNodeView() {
    return ({ node }) => {
      const wrapper = document.createElement("div");
      wrapper.className = "title-field-wrapper";

      const content = document.createElement("div");
      content.className = `title-field-content${node.attrs.field === "title" ? " title-field-title" : ""}`;
      wrapper.appendChild(content);

      const annot = document.createElement("div");
      annot.className = "title-field-annotation";
      annot.contentEditable = "false";
      annot.textContent = FIELD_LABELS[node.attrs.field as string] || node.attrs.field;
      wrapper.appendChild(annot);

      return {
        dom: wrapper,
        contentDOM: content,
        update(updatedNode) {
          if (updatedNode.type.name !== "titleField") return false;
          annot.textContent = FIELD_LABELS[updatedNode.attrs.field as string] || updatedNode.attrs.field;
          return true;
        },
      };
    };
  },
});

/**
 * Hidden atom block that stands in for `\maketitle`. The title block
 * is already visible in the editor as `titleField` nodes, so we don't
 * need to render the `\maketitle` command itself — but we do need a
 * node to round-trip through the LaTeX source.
 */
export const MaketitleMarker = Node.create({
  name: "maketitleMarker",
  group: "block",
  atom: true,

  addAttributes() {
    return {
      uuid: { default: null, rendered: false },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="maketitle-marker"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-type": "maketitle-marker",
        class: "maketitle-marker",
      }),
    ];
  },

  addNodeView() {
    return () => {
      const wrapper = document.createElement("div");
      wrapper.className = "maketitle-marker";
      wrapper.setAttribute("data-type", "maketitle-marker");
      return { dom: wrapper };
    };
  },
});
