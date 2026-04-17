import { Node, Mark, mergeAttributes, Extension } from "@tiptap/react";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { NodeSelection } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import type { MutableRefObject } from "react";
import {
  richJsonToPlainText,
  normalizeRichContent,
} from "@/lib/footnote-content";
import { CITE_RE_FULL, CITE_RE_BARE } from "@/lib/cite-commands";
import { generateEntityId } from "@/lib/uuid";

// Flag: when a LatexComment is created via input rule, auto-focus it
let _pendingAutoFocusComment = false;

/**
 * Helper: creates a seamless inline-editable node view.
 * Click to place cursor and start editing — no visual change.
 * The prefix (e.g. "% " or "$") is shown but not editable.
 */
function editableAtomView({
  node,
  getPos,
  editor,
  tag,
  className,
  attrName,
  prefix,
  suffix,
  handleBar,
}: {
  node: any;
  getPos: any;
  editor: any;
  tag: "span" | "div";
  className: string;
  attrName: string;
  prefix?: string;
  suffix?: string;
  handleBar?: boolean;
}) {
  const dom = document.createElement(tag);
  dom.className = className;
  dom.contentEditable = "false";

  // If handleBar is enabled, wrap content in a flex layout with a clickable bar
  let contentContainer: HTMLElement = dom;
  if (handleBar) {
    dom.style.display = "flex";
    dom.style.alignItems = "stretch";

    const bar = document.createElement("div");
    bar.className = `${className}-handle`;
    bar.contentEditable = "false";
    bar.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const pos = typeof getPos === "function" ? getPos() : undefined;
      if (pos != null && editor && editor.view) {
        const tr = editor.view.state.tr.setSelection(
          NodeSelection.create(editor.view.state.doc, pos)
        );
        editor.view.dispatch(tr);
        editor.view.focus();
      }
    });
    dom.appendChild(bar);

    contentContainer = document.createElement("div");
    contentContainer.className = `${className}-content`;
    contentContainer.style.flex = "1";
    contentContainer.style.minWidth = "0";
    dom.appendChild(contentContainer);
  }

  // Build: [prefix][editable-text][suffix]
  if (prefix) {
    const pre = document.createElement("span");
    pre.className = `${className}-prefix`;
    pre.textContent = prefix;
    pre.contentEditable = "false";
    contentContainer.appendChild(pre);
  }

  const textSpan = document.createElement("span");
  textSpan.className = `${className}-editable`;
  // Always ensure there's a text node (even if empty) so cursor placement works
  textSpan.appendChild(document.createTextNode(node.attrs[attrName] || ""));
  textSpan.contentEditable = "false";
  textSpan.style.outline = "none";
  contentContainer.appendChild(textSpan);

  if (suffix) {
    const suf = document.createElement("span");
    suf.className = `${className}-suffix`;
    suf.textContent = suffix;
    suf.contentEditable = "false";
    contentContainer.appendChild(suf);
  }

  let editing = false;

  const enterEditMode = (clientX?: number, clientY?: number) => {
    if (editing) return;
    editing = true;
    textSpan.contentEditable = "true";
    textSpan.focus();

    // Place cursor at click position or end
    try {
      let range: Range | null = null;
      if (clientX != null && clientY != null && document.caretRangeFromPoint) {
        range = document.caretRangeFromPoint(clientX, clientY);
      }
      if (range) {
        const sel = window.getSelection();
        if (sel) { sel.removeAllRanges(); sel.addRange(range); }
      } else {
        // Fallback: cursor at start of editable area (right after "% ")
        const sel = window.getSelection();
        if (sel) {
          const r = document.createRange();
          const textNode = textSpan.firstChild || textSpan;
          r.setStart(textNode, textNode.textContent?.length || 0);
          r.collapse(true);
          sel.removeAllRanges();
          sel.addRange(r);
        }
      }
    } catch {
      // fallback
    }
  };

  dom.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    enterEditMode((e as MouseEvent).clientX, (e as MouseEvent).clientY);
  });

  const commit = () => {
    if (!editing) return;
    editing = false;
    textSpan.contentEditable = "false";
    const newVal = textSpan.textContent || "";
    const pos = typeof getPos === "function" ? getPos() : undefined;
    if (pos != null && editor && editor.view) {
      editor.view.dispatch(
        editor.view.state.tr.setNodeMarkup(pos, undefined, {
          ...node.attrs,
          [attrName]: newVal,
        })
      );
    }
  };

  textSpan.addEventListener("blur", commit);

  // Stop ALL key events from reaching TipTap/ProseMirror while editing
  const stopPropagation = (e: Event) => {
    if (editing) e.stopPropagation();
  };
  textSpan.addEventListener("keydown", (e) => {
    if (!editing) return;
    e.stopPropagation();
    const ke = e as KeyboardEvent;
    if (ke.key === "Enter" && !ke.shiftKey) {
      ke.preventDefault();
      textSpan.blur();
    }
    if (ke.key === "Escape") {
      textSpan.textContent = node.attrs[attrName] || "";
      editing = false;
      textSpan.contentEditable = "false";
    }
  });
  textSpan.addEventListener("keyup", stopPropagation);
  textSpan.addEventListener("keypress", stopPropagation);
  textSpan.addEventListener("input", stopPropagation);
  textSpan.addEventListener("beforeinput", stopPropagation);

  const selectNode = () => { dom.classList.add("selected"); };
  const deselectNode = () => { dom.classList.remove("selected"); };

  return { dom, enterEditMode, selectNode, deselectNode };
}

