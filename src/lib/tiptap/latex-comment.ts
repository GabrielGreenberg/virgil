import { Node, mergeAttributes } from "@tiptap/react";
import { NodeSelection, Plugin, PluginKey } from "@tiptap/pm/state";
import { editableAtomView } from "./editable-atom-view";
import { UUID_ATTR_SPEC } from "./uuid-attr";

// Flag: when a LatexComment is created via input rule, auto-focus it
let _pendingAutoFocusComment = false;

// `cardContext`: when true, the input-rule plugins are suppressed and the
// NodeView renders a static `% text` row. Set by every card-bearing
// rich-text surface (RichTextField) so latexComment atoms round-trip
// without being silently dropped, and so typing `% ` in a note body
// doesn't get auto-transformed into a latexComment atom.
export interface LatexCommentOptions {
  cardContext: boolean;
}

export const LatexComment = Node.create<LatexCommentOptions>({
  name: "latexComment",
  group: "block textObject",
  atom: true,

  addOptions() {
    return {
      cardContext: false,
    };
  },

  addAttributes() {
    return {
      text: { default: "" },
      uuid: UUID_ATTR_SPEC.uuid,
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="latex-comment"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-type": "latex-comment",
        class: "latex-comment",
      }),
      `% ${HTMLAttributes.text || ""}`,
    ];
  },

  addKeyboardShortcuts() {
    return {
      Delete: ({ editor }) => {
        const { selection } = editor.state;
        if (selection instanceof NodeSelection && selection.node.type.name === "latexComment") {
          editor.commands.deleteSelection();
          return true;
        }
        return false;
      },
      Backspace: ({ editor }) => {
        const { selection } = editor.state;
        if (selection instanceof NodeSelection && selection.node.type.name === "latexComment") {
          editor.commands.deleteSelection();
          return true;
        }
        return false;
      },
    };
  },

  addProseMirrorPlugins() {
    // Card surfaces shouldn't auto-transform user-typed `% ` into a
    // latexComment atom — the user might legitimately want a `% `
    // literal in their note / archive title. The schema still accepts
    // latexComment for incoming JSONContent so round-tripping works.
    if (this.options.cardContext) return [];
    const nodeType = this.type;
    return [
      new Plugin({
        key: new PluginKey("latexCommentInput"),
        props: {
          handleTextInput(view, from, _to, text) {
            // Only trigger on "%" or " " after "%"
            if (text !== "%" && text !== " ") return false;
            const { state } = view;
            const $from = state.doc.resolve(from);
            const textBefore = $from.parent.textBetween(0, $from.parentOffset, undefined, "\ufffc");
            const combined = textBefore + text;
            if (!combined.match(/^% ?$/)) return false;

            const blockStart = $from.start();
            const blockEnd = $from.end();
            const fullText = state.doc.textBetween(blockStart, blockEnd, "", "");
            const commentText = (fullText.startsWith("%") ? fullText : text + fullText.slice($from.parentOffset)).replace(/^% ?/, "");
            const tr = state.tr.replaceWith(blockStart - 1, blockEnd + 1, nodeType.create({ text: commentText }));
            view.dispatch(tr);
            _pendingAutoFocusComment = !commentText;
            return true;
          },
        },
      }),
      // Also catch paragraphs that start with "% " via appendTransaction,
      // in case handleTextInput misses it (e.g. paste, or typing % before existing text)
      new Plugin({
        key: new PluginKey("latexCommentNormalize"),
        appendTransaction(transactions, _oldState, newState) {
          if (!transactions.some((tr) => tr.docChanged)) return null;
          const { doc } = newState;
          const paragraphType = newState.schema.nodes.paragraph;
          const changes: Array<{ pos: number; size: number; text: string }> = [];
          doc.forEach((node, pos) => {
            if (node.type !== paragraphType) return;
            const text = node.textContent;
            if (text.startsWith("% ") || text === "%") {
              const commentText = text.replace(/^% ?/, "");
              changes.push({ pos, size: node.nodeSize, text: commentText });
            }
          });
          if (changes.length === 0) return null;
          const tr = newState.tr;
          for (const c of [...changes].reverse()) {
            tr.replaceWith(c.pos, c.pos + c.size, nodeType.create({ text: c.text }));
          }
          _pendingAutoFocusComment = changes.some((c) => !c.text);
          return tr;
        },
      }),
    ];
  },

  addNodeView() {
    const cardContext = this.options.cardContext;
    return ({ node, getPos, editor }) => {
      // Card-context: static `% text` row in muted gray, no click-to-
      // edit affordance. The node spec is identical to the main-doc
      // form so JSON round-trips intact.
      if (cardContext) {
        const dom = document.createElement("div");
        dom.className = "latex-comment latex-comment-card";
        dom.contentEditable = "false";
        dom.style.color = "var(--ink-muted)";
        dom.style.fontFamily = "var(--font-mono), 'SF Mono', 'Fira Code', monospace";
        dom.style.fontSize = "12px";
        dom.style.padding = "2px 0";
        dom.textContent = `% ${(node.attrs.text as string) || ""}`;
        return { dom };
      }
      const result = editableAtomView({
        node,
        getPos,
        editor,
        tag: "div",
        className: "latex-comment",
        attrName: "text",
        prefix: "% ",
        handleBar: true,
      });
      // If this node was just created via input rule, auto-focus
      if (_pendingAutoFocusComment) {
        _pendingAutoFocusComment = false;
        const tryFocus = (attempts: number) => {
          setTimeout(() => {
            if (result.dom.isConnected) {
              result.enterEditMode();
            } else if (attempts > 0) {
              tryFocus(attempts - 1);
            }
          }, 30);
        };
        tryFocus(5);
      }
      return result;
    };
  },
});
