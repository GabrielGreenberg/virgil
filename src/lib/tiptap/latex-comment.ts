import { Node, mergeAttributes } from "@tiptap/react";
import { NodeSelection, TextSelection, Plugin, PluginKey } from "@tiptap/pm/state";
import type { NodeType, Schema } from "@tiptap/pm/model";
import { UUID_ATTR_SPEC, stampTextObjectAttrs } from "./uuid-attr";
import { chromeOnly } from "@/lib/view-only-chrome";
import { readPendingDiff, resolveTouchedBlock } from "./doc-structure";
import { refuseTypedInsertWhenReadOnly } from "./typed-latex-read-only-gate";

// `latexComment` is a real editable BLOCK node with native inline (`text*`)
// content — NOT an atom with its text stashed in an attr + a parallel
// `contentEditable` channel. Because the comment text is genuine ProseMirror
// content, PM owns the caret as a TextSelection, and the four atom-era symptoms
// dissolve natively:
//   (a) selection — the atom-era bespoke `.selected` box is retired; the
//       `.latex-comment.ProseMirror-selectednode` outline (the block-node SSOT,
//       matching expex) paints ONLY on a real NodeSelection (grab-handle /
//       arrow-nav). A caret resting inside is a native TextSelection, so editing
//       shows the ordinary text-selection highlight — no bespoke box, no
//       selectNode/deselectNode toggles.
//   (b) type `%` → caret inside immediately — the input rule places a native
//       TextSelection in the new node; no auto-focus race, no lost keystroke.
//   (c) Enter — the keymap inserts a paragraph AFTER the comment and lands the
//       caret there (a LaTeX comment is a single source line, so it never
//       splits into two comment nodes).
//   (d) lightning bolt — the caret is a TextSelection, so the SelectionActions
//       menu's NodeSelection bail no longer hides the bolt.
//
// `cardContext`: when true, the input-rule plugins are suppressed and the
// NodeView renders a static `% text` row. Set by every card-bearing rich-text
// surface (RichTextField / borrowed-schema) so latexComment nodes round-trip
// without being silently dropped, and so typing `% ` in a note body doesn't get
// auto-transformed into a latexComment.
export interface LatexCommentOptions {
  /** Stamp gate for the NodeView data-uuid/kind exposure (2d): only the
   *  MAIN document surface carries the attributes (decorator parity). */
  surface: "main" | "float";
  cardContext: boolean;
}

/** Build a latexComment node holding `text` as native inline content (empty
 *  content when text is ""). The text lives IN the node, not an attr. */
function makeComment(nodeType: NodeType, schema: Schema, text: string) {
  return nodeType.create(null, text ? schema.text(text) : null);
}