// --- Inline Math ---

// --- Virgil command registry (type \command + Enter to execute) ---

interface VirgilCommand {
  /** The command name without backslash (e.g. "section") */
  name: string;
  /** Action to run. The typed text has already been deleted from the doc. */
  action: (view: EditorView, cmdText: string) => void;
}

const VIRGIL_COMMANDS: VirgilCommand[] = [
  {
    name: "chapter",
    action: (view) => {
      const { state } = view;
      const heading = state.schema.nodes.heading;
      if (heading) {
        const tr = state.tr.setBlockType(state.selection.from, state.selection.to, heading, { level: 1, numbered: true });
        view.dispatch(tr);
      }
    },
  },
  {
    name: "section",
    action: (view) => {
      const { state } = view;
      const heading = state.schema.nodes.heading;
      if (heading) {
        const tr = state.tr.setBlockType(state.selection.from, state.selection.to, heading, { level: 2, numbered: true });
        view.dispatch(tr);
      }
    },
  },
  {
    name: "subsection",
    action: (view) => {
      const { state } = view;
      const heading = state.schema.nodes.heading;
      if (heading) {
        const tr = state.tr.setBlockType(state.selection.from, state.selection.to, heading, { level: 3, numbered: true });
        view.dispatch(tr);
      }
    },
  },
  {
    name: "subsubsection",
    action: (view) => {
      const { state } = view;
      const heading = state.schema.nodes.heading;
      if (heading) {
        const tr = state.tr.setBlockType(state.selection.from, state.selection.to, heading, { level: 4, numbered: true });
        view.dispatch(tr);
      }
    },
  },
  {
    name: "ref",
    action: () => {
      window.dispatchEvent(new CustomEvent("virgil-ref-create"));
    },
  },
  {
    name: "cite",
    action: () => {
      _pendingCitationCreate = "\\cite";
      window.dispatchEvent(
        new CustomEvent("virgil-citation-create", { detail: { partial: "\\cite" } }),
      );
    },
  },
  {
    name: "footnote",
    action: () => {
      window.dispatchEvent(new CustomEvent("virgil-footnote-input"));
    },
  },
];

// Build a lookup map for fast matching
const COMMAND_MAP = new Map(VIRGIL_COMMANDS.map((c) => [c.name, c]));

/** Names of all native Virgil commands (without the leading backslash). */
export const VIRGIL_COMMAND_NAMES: readonly string[] = VIRGIL_COMMANDS.map((c) => c.name);

// --- LaTeX Command mark (grey monospace for unhandled commands) ---

