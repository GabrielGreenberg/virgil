import { Node, mergeAttributes } from "@tiptap/react";
import { InputRule } from "@tiptap/core";
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

  addInputRules() {
    return [
      new InputRule({
        find: /\$([^$]+)\$$/,
        handler: ({ state, range, match }) => {
          const latex = match[1];
          const { tr } = state;
          tr.replaceWith(range.from, range.to, this.type.create({ latex }));
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

  addInputRules() {
    return [
      new InputRule({
        find: /\$\$([^$]+)\$\$$/,
        handler: ({ state, range, match }) => {
          const latex = match[1];
          const { tr } = state;
          tr.replaceWith(range.from, range.to, this.type.create({ latex }));
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

  addInputRules() {
    return [
      new InputRule({
        find: /\\footnote\{([^}]*)\}$/,
        handler: ({ state, range, match }) => {
          const content = match[1];
          const footnoteId = crypto.randomUUID();
          const { tr } = state;
          // Insert the footnote node
          tr.replaceWith(range.from, range.to, this.type.create({ content, footnoteId, number: 0 }));
          // Renumber all footnotes in a follow-up step
          let counter = 1;
          tr.doc.descendants((node, pos) => {
            if (node.type.name === "footnote") {
              tr.setNodeMarkup(pos, undefined, { ...node.attrs, number: counter++ });
            }
            return true;
          });
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

  addInputRules() {
    return [
      new InputRule({
        find: /^%(.*)$/,
        handler: ({ state, range, match }) => {
          const text = (match[1] || "").replace(/^ /, "");
          const { tr } = state;
          tr.replaceWith(range.from, range.to, this.type.create({ text }));
          // Signal the newly created node view to auto-focus
          _pendingAutoFocusComment = true;
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

// Natbib command names we recognise (lowercase forms; parser also handles Capitalised)
const CITE_CMDS = "Citeyearpar|Citeauthor|Citeyear|Citealp|Citealt|Citep|Citet|Cite|citeyearpar|citeauthor|citeyear|citealp|citealt|citep|citet|cite";
const CITE_RE_FULL = new RegExp(
  `\\\\(C?(?:${CITE_CMDS}))(\\*?)(?:\\[([^\\]]*)\\])?(?:\\[([^\\]]*)\\])?\{([^}]+)\}$`
);
const CITE_RE_BARE = new RegExp(
  `\\\\(C?(?:${CITE_CMDS}))(\\*?)$`
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

  addInputRules() {
    return [
      // Full citation command: \citep{key} or \citet*[see][ch.2]{key1,key2}
      new InputRule({
        find: CITE_RE_FULL,
        handler: ({ state, range, match }) => {
          const command = match[0];
          const { tr } = state;
          tr.replaceWith(
            range.from,
            range.to,
            this.type.create({
              citationId: crypto.randomUUID(),
              command,
              displayText: "", // computed at render time by the NodeView
            })
          );
        },
      }),

      // Bare citation command: \cite or \citep* (no brace) — trigger panel
      new InputRule({
        find: CITE_RE_BARE,
        handler: ({ state, range, match }) => {
          const partial = match[0]; // e.g. "\citep"
          _pendingCitationCreate = partial;
          const { tr } = state;
          tr.delete(range.from, range.to);
          setTimeout(() => {
            window.dispatchEvent(
              new CustomEvent("virgil-citation-create", {
                detail: { partial },
              })
            );
          }, 0);
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

      // Left bar
      const bar = document.createElement("span");
      bar.className = "citation-node-bar";
      dom.appendChild(bar);

      // Display text
      const text = document.createElement("span");
      text.className = "citation-node-text";
      text.textContent = node.attrs.displayText || node.attrs.command || "";
      dom.appendChild(text);

      // Click bar or text → open panel
      const handleClick = (e: Event) => {
        e.preventDefault();
        e.stopPropagation();
        window.dispatchEvent(
          new CustomEvent("virgil-citation-click", {
            detail: { citationId: node.attrs.citationId },
          })
        );
      };
      bar.addEventListener("click", handleClick);
      text.addEventListener("click", handleClick);

      return {
        dom,
        update(updatedNode: any) {
          if (updatedNode.type.name !== "citation") return false;
          dom.dataset.citationId = updatedNode.attrs.citationId || "";
          text.textContent =
            updatedNode.attrs.displayText || updatedNode.attrs.command || "";
          return true;
        },
      };
    };
  },
});