export const LatexComment = Node.create<LatexCommentOptions>({
  name: "latexComment",
  group: "block textObject",
  content: "text*",
  // A LaTeX comment is raw source text after `%` — no marks (bold/italic/etc.),
  // which keeps `.tex` serialization a trivial `% ${textContent}` and avoids
  // emitting meaningless `\textbf{}` inside a comment.
  marks: "",
  // …and `code` is the SAME FACT in the framework's own vocabulary (task 512).
  // `marks: ""` already says "byte-literal container": a node that admits no
  // marks can never wear a carrier, so Virgil has no way to label any of its
  // characters raw LaTeX — which is the prose index's own rule 2
  // (`blockCarriesProse`, `prose-index.ts`). `code` is what TipTap's INPUT-rule
  // runner reads to ask that question (`$from.parent.type.spec.code`), and
  // declaring one spelling without the other is how the two came to disagree:
  // every type-time transform fired inside a `%` comment. MEASURED on the
  // pre-512 tree, typing into a comment gave `% todo a–b “q” c—d` — curly
  // quotes and en/em dashes written straight into the comment BYTES — and
  // typing a backtick pair silently DELETED both backticks (StarterKit's `code`
  // mark rule matched, failed to apply a mark this node forbids, and kept its
  // deletion). The gate is the framework's, so it covers every input rule —
  // ours, upstream's, and the next one — where a predicate inside SmartQuotes
  // would have closed the typography half and left its worse sibling live.
  // The two spellings cannot drift again: `prose-index.test.ts` pins that
  // every markless textblock declares `code` and every `code` textblock is
  // markless.
  code: true,
  // …and the whitespace flip `code` would otherwise cause is DECLINED, not
  // inherited. ProseMirror derives `whitespace` from `code`
  // (`spec.whitespace || (spec.code ? "pre" : "normal")`), and "pre" changes
  // how the DOM PARSER reads this node's markup — which is a clipboard
  // behaviour with nothing to do with input rules, and one with a real hazard:
  // a comment is ONE `%` source line, so a newline preserved out of pasted
  // markup would emit `% line one\nline two` and put the second line LIVE in
  // the `.tex`. Stating "normal" keeps DOM parsing byte-identical to the
  // pre-512 tree; the input-rule gate is bought on its own.
  whitespace: "normal",
  // Self-contained source line: editing at its edges never merges its text into
  // adjacent prose (backspace-at-start of an empty comment is handled below).
  isolating: true,

  addOptions() {
    return {
      cardContext: false,
      // Stamp gate for the NodeView's data-uuid/kind exposure (2d): only the
      // MAIN document surface carries the attributes (decorator parity).
      surface: "float" as "main" | "float",
    };
  },

  addAttributes() {
    return {
      uuid: UUID_ATTR_SPEC.uuid,
    };
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="latex-comment"]',
        // The `% ` prefix is a non-editable widget, not content — only the
        // `.latex-comment-editable` span holds the real text.
        contentElement: ".latex-comment-editable",
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-type": "latex-comment",
        class: "latex-comment",
      }),
      ["span", { class: "latex-comment-prefix", contenteditable: "false" }, "% "],
      ["span", { class: "latex-comment-editable" }, 0],
    ];
  },

  addKeyboardShortcuts() {
    return {
      Enter: ({ editor }) => {
        const { state } = editor;
        const { selection } = state;
        if (!(selection instanceof TextSelection)) return false;
        const { $from } = selection;
        if ($from.parent.type.name !== "latexComment") return false;
        // Exit the comment: insert a paragraph immediately after it and land the
        // caret there (the expex "exit-to-new-line" pattern). Round-trip-safe —
        // a comment is one `%` source line, so Enter never produces multi-line
        // (uncommented) comment text.
        const after = $from.after($from.depth);
        const paragraph = state.schema.nodes.paragraph.create();
        const tr = state.tr.insert(after, paragraph);
        tr.setSelection(TextSelection.create(tr.doc, after + 1));
        tr.scrollIntoView();
        editor.view.dispatch(tr);
        return true;
      },
      Backspace: ({ editor }) => {
        const { selection } = editor.state;
        // Whole-node selection (grabbed via the handle / arrow-nav) → delete.
        if (
          selection instanceof NodeSelection &&
          selection.node.type.name === "latexComment"
        ) {
          editor.commands.deleteSelection();
          return true;
        }
        // Caret at the very start of an EMPTY comment → dissolve it back to a
        // plain paragraph (the user backspaced away the `% ` they just typed),
        // so they're never stuck with a phantom empty comment.
        if (selection instanceof TextSelection && selection.empty) {
          const { $from } = selection;
          if (
            $from.parent.type.name === "latexComment" &&
            $from.parentOffset === 0 &&
            $from.parent.content.size === 0
          ) {
            return editor.commands.setNode("paragraph");
          }
        }
        return false;
      },
      Delete: ({ editor }) => {
        const { selection } = editor.state;
        if (
          selection instanceof NodeSelection &&
          selection.node.type.name === "latexComment"
        ) {
          editor.commands.deleteSelection();
          return true;
        }
        return false;
      },
    };
  },

  addProseMirrorPlugins() {
    // Card surfaces shouldn't auto-transform user-typed `% ` into a
    // latexComment — the user might legitimately want a `% ` literal in their
    // note / archive title. The schema still accepts latexComment for incoming
    // JSONContent so round-tripping works.
    if (this.options.cardContext) return [];
    const nodeType = this.type;
    return [
      new Plugin({
        key: new PluginKey("latexCommentInput"),
        props: {
          handleTextInput(view, from, _to, text) {
            // CHIP 7b: uniform collab read-only gate (SSOT shared with the other
            // typed-LaTeX surfaces — cite/footnote/inline-math/display-math).
            if (refuseTypedInsertWhenReadOnly(view)) return false;
            // Only trigger on "%" or " " after "%"
            if (text !== "%" && text !== " ") return false;
            const { state } = view;
            const $from = state.doc.resolve(from);
            // Only transform a PARAGRAPH — never re-fire when the caret is
            // already inside a comment (typing `%`/` ` there is literal now
            // that comments hold native content).
            if ($from.parent.type.name !== "paragraph") return false;
            const textBefore = $from.parent.textBetween(
              0,
              $from.parentOffset,
              undefined,
              "￼",
            );
            const combined = textBefore + text;
            if (!combined.match(/^% ?$/)) return false;

            const blockStart = $from.start();
            const blockEnd = $from.end();
            const fullText = state.doc.textBetween(blockStart, blockEnd, "", "");
            const commentText = (fullText.startsWith("%")
              ? fullText
              : text + fullText.slice($from.parentOffset)
            ).replace(/^% ?/, "");
            const tr = state.tr.replaceWith(
              blockStart - 1,
              blockEnd + 1,
              makeComment(nodeType, state.schema, commentText),
            );
            // Land the caret INSIDE the new comment (native TextSelection), at
            // the start of its content — no auto-focus hack, no lost keystroke.
            // The comment node now sits at (blockStart - 1); its content
            // interior starts one position in, i.e. at blockStart.
            tr.setSelection(TextSelection.create(tr.doc, blockStart));
            view.dispatch(tr);
            return true;
          },
        },
      }),
      // Also catch paragraphs that start with "% " via appendTransaction, in
      // case handleTextInput misses it (e.g. paste). Gated on the observer's
      // diff: only the blocks whose content changed (or newly arrived) can
      // possibly start with "% " now — so we inspect just those instead of
      // every paragraph in the doc (keystroke sanctity).
      new Plugin({
        key: new PluginKey("latexCommentNormalize"),
        appendTransaction(transactions, _oldState, newState) {
          if (!transactions.some((tr) => tr.docChanged)) return null;
          const pending = readPendingDiff(newState);
          if (!pending) return null;

          // Candidate UUIDs: blocks whose content changed OR brand-new blocks.
          const candidateUuids = new Set<string>();
          for (const u of pending.contentChangedUuids) candidateUuids.add(u);
          for (const b of pending.addedBlocks) candidateUuids.add(b.uuid);
          if (candidateUuids.size === 0) return null;

          const paragraphType = newState.schema.nodes.paragraph;
          const changes: Array<{ pos: number; size: number; text: string }> = [];
          for (const uuid of candidateUuids) {
            const block = resolveTouchedBlock(newState, uuid);
            if (!block || block.typeName !== "paragraph") continue;
            const node = newState.doc.nodeAt(block.pos);
            if (!node || node.type !== paragraphType) continue;
            const text = node.textContent;
            if (text.startsWith("% ") || text === "%") {
              const commentText = text.replace(/^% ?/, "");
              changes.push({ pos: block.pos, size: node.nodeSize, text: commentText });
            }
          }
          if (changes.length === 0) return null;
          const tr = newState.tr;
          // Reverse-sort by pos so each replacement doesn't shift the next.
          changes.sort((a, b) => b.pos - a.pos);
          for (const c of changes) {
            tr.replaceWith(
              c.pos,
              c.pos + c.size,
              makeComment(nodeType, newState.schema, c.text),
            );
          }
          return tr;
        },
      }),
    ];
  },

  addNodeView() {
    const cardContext = this.options.cardContext;
    const surface = this.options.surface;
    return ({ node, getPos, editor }) => {
      // Card-context: static `% text` row in muted gray, no caret. The node
      // spec is identical to the main-doc form so JSON round-trips intact (the
      // content is preserved in the doc model even though the view is static).
      if (cardContext) {
        const dom = document.createElement("div");
        dom.className = "latex-comment latex-comment-card";
        dom.contentEditable = "false";
        dom.style.color = "var(--ink-muted)";
        dom.style.fontFamily = "var(--font-mono), 'SF Mono', 'Fira Code', monospace";
        dom.style.fontSize = "12px";
        dom.style.padding = "2px 0";
        dom.textContent = `% ${node.textContent}`;
        return { dom };
      }

      // Editable block view: PM owns the caret via `contentDOM`; the `% ` prefix
      // is a non-editable widget the caret can't cross; the handle bar
      // node-selects the whole comment for grab/lift. No editing-mode flag, no
      // stopPropagation, no blur-commit.
      const dom = document.createElement("div");
      dom.className = "latex-comment";
      // 2d: NodeView-owned data-uuid/kind (MAIN only). No update() below —
      // PM recreates this NodeView on node change, keeping the stamp fresh.
      if (surface === "main") stampTextObjectAttrs(dom, node, null);

      const bar = document.createElement("div");
      // The grab bar is editor chrome (task 535): a comment prints its text,
      // never the coloured handle beside it.
      bar.className = chromeOnly("latex-comment-handle");
      bar.contentEditable = "false";
      bar.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const pos = typeof getPos === "function" ? getPos() : undefined;
        if (pos != null && editor?.view) {
          const tr = editor.view.state.tr.setSelection(
            NodeSelection.create(editor.view.state.doc, pos),
          );
          editor.view.dispatch(tr);
          editor.view.focus();
        }
      });
      dom.appendChild(bar);

      const content = document.createElement("div");
      content.className = "latex-comment-content";
      dom.appendChild(content);

      const pre = document.createElement("span");
      pre.className = "latex-comment-prefix";
      pre.textContent = "% ";
      pre.contentEditable = "false";
      content.appendChild(pre);

      const contentDOM = document.createElement("span");
      contentDOM.className = "latex-comment-editable";
      content.appendChild(contentDOM);

      return { dom, contentDOM };
    };
  },
});