export const LatexCommandMark = Mark.create({
  name: "latexCommand",

  parseHTML() {
    return [{ tag: 'span[data-latex-cmd]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-latex-cmd": "",
        class: "latex-cmd",
      }),
      0,
    ];
  },

  addProseMirrorPlugins() {
    const markType = this.type;

    /** Match a full LaTeX command span: \cmd*?[opt]{arg}{arg} — same as the parser. */
    function matchCommandLength(text: string, start: number): number {
      let i = start;
      // \
      if (i >= text.length || text[i] !== "\\") return 0;
      i++;
      // command name: [a-zA-Z]+
      const nameStart = i;
      while (i < text.length && /[a-zA-Z]/.test(text[i])) i++;
      if (i === nameStart) return i - start; // just "\" alone
      // optional *
      if (i < text.length && text[i] === "*") i++;
      // optional [...] args
      while (i < text.length && text[i] === "[") {
        const close = text.indexOf("]", i);
        if (close === -1) break;
        i = close + 1;
      }
      // up to 2 {braced} args — include unclosed braces (user still typing)
      let braces = 0;
      while (i < text.length && text[i] === "{" && braces < 2) {
        let depth = 0;
        let closed = false;
        for (let j = i; j < text.length; j++) {
          if (text[j] === "{") depth++;
          else if (text[j] === "}") { depth--; if (depth === 0) { i = j + 1; braces++; closed = true; break; } }
        }
        if (!closed) { i = text.length; break; } // unclosed — include to end (typing in progress)
      }
      return i - start;
    }

    function buildDecorations(doc: any): DecorationSet {
      const decos: Decoration[] = [];
      doc.descendants((node: any, pos: number) => {
        if (!node.isText || !node.text) return;
        // Skip if the entire node already has the latexCommand mark
        if (node.marks.some((m: any) => m.type === markType)) return;

        const text = node.text as string;
        for (let i = 0; i < text.length; i++) {
          if (text[i] !== "\\") continue;
          // Skip \\ (double backslash)
          if (i > 0 && text[i - 1] === "\\") { i++; continue; }
          const len = matchCommandLength(text, i);
          if (len > 0) {
            decos.push(Decoration.inline(pos + i, pos + i + len, { class: "latex-cmd" }));
            i += len - 1; // advance past the match
          }
        }
      });
      return DecorationSet.create(doc, decos);
    }

    return [
      // Live decoration for \commands while typing
      new Plugin({
        key: new PluginKey("latexCmdDecorations"),
        state: {
          init(_config, state) {
            return buildDecorations(state.doc);
          },
          apply(tr, oldSet) {
            if (!tr.docChanged) return oldSet.map(tr.mapping, tr.doc);
            return buildDecorations(tr.doc);
          },
        },
        props: {
          decorations(state) {
            return this.getState(state);
          },
        },
      }),
      // Virgil command execution on Enter
      new Plugin({
        key: new PluginKey("virgilCommands"),
        props: {
          handleKeyDown(view, event) {
            if (event.key !== "Enter") return false;
            const { state } = view;
            const { from } = state.selection;
            if (from !== state.selection.to) return false; // collapsed cursor only

            const $from = state.doc.resolve(from);
            const textBefore = $from.parent.textBetween(
              Math.max(0, $from.parentOffset - 40),
              $from.parentOffset,
              undefined,
              "\ufffc",
            );

            // Match \commandname at end of text before cursor
            const cmdMatch = textBefore.match(/\\([a-zA-Z]+)$/);
            if (!cmdMatch) return false;

            const cmd = COMMAND_MAP.get(cmdMatch[1]);
            if (!cmd) return false;

            // Delete the typed \command text
            const cmdLen = cmdMatch[0].length;
            const deleteFrom = from - cmdLen;
            const tr = state.tr.delete(deleteFrom, from);
            view.dispatch(tr);

            // Run the command action
            cmd.action(view, cmdMatch[0]);
            return true;
          },
        },
      }),
    ];
  },
});

export const InlineMath = Node.create({
  name: "inlineMath",
  group: "inline",
  inline: true,
  atom: true,

  addAttributes() {
    return {
      latex: { default: "" },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-type="inline-math"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-type": "inline-math",
        class: "inline-math",
      }),
      `$${HTMLAttributes.latex || ""}$`,
    ];
  },

  addProseMirrorPlugins() {
    const nodeType = this.type;
    return [
      new Plugin({
        key: new PluginKey("inlineMathInput"),
        props: {
          handleTextInput(view, from, _to, text) {
            if (text !== "$") return false;
            const { state } = view;
            const $from = state.doc.resolve(from);
            const textBefore = $from.parent.textBetween(
              Math.max(0, $from.parentOffset - 200),
              $from.parentOffset,
              undefined,
              "\ufffc"
            );
            // Match $...$ where the closing $ is what the user just typed
            const match = textBefore.match(/\$([^$]+)$/);
            if (!match) return false;
            const latex = match[1];
            const start = from - match[0].length;
            const tr = state.tr.replaceWith(
              start,
              from,
              nodeType.create({ latex })
            );
            view.dispatch(tr);
            return true;
          },
        },
      }),
    ];
  },

  addNodeView() {
    return ({ node, getPos, editor }) =>
      editableAtomView({
        node,
        getPos,
        editor,
        tag: "span",
        className: "inline-math",
        attrName: "latex",
        prefix: "$",
        suffix: "$",
      });
  },
});

