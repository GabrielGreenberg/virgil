import { Node, Mark, mergeAttributes, Extension } from "@tiptap/react";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { NodeSelection } from "@tiptap/pm/state";

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

  addAttributes() {
    return {
      content: { default: "" },
      number: { default: 1 },
      footnoteId: { default: "" },
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
            const content = match[1];
            const footnoteId = crypto.randomUUID();
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
            return true;
          },
        },
      }),
    ];
  },

  addNodeView() {
    return ({ node, getPos, editor }) => {
      const dom = document.createElement("span");
      dom.className = "footnote-marker";
      dom.dataset.type = "footnote";
      dom.dataset.footnoteId = node.attrs.footnoteId || "";
      dom.contentEditable = "false";
      dom.textContent = String(node.attrs.number || "1");
      dom.title = node.attrs.content || "";

      dom.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();

        // Dispatch event for panel selection
        if (node.attrs.footnoteId) {
          window.dispatchEvent(
            new CustomEvent("virgil-footnote-click", {
              detail: { footnoteId: node.attrs.footnoteId },
            })
          );
        }

        // Show a small popup input below the footnote marker
        const existing = document.querySelector(".footnote-editor-popup");
        if (existing) existing.remove();

        const popup = document.createElement("div");
        popup.className = "footnote-editor-popup";

        const textarea = document.createElement("textarea");
        textarea.className = "footnote-editor-input";
        textarea.value = node.attrs.content || "";
        textarea.rows = 3;
        textarea.placeholder = "Footnote text...";

        popup.appendChild(textarea);

        // Position near the marker
        const rect = dom.getBoundingClientRect();
        popup.style.position = "fixed";
        popup.style.left = `${rect.left}px`;
        popup.style.top = `${rect.bottom + 4}px`;
        popup.style.zIndex = "1000";

        document.body.appendChild(popup);
        textarea.focus();

        const commit = () => {
          const newVal = textarea.value;
          const pos = typeof getPos === "function" ? getPos() : undefined;
          if (pos != null && editor && editor.view) {
            editor.view.dispatch(
              editor.view.state.tr.setNodeMarkup(pos, undefined, {
                ...node.attrs,
                content: newVal,
              })
            );
          }
          popup.remove();
        };

        textarea.addEventListener("blur", () => {
          // Small delay to allow click on popup itself
          setTimeout(() => {
            if (!popup.contains(document.activeElement)) {
              commit();
            }
          }, 100);
        });

        textarea.addEventListener("keydown", (e) => {
          const ke = e as KeyboardEvent;
          if (ke.key === "Escape") {
            popup.remove();
          }
          if (ke.key === "Enter" && (ke.metaKey || ke.ctrlKey)) {
            ke.preventDefault();
            commit();
          }
        });
      });

      return { dom };
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

// Citation command names: natbib + biblatex (longer names first to avoid partial match)
const CITE_CMDS = "Citeyearpar|Citeauthor|Citeyear|Citealp|Citealt|Citep|Citet|Textcites|Parencites|Autocites|Footcites|Textcite|Parencite|Autocite|Footcite|Cites|Cite|citeyearpar|citeauthor|citeyear|citealp|citealt|citep|citet|textcites|parencites|autocites|footcites|textcite|parencite|autocite|footcite|cites|cite";
const CITE_RE_FULL = new RegExp(
  `\\\\(${CITE_CMDS})(\\*?)(?:\\[([^\\]]*)\\])?(?:\\[([^\\]]*)\\])?(\\{[^}]+\\}(?:\\{[^}]+\\})*)$`
);
const CITE_RE_BARE = new RegExp(
  `\\\\(${CITE_CMDS})(\\*?)$`
);

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
                    citationId: crypto.randomUUID(),
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
    return ({ node }) => {
      const dom = document.createElement("span");
      dom.className = "citation-node";
      dom.dataset.type = "citation";
      dom.dataset.citationId = node.attrs.citationId || "";
      dom.contentEditable = "false";
      dom.textContent = node.attrs.displayText || node.attrs.command || "";

      dom.addEventListener("click", (e: Event) => {
        e.preventDefault();
        e.stopPropagation();
        window.dispatchEvent(
          new CustomEvent("virgil-citation-click", {
            detail: { citationId: node.attrs.citationId },
          })
        );
      });

      return {
        dom,
        update(updatedNode: any) {
          if (updatedNode.type.name !== "citation") return false;
          dom.dataset.citationId = updatedNode.attrs.citationId || "";
          dom.textContent =
            updatedNode.attrs.displayText || updatedNode.attrs.command || "";
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