// --- Display Math ---

export const DisplayMath = Node.create({
  name: "displayMath",
  group: "block",
  atom: true,

  addAttributes() {
    return {
      latex: { default: "" },
      uuid: { default: null, rendered: false },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="display-math"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-type": "display-math",
        class: "display-math",
      }),
      `$$${HTMLAttributes.latex || ""}$$`,
    ];
  },

  addProseMirrorPlugins() {
    const nodeType = this.type;
    return [
      new Plugin({
        key: new PluginKey("displayMathInput"),
        props: {
          handleTextInput(view, from, _to, text) {
            if (text !== "$") return false;
            const { state } = view;
            const $from = state.doc.resolve(from);
            const textBefore = $from.parent.textBetween(
              Math.max(0, $from.parentOffset - 500),
              $from.parentOffset,
              undefined,
              "\ufffc"
            );

            // Case 1: $$ on an empty/start of paragraph → empty display math block
            if (textBefore === "$") {
              const start = from - 1;
              const tr = state.tr.replaceWith(
                start,
                from,
                nodeType.create({ latex: "" })
              );
              view.dispatch(tr);
              return true;
            }

            // Case 2: $$content$$ — closing pair
            const match = textBefore.match(/\$\$([^$]+)\$$/);
            if (!match) return false;
            const latex = match[1];
            const start = from - match[0].length;
            const tr = state.tr.replaceWith(
              start,
              from,
              nodeType.create({ latex })
            );
            view.dispatch(tr);
            return true;
          },
        },
      }),
    ];
  },

  addNodeView() {
    return ({ node, getPos, editor }) =>
      editableAtomView({
        node,
        getPos,
        editor,
        tag: "div",
        className: "display-math",
        attrName: "latex",
        prefix: "$$",
        suffix: "$$",
      });
  },
});

// --- Footnote (inline atom, rendered as superscript number) ---

export const Footnote = Node.create({
  name: "footnote",
  group: "inline",
  inline: true,
  atom: true,
  draggable: true,

  addAttributes() {
    return {
      // Tiptap JSONContent doc — see normalizeRichContent for accepted shapes.
      // Default null so every footnote node owns its own object (avoids the
      // single-shared-default-mutation footgun).
      content: { default: null },
      number: { default: 1 },
      footnoteId: { default: "" },
      title: { default: "" },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-type="footnote"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-type": "footnote",
        class: "footnote-marker",
      }),
      String(HTMLAttributes.number || "1"),
    ];
  },

  addProseMirrorPlugins() {
    const nodeType = this.type;
    return [
      new Plugin({
        key: new PluginKey("footnoteInput"),
        props: {
          handleTextInput(view, from, _to, text) {
            if (text !== "}") return false;
            const { state } = view;
            const $from = state.doc.resolve(from);
            const textBefore = $from.parent.textBetween(
              Math.max(0, $from.parentOffset - 200),
              $from.parentOffset,
              undefined,
              "\ufffc"
            ) + text;
            const match = textBefore.match(/\\footnote\{([^}]*)\}$/);
            if (!match) return false;
            const content = normalizeRichContent(match[1]);
            const footnoteId = generateEntityId();
            const start = from + 1 - match[0].length;
            const tr = state.tr.replaceWith(
              start,
              from + 1,
              nodeType.create({ content, footnoteId, number: 0 })
            );
            // Insert the typed "}" into the document first so replaceWith range is valid
            // Actually we already accounted for it — replaceWith from start to from+1 covers the "}" we're inserting
            // But we need to handle this: from is pre-insert, so we replace start..from and consume the text
            const trFixed = state.tr.replaceWith(
              start,
              from,
              nodeType.create({ content, footnoteId, number: 0 })
            );
            let counter = 1;
            trFixed.doc.descendants((node, pos) => {
              if (node.type.name === "footnote") {
                trFixed.setNodeMarkup(pos, undefined, { ...node.attrs, number: counter++ });
              }
              return true;
            });
            view.dispatch(trFixed);
            // Notify persistent state about the new footnote
            window.dispatchEvent(
              new CustomEvent("virgil-footnote-created", {
                detail: { footnoteId, content },
              })
            );
            return true;
          },
        },
      }),
      // Orphan detector + auto-renumber plugin
      new Plugin({
        key: new PluginKey("footnoteOrphanDetector"),
        appendTransaction(transactions, oldState, newState) {
          if (!transactions.some((tr) => tr.docChanged)) return null;

          const oldFootnotes = new Map<string, unknown>();
          oldState.doc.descendants((node) => {
            if (node.type.name === "footnote" && node.attrs.footnoteId) {
              oldFootnotes.set(node.attrs.footnoteId, node.attrs.content);
            }
            return true;
          });

          const newFootnotes = new Set<string>();
          newState.doc.descendants((node) => {
            if (node.type.name === "footnote" && node.attrs.footnoteId) {
              newFootnotes.add(node.attrs.footnoteId);
            }
            return true;
          });

          for (const [id, content] of oldFootnotes) {
            if (!newFootnotes.has(id) && richJsonToPlainText(content).trim()) {
              setTimeout(() => {
                window.dispatchEvent(
                  new CustomEvent("virgil-footnote-orphaned", {
                    detail: { footnoteId: id, content },
                  })
                );
              }, 0);
            }
          }

          let counter = 1;
          let needsRenumber = false;
          newState.doc.descendants((node) => {
            if (node.type.name === "footnote") {
              if (node.attrs.number !== counter) needsRenumber = true;
              counter++;
            }
            return true;
          });

          if (!needsRenumber) return null;

          const tr = newState.tr;
          let num = 1;
          newState.doc.descendants((node, pos) => {
            if (node.type.name === "footnote") {
              if (node.attrs.number !== num) {
                tr.setNodeMarkup(pos, undefined, { ...node.attrs, number: num });
              }
              num++;
            }
            return true;
          });

          return tr.steps.length > 0 ? tr : null;
        },
      }),
    ];
  },

  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement("span");
      dom.className = "footnote-marker";
      dom.dataset.type = "footnote";
      dom.dataset.footnoteId = node.attrs.footnoteId || "";
      dom.contentEditable = "false";
      dom.draggable = true;
      dom.style.cursor = "grab";
      dom.textContent = String(node.attrs.number || "1");
      dom.title = richJsonToPlainText(node.attrs.content);

      // Click on the marker just routes the user to the side panel — the
      // panel hosts the full Tiptap mini editor for footnote bodies now.
      dom.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (node.attrs.footnoteId) {
          window.dispatchEvent(
            new CustomEvent("virgil-footnote-click", {
              detail: { footnoteId: node.attrs.footnoteId },
            })
          );
        }
      });

      return {
        dom,
        draggable: true,
        update(updatedNode) {
          if (updatedNode.type.name !== "footnote") return false;
          dom.dataset.footnoteId = updatedNode.attrs.footnoteId || "";
          dom.textContent = String(updatedNode.attrs.number || "1");
          dom.title = richJsonToPlainText(updatedNode.attrs.content);
          return true;
        },
      };
    };
  },
});

// --- LaTeX Comment (block node, rendered in subdued blue) ---

export const LatexComment = Node.create({
  name: "latexComment",
  group: "block",
  atom: true,

  addAttributes() {
    return {
      text: { default: "" },
      uuid: { default: null, rendered: false },
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
    return ({ node, getPos, editor }) => {
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

// --- Archive Marker (inline atom, marks where archived text was) ---

export const ArchiveMarker = Node.create({
  name: "archiveMarker",
  group: "inline",
  inline: true,
  atom: true,
  selectable: false,

  addAttributes() {
    return {
      archiveId: { default: "" },
      preview: { default: "" },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-type="archive-marker"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-type": "archive-marker",
        class: "archive-marker",
      }),
      "A",
    ];
  },

  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement("span");
      dom.className = "archive-marker";
      dom.dataset.type = "archive-marker";
      dom.dataset.archiveId = node.attrs.archiveId || "";
      dom.contentEditable = "false";
      dom.innerHTML = `<svg width="13" height="13" viewBox="0 0 16 16" fill="none" style="display:inline-block;vertical-align:-2px"><rect x="1.5" y="1.5" width="13" height="13" rx="2.5" stroke="#7191b0" stroke-width="1.5" fill="#f0f5fa"/><text x="8" y="11.8" text-anchor="middle" font-size="9.5" font-weight="600" fill="#7191b0" font-family="var(--font-sans), sans-serif">A</text></svg>`;
      dom.title = node.attrs.preview
        ? `Archived: ${node.attrs.preview}...`
        : "Archived text";

      dom.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        window.dispatchEvent(
          new CustomEvent("virgil-archive-click", {
            detail: { archiveId: node.attrs.archiveId },
          })
        );
      });

      return { dom };
    };
  },
});

// --- Citation (inline atom, rendered with lemon-yellow highlight + left bar) ---
// Citation regexes are defined in @/lib/cite-commands so the parser, the
// tiptap input rule, and the bib formatter all agree on the supported set.

// Flag: when a bare \cite is typed, signal the panel to open
let _pendingCitationCreate: string | null = null;

export function consumePendingCitationCreate(): string | null {
  const v = _pendingCitationCreate;
  _pendingCitationCreate = null;
  return v;
}

export const Citation = Node.create({
  name: "citation",
  group: "inline",
  inline: true,
  atom: true,

  addAttributes() {
    return {
      citationId: { default: "" },
      command: { default: "" },
      displayText: { default: "" },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-type="citation"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-type": "citation",
        class: "citation-node",
      }),
      HTMLAttributes.displayText || HTMLAttributes.command || "",
    ];
  },

  addProseMirrorPlugins() {
    const nodeType = this.type;
    return [
      new Plugin({
        key: new PluginKey("citationInput"),
        props: {
          handleTextInput(view, from, to, text) {
            // Only check on characters that could complete a citation pattern
            if (text !== "}" && text !== " " && text !== "\n") return false;

            const { state } = view;
            const $from = state.doc.resolve(from);
            const textBefore = $from.parent.textBetween(
              Math.max(0, $from.parentOffset - 120),
              $from.parentOffset,
              undefined,
              "\ufffc"
            ) + text;

            if (text === "}") {
              // Full citation command ending with }
              const match = textBefore.match(CITE_RE_FULL);
              if (match) {
                const command = match[0];
                const start = from + text.length - command.length;
                const tr = state.tr.replaceWith(
                  start,
                  from + text.length,
                  nodeType.create({
                    citationId: generateEntityId(),
                    command,
                    displayText: "",
                  })
                );
                view.dispatch(tr);
                return true;
              }
            } else {
              // Bare citation command followed by space/enter
              const beforeSpace = textBefore.slice(0, -1);
              const match = beforeSpace.match(CITE_RE_BARE);
              if (match) {
                const partial = match[0];
                _pendingCitationCreate = partial;
                const start = from - partial.length;
                const tr = state.tr.delete(start, from);
                view.dispatch(tr);
                setTimeout(() => {
                  window.dispatchEvent(
                    new CustomEvent("virgil-citation-create", {
                      detail: { partial },
                    })
                  );
                }, 0);
                return true;
              }
            }
            return false;
          },
        },
      }),
    ];
  },

  addNodeView() {
    // Display text may contain <i> tags (e.g. book titles from \citetitle).
    // Allow only safe inline formatting tags; strip everything else.
    const setCitationHTML = (el: HTMLElement, text: string) => {
      if (/<[ib]>/i.test(text)) {
        el.innerHTML = text.replace(/<\/?(?!\/?[ib]>)[^>]+>/gi, "");
      } else {
        el.textContent = text;
      }
    };
    return ({ node }) => {
      const dom = document.createElement("span");
      dom.className = "citation-node";
      dom.dataset.type = "citation";
      dom.dataset.citationId = node.attrs.citationId || "";
      dom.contentEditable = "false";
      setCitationHTML(dom, node.attrs.displayText || node.attrs.command || "");

      dom.addEventListener("click", (e: Event) => {
        e.preventDefault();
        e.stopPropagation();
        const rect = dom.getBoundingClientRect();
        window.dispatchEvent(
          new CustomEvent("virgil-citation-click", {
            detail: {
              citationId: node.attrs.citationId,
              // Viewport Y of the clicked citation — used by the citations
              // panel to align the corresponding card vertically with the
              // click target.
              clickY: rect.top,
            },
          })
        );
      });

      return {
        dom,
        update(updatedNode: any) {
          if (updatedNode.type.name !== "citation") return false;
          dom.dataset.citationId = updatedNode.attrs.citationId || "";
          setCitationHTML(dom, updatedNode.attrs.displayText || updatedNode.attrs.command || "");
          return true;
        },
      };
    };
  },
});

/** \ref{label} — inline cross-reference rendered as a clickable pod. */
export const LabelRef = Node.create({
  name: "labelRef",
  group: "inline",
  inline: true,
  atom: true,

  addAttributes() {
    return {
      label: { default: "" },
      displayText: { default: "" },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-type="label-ref"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-type": "label-ref",
        class: "label-ref-node",
      }),
      HTMLAttributes.displayText || "??",
    ];
  },

  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement("span");
      dom.className = "label-ref-node";
      dom.dataset.type = "label-ref";
      dom.dataset.label = node.attrs.label || "";
      dom.contentEditable = "false";
      dom.textContent = node.attrs.displayText || "??";

      dom.addEventListener("click", (e: Event) => {
        e.preventDefault();
        e.stopPropagation();
        window.dispatchEvent(
          new CustomEvent("virgil-label-ref-click", {
            detail: { label: node.attrs.label },
          })
        );
      });

      return {
        dom,
        update(updatedNode: any) {
          if (updatedNode.type.name !== "labelRef") return false;
          dom.dataset.label = updatedNode.attrs.label || "";
          dom.textContent = updatedNode.attrs.displayText || "??";
          return true;
        },
      };
    };
  },
});

// Absorbs \label{...} paragraphs that immediately follow a heading into
// the heading's label attribute, and removes the paragraph.
export const LabelHandler = Extension.create({
  name: "labelHandler",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("labelHandler"),
        appendTransaction(transactions, _oldState, newState) {
          if (!transactions.some((tr) => tr.docChanged)) return null;

          const { doc, schema } = newState;
          const headingType = schema.nodes.heading;
          const paragraphType = schema.nodes.paragraph;

          const changes: Array<{
            headingPos: number;
            headingAttrs: Record<string, unknown>;
            label: string;
            paraPos: number;
            paraSize: number;
          }> = [];

          doc.forEach((node, pos) => {
            if (node.type !== headingType) return;
            const nextPos = pos + node.nodeSize;
            if (nextPos >= doc.content.size) return;
            const nextNode = doc.nodeAt(nextPos);
            if (!nextNode || nextNode.type !== paragraphType) return;
            const text = nextNode.textContent;
            const match = text.match(/^\\label\{([^}]*)\}$/);
            if (!match) return;
            const label = match[1];
            if (node.attrs.label === label) return;
            changes.push({
              headingPos: pos,
              headingAttrs: node.attrs,
              label,
              paraPos: nextPos,
              paraSize: nextNode.nodeSize,
            });
          });

          if (changes.length === 0) return null;

          // Process in reverse order so deletions don't shift earlier positions
          const tr = newState.tr;
          for (const c of [...changes].reverse()) {
            tr.setNodeMarkup(c.headingPos, undefined, { ...c.headingAttrs, label: c.label });
            tr.delete(c.paraPos, c.paraPos + c.paraSize);
          }
          return tr;
        },
      }),
    ];
  },
});

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

// --- Title Field (block node with editable content, labeled "Title" / "Author" / "Date") ---

const FIELD_LABELS: Record<string, string> = {
  title: "Title",
  author: "Author",
  date: "Date",
};

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

// --- Maketitle Marker (atom block, visual separator) ---

export const MaketitleMarker = Node.create({
  name: "maketitleMarker",
  group: "block",
  atom: true,

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
      "\\maketitle",
    ];
  },

  addNodeView() {
    return () => {
      const wrapper = document.createElement("div");
      wrapper.className = "maketitle-marker";

      const line1 = document.createElement("span");
      line1.className = "maketitle-line";
      wrapper.appendChild(line1);

      const label = document.createElement("span");
      label.className = "maketitle-label";
      label.textContent = "maketitle";
      wrapper.appendChild(label);

      const line2 = document.createElement("span");
      line2.className = "maketitle-line";
      wrapper.appendChild(line2);

      return { dom: wrapper };
    };
  },
});

// --- AI Request Marker (placeholder node dropped from AI request cards) ---

/**
 * Inline atom that represents a draft AI request "pinned" into the document.
 * The full request text lives in the unified `useAiRequests` store; the
 * marker only carries the id (plus a text fallback for stale cases).
 *
 * Clicking the marker dispatches `virgil-ai-request-click` so the side
 * panels can scroll to the matching card.
 */
export const AiRequestMarker = Node.create({
  name: "aiRequestMarker",
  group: "inline",
  inline: true,
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      requestId: { default: "" },
      kind: { default: "footnote" },
      text: { default: "" },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-type="ai-request-marker"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-type": "ai-request-marker",
        class: "ai-request-marker",
      }),
      "\u2605",
    ];
  },

  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement("span");
      dom.className = "ai-request-marker";
      dom.dataset.type = "ai-request-marker";
      dom.dataset.requestId = node.attrs.requestId || "";
      dom.dataset.kind = node.attrs.kind || "";
      dom.contentEditable = "false";
      dom.draggable = true;
      dom.style.cursor = "grab";

      const star = document.createElement("span");
      star.className = "ai-request-marker-star";
      star.textContent = "\u2605";
      dom.appendChild(star);

      const label = document.createElement("span");
      label.className = "ai-request-marker-label";
      const t = String(node.attrs.text || "").trim();
      label.textContent = t.length > 30 ? t.slice(0, 30) + "\u2026" : (t || "AI request");
      dom.appendChild(label);

      const fullText = String(node.attrs.text || "").trim();
      const kindLabel = String(node.attrs.kind || "");
      dom.title = fullText
        ? `AI ${kindLabel} request: ${fullText}`
        : `AI ${kindLabel} request`;

      dom.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (node.attrs.requestId) {
          window.dispatchEvent(
            new CustomEvent("virgil-ai-request-click", {
              detail: { requestId: node.attrs.requestId, kind: node.attrs.kind },
            }),
          );
        }
      });

      return {
        dom,
        draggable: true,
        update(updatedNode) {
          if (updatedNode.type.name !== "aiRequestMarker") return false;
          dom.dataset.requestId = updatedNode.attrs.requestId || "";
          dom.dataset.kind = updatedNode.attrs.kind || "";
          const u = String(updatedNode.attrs.text || "").trim();
          label.textContent = u.length > 30 ? u.slice(0, 30) + "\u2026" : (u || "AI request");
          dom.title = u
            ? `AI ${updatedNode.attrs.kind} request: ${u}`
            : `AI ${updatedNode.attrs.kind} request`;
          return true;
        },
      };
    };
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// MarginaliaAnchorGuard — prevents paragraph deletion from orphaning
// margin elements. When a UUID-bearing paragraph vanishes and it has
// marginalia anchored to it, the plugin re-inserts an empty paragraph
// with the same UUID so the margin elements stay visible.
// ─────────────────────────────────────────────────────────────────────────────

export const MarginaliaAnchorGuard = Extension.create<{
  anchoredUuidsRef: MutableRefObject<Set<string>>;
}>({
  name: "marginaliaAnchorGuard",

  addOptions() {
    return {
      anchoredUuidsRef: { current: new Set() } as MutableRefObject<Set<string>>,
    };
  },

  addProseMirrorPlugins() {
    const { anchoredUuidsRef } = this.options;
    return [
      new Plugin({
        key: new PluginKey("marginaliaAnchorGuard"),
        appendTransaction(transactions, oldState, newState) {
          if (!transactions.some((tr) => tr.docChanged)) return null;
          const anchored = anchoredUuidsRef.current;
          if (anchored.size === 0) return null;

          // Collect UUIDs in old and new states
          const oldUuids = new Set<string>();
          oldState.doc.descendants((node) => {
            const uuid = node.attrs?.uuid as string | undefined;
            if (uuid) oldUuids.add(uuid);
            return true;
          });

          const newUuids = new Set<string>();
          newState.doc.descendants((node) => {
            const uuid = node.attrs?.uuid as string | undefined;
            if (uuid) newUuids.add(uuid);
            return true;
          });

          // Find anchored UUIDs that vanished
          const vanished: string[] = [];
          for (const uuid of oldUuids) {
            if (!newUuids.has(uuid) && anchored.has(uuid)) {
              vanished.push(uuid);
            }
          }
          if (vanished.length === 0) return null;

          // Re-insert empty paragraphs at the end of the document
          const tr = newState.tr;
          const paraType = newState.schema.nodes.paragraph;
          if (!paraType) return null;

          for (const uuid of vanished) {
            const emptyPara = paraType.create({ uuid });
            tr.insert(tr.doc.content.size, emptyPara);
          }
          tr.setMeta("addToHistory", false);
          return tr.steps.length > 0 ? tr : null;
        },
      }),
    ];
  },
});
