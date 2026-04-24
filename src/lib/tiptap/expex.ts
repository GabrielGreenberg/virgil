import { Node, Extension, mergeAttributes } from "@tiptap/react";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { TextSelection } from "@tiptap/pm/state";

// Six nodes implement the expex package:
//
//   exampleBlock         — top-level numbered example (\ex … \xe or \pex … \xe)
//   exampleItem          — one \a sub-part inside a \pex
//   exampleGloss         — a \begingl … \endgl interlinear gloss block
//   alignedGlossRow      — one \gla / \glb / \glc row (columnar)
//   proseGlossRow        — one \glpreamble / \glft row (prose)
//   glossCell            — a single column inside an alignedGlossRow
//
// The exampleBlock carries a `number` attr and each exampleItem carries a
// `subLabel` ("a", "b", …); both are maintained live by the numbering
// ProseMirror plugin below, and also one-shot at parse time by a helper
// invoked from latex-parser.ts.

function toSubLabel(n: number): string {
  // 1→"a", 2→"b", … 26→"z", 27→"aa", …
  let s = "";
  let i = n;
  while (i > 0) {
    i--;
    s = String.fromCharCode(97 + (i % 26)) + s;
    i = Math.floor(i / 26);
  }
  return s || "a";
}

// ---------------------------------------------------------------------------
// exampleBlock
// ---------------------------------------------------------------------------

export const ExampleBlock = Node.create({
  name: "exampleBlock",
  group: "block",
  // Preamble paragraphs or a lone gloss first, then any number of items,
  // then any trailing paragraphs / gloss. Positional constraints
  // (preamble-before-items) are enforced by the parser + numbering plugin,
  // not the schema — ProseMirror can't express that gracefully.
  content: "(paragraph | exampleGloss)* exampleItem* (paragraph | exampleGloss)*",
  defining: true,
  isolating: true,
  draggable: true,

  addAttributes() {
    return {
      uuid: { default: null },
      tag: { default: "" },
      label: { default: "" },
      kind: { default: "single" }, // "single" (\ex) | "multi" (\pex)
      exnoOverride: { default: null },
      suppressSpace: { default: false }, // \ex~
      number: { default: 0 },
      /** Optional paragraph-title rendered above the block (Virgil feature —
       *  not emitted to the .tex). Same role as a regular paragraph's
       *  `parTitle`; the whole example block is treated as one unit for
       *  title/drag purposes. */
      parTitle: { default: null },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="example-block"]' }];
  },

  renderHTML({ HTMLAttributes, node }) {
    const kind = node.attrs.kind === "multi" ? "multi" : "single";
    const number = node.attrs.number ? `(${node.attrs.number})` : "(?)";
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-type": "example-block",
        "data-kind": kind,
        "data-number": number,
        class: `expex-block expex-block-${kind}`,
      }),
      0,
    ];
  },

  addNodeView() {
    return ({ node, HTMLAttributes, editor, getPos }) => {
      let currentNode = node;

      // Outer wrapper — hosts the par-title annotation strip on top and
      // the block body (drag handle + number + content) below. Same
      // structural shape as ParagraphWithTitle so the editor's existing
      // CSS and event handling keeps working.
      const wrapper = document.createElement("div");
      wrapper.className = "par-title-wrapper expex-par-wrapper";

      // Par-title annotation (above the example). Click to edit.
      const titleAnnot = document.createElement("div");
      titleAnnot.className = "par-title-annotation";
      titleAnnot.contentEditable = "false";
      wrapper.appendChild(titleAnnot);

      // Block body — the example itself.
      const dom = document.createElement("div");
      Object.entries(
        mergeAttributes(HTMLAttributes, {
          "data-type": "example-block",
          class: `expex-block expex-block-${node.attrs.kind === "multi" ? "multi" : "single"}`,
        }),
      ).forEach(([k, v]) => {
        if (typeof v === "string") dom.setAttribute(k, v);
      });
      dom.dataset.number = node.attrs.number ? `(${node.attrs.number})` : "(?)";
      if (node.attrs.tag) dom.dataset.tag = node.attrs.tag;
      if (node.attrs.label) dom.dataset.label = node.attrs.label;

      // 6-dot drag grip on the far-left gutter, outside the number column.
      // Drag picks up the whole exampleBlock (schema has draggable:true).
      const SVG_NS = "http://www.w3.org/2000/svg";
      const dragHandle = document.createElement("div");
      dragHandle.className = "par-drag-handle expex-drag-handle";
      dragHandle.setAttribute("data-drag-handle", "");
      dragHandle.draggable = true;
      const svg = document.createElementNS(SVG_NS, "svg");
      svg.setAttribute("width", "10");
      svg.setAttribute("height", "14");
      svg.setAttribute("viewBox", "0 0 10 14");
      svg.setAttribute("fill", "currentColor");
      for (const [cx, cy] of [
        [3, 2], [7, 2], [3, 7], [7, 7], [3, 12], [7, 12],
      ]) {
        const c = document.createElementNS(SVG_NS, "circle");
        c.setAttribute("cx", String(cx));
        c.setAttribute("cy", String(cy));
        c.setAttribute("r", "1.2");
        svg.appendChild(c);
      }
      dragHandle.appendChild(svg);
      dom.appendChild(dragHandle);

      const numberEl = document.createElement("span");
      numberEl.className = "expex-number";
      numberEl.contentEditable = "false";
      numberEl.textContent = node.attrs.number ? `(${node.attrs.number})` : "(?)";
      dom.appendChild(numberEl);

      const body = document.createElement("div");
      body.className = "expex-body";
      dom.appendChild(body);

      wrapper.appendChild(dom);

      // Blue "Example" annotation pod, same visual treatment as the
      // "Section 1" pod under headings. Click the "Label +" affordance
      // to set the example's \label{…}, click an existing label to
      // rename it in place.
      const labelAnnot = document.createElement("div");
      labelAnnot.className = "heading-annotation expex-label-annotation";
      labelAnnot.contentEditable = "false";
      wrapper.appendChild(labelAnnot);

      // --- Par-title rendering / editing ---
      // Mirror the paragraph convention: `has-text` when a title exists
      // (always visible), `has-add-btn` when empty (reveal on hover).
      const renderTitle = () => {
        const title = (currentNode.attrs.parTitle as string | null) || null;
        titleAnnot.innerHTML = "";
        wrapper.classList.remove("has-text", "has-add-btn");
        if (title) {
          wrapper.classList.add("has-text");
          const span = document.createElement("span");
          span.className = "par-title-text";
          span.textContent = title;
          titleAnnot.appendChild(span);
        } else {
          wrapper.classList.add("has-add-btn");
          const btn = document.createElement("button");
          btn.type = "button";
          btn.className = "par-title-add-btn";
          btn.textContent = "+T";
          btn.title = "Add paragraph title";
          titleAnnot.appendChild(btn);
        }
      };
      renderTitle();

      // --- Blue "Example" label pod ---
      const renderLabelAnnot = () => {
        const label = (currentNode.attrs.label as string | null) || null;
        labelAnnot.innerHTML = "";
        const typeSpan = document.createElement("span");
        typeSpan.textContent = "Example";
        labelAnnot.appendChild(typeSpan);
        if (label) {
          const sep = document.createElement("span");
          sep.textContent = "  ·  label: ";
          labelAnnot.appendChild(sep);
          const labelSpan = document.createElement("span");
          labelSpan.textContent = label;
          labelSpan.className = "heading-label-text";
          labelAnnot.appendChild(labelSpan);
        } else {
          const addBtn = document.createElement("span");
          addBtn.className = "heading-label-add";
          addBtn.textContent = "Label +";
          labelAnnot.appendChild(addBtn);
        }
      };
      renderLabelAnnot();

      const commitLabel = (raw: string) => {
        const next = raw.trim();
        // Prefer getPos() (cheap and scoped to this NodeView). Fall back
        // to a doc-walk by uuid when getPos returns undefined — TipTap
        // NodeViews re-rendered during React StrictMode's double-render
        // can end up with a detached getPos.
        let pos: number | null = null;
        if (typeof getPos === "function") {
          const p = getPos();
          if (typeof p === "number") pos = p;
        }
        if (pos == null) {
          const uuid = currentNode.attrs.uuid as string | null;
          if (uuid) {
            editor.state.doc.descendants((nd, p) => {
              if (pos != null) return false;
              if (nd.type.name === "exampleBlock" && nd.attrs.uuid === uuid) {
                pos = p;
                return false;
              }
              return true;
            });
          }
        }
        if (pos == null) return;
        const nd = editor.state.doc.nodeAt(pos);
        if (!nd) return;
        const tr = editor.state.tr.setNodeMarkup(pos, undefined, {
          ...nd.attrs,
          label: next,
        });
        editor.view.dispatch(tr);
      };

      const beginLabelEdit = (replaceTarget: HTMLElement) => {
        if (labelAnnot.querySelector("input")) return;
        const input = document.createElement("input");
        input.type = "text";
        input.className = "heading-label-input expex-label-input";
        input.value = (currentNode.attrs.label as string) || "";
        input.placeholder = "label key";
        replaceTarget.replaceWith(input);
        let committed = false;
        const commit = () => {
          if (committed) return;
          committed = true;
          commitLabel(input.value);
          renderLabelAnnot();
        };
        input.addEventListener("mousedown", (e) => e.stopPropagation());
        // Delay arming the blur-commit so focus transitions inside the
        // popover / editor don't swallow the intended edit — matches the
        // pattern used by the heading label input.
        let armed = false;
        input.addEventListener("blur", () => {
          if (armed) commit();
        });
        input.addEventListener("keydown", (e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            committed = true;
            renderLabelAnnot();
          }
        });
        requestAnimationFrame(() => {
          input.focus();
          if (currentNode.attrs.label) {
            input.selectionStart = input.selectionEnd = input.value.length;
          } else {
            input.select();
          }
        });
        setTimeout(() => {
          armed = true;
        }, 200);
      };

      labelAnnot.addEventListener("mousedown", (e) => {
        e.preventDefault();
        e.stopPropagation();
      });
      labelAnnot.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const target = e.target as HTMLElement;
        if (target.classList.contains("heading-label-text")) {
          beginLabelEdit(target);
        } else if (target.classList.contains("heading-label-add")) {
          // Swap "Label +" for an empty editable label slot.
          const sep = document.createElement("span");
          sep.textContent = "  ·  label: ";
          const labelSpan = document.createElement("span");
          labelSpan.className = "heading-label-text";
          target.replaceWith(sep);
          sep.after(labelSpan);
          beginLabelEdit(labelSpan);
        }
      });

      const commitTitle = (raw: string) => {
        const next = raw.trim() || null;
        let pos: number | null = null;
        if (typeof getPos === "function") {
          const p = getPos();
          if (typeof p === "number") pos = p;
        }
        if (pos == null) {
          const uuid = currentNode.attrs.uuid as string | null;
          if (uuid) {
            editor.state.doc.descendants((nd, p) => {
              if (pos != null) return false;
              if (nd.type.name === "exampleBlock" && nd.attrs.uuid === uuid) {
                pos = p;
                return false;
              }
              return true;
            });
          }
        }
        if (pos == null) return;
        const nd = editor.state.doc.nodeAt(pos);
        if (!nd) return;
        const tr = editor.state.tr.setNodeMarkup(pos, undefined, {
          ...nd.attrs,
          parTitle: next,
        });
        editor.view.dispatch(tr);
      };

      titleAnnot.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        titleAnnot.innerHTML = "";
        const input = document.createElement("input");
        input.type = "text";
        input.className = "par-title-input";
        input.value = (currentNode.attrs.parTitle as string) || "";
        input.placeholder = "Title…";
        titleAnnot.appendChild(input);
        let committed = false;
        const commit = () => {
          if (committed) return;
          committed = true;
          commitTitle(input.value);
          renderTitle();
        };
        let armed = false;
        input.addEventListener("blur", () => {
          if (armed) commit();
        });
        input.addEventListener("keydown", (ev) => {
          if (ev.key === "Enter") {
            ev.preventDefault();
            commit();
          } else if (ev.key === "Escape") {
            ev.preventDefault();
            committed = true;
            renderTitle();
          }
        });
        requestAnimationFrame(() => {
          input.focus();
          input.select();
        });
        setTimeout(() => {
          armed = true;
        }, 200);
      });

      return {
        dom: wrapper,
        contentDOM: body,
        // Keep ProseMirror out of our annotation areas (par-title +T and
        // the blue "Example" pod). Without these the input inside loses
        // focus on the very first character typed — PM reclaims selection
        // for the editable content.
        stopEvent(event) {
          const target = event.target as globalThis.Node | null;
          if (!target) return false;
          if (titleAnnot === target || titleAnnot.contains(target)) return true;
          if (labelAnnot === target || labelAnnot.contains(target)) return true;
          if (dragHandle === target || dragHandle.contains(target)) return true;
          return false;
        },
        ignoreMutation(mutation) {
          const t = mutation.target as globalThis.Node;
          if (titleAnnot.contains(t)) return true;
          if (labelAnnot.contains(t)) return true;
          if (dragHandle.contains(t)) return true;
          return false;
        },
        update(updatedNode) {
          if (updatedNode.type.name !== "exampleBlock") return false;
          currentNode = updatedNode;
          const next = updatedNode.attrs.number
            ? `(${updatedNode.attrs.number})`
            : "(?)";
          if (numberEl.textContent !== next) numberEl.textContent = next;
          dom.dataset.number = next;
          dom.dataset.kind =
            updatedNode.attrs.kind === "multi" ? "multi" : "single";
          dom.className = `expex-block expex-block-${dom.dataset.kind}`;
          if (updatedNode.attrs.tag) dom.dataset.tag = updatedNode.attrs.tag;
          else delete dom.dataset.tag;
          if (updatedNode.attrs.label) dom.dataset.label = updatedNode.attrs.label;
          else delete dom.dataset.label;
          // Re-render title annot only if not currently being edited.
          if (!titleAnnot.querySelector("input")) renderTitle();
          if (!labelAnnot.querySelector("input")) renderLabelAnnot();
          return true;
        },
      };
    };
  },
});

// ---------------------------------------------------------------------------
// exampleItem
// ---------------------------------------------------------------------------

export const ExampleItem = Node.create({
  name: "exampleItem",
  content: "paragraph+ exampleGloss?",
  defining: true,
  isolating: true,

  addAttributes() {
    return {
      tag: { default: "" },
      label: { default: "" },
      subLabel: { default: "" },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="example-item"]' }];
  },

  renderHTML({ HTMLAttributes, node }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-type": "example-item",
        "data-sublabel": node.attrs.subLabel || "",
        class: "expex-item",
      }),
      0,
    ];
  },

  addNodeView() {
    return ({ node, HTMLAttributes }) => {
      const dom = document.createElement("div");
      Object.entries(
        mergeAttributes(HTMLAttributes, {
          "data-type": "example-item",
          class: "expex-item",
        }),
      ).forEach(([k, v]) => {
        if (typeof v === "string") dom.setAttribute(k, v);
      });
      if (node.attrs.tag) dom.dataset.tag = node.attrs.tag;
      if (node.attrs.label) dom.dataset.label = node.attrs.label;
      dom.dataset.sublabel = node.attrs.subLabel || "";

      const marker = document.createElement("span");
      marker.className = "expex-item-marker";
      marker.contentEditable = "false";
      marker.textContent = `${node.attrs.subLabel || "?"}.`;
      dom.appendChild(marker);

      const body = document.createElement("div");
      body.className = "expex-item-body";
      dom.appendChild(body);

      return {
        dom,
        contentDOM: body,
        update(updatedNode) {
          if (updatedNode.type.name !== "exampleItem") return false;
          marker.textContent = `${updatedNode.attrs.subLabel || "?"}.`;
          dom.dataset.sublabel = updatedNode.attrs.subLabel || "";
          if (updatedNode.attrs.tag) dom.dataset.tag = updatedNode.attrs.tag;
          else delete dom.dataset.tag;
          if (updatedNode.attrs.label)
            dom.dataset.label = updatedNode.attrs.label;
          else delete dom.dataset.label;
          return true;
        },
      };
    };
  },
});

// ---------------------------------------------------------------------------
// exampleGloss
// ---------------------------------------------------------------------------

export const ExampleGloss = Node.create({
  name: "exampleGloss",
  group: "block",
  content: "(alignedGlossRow | proseGlossRow)+",
  defining: true,
  isolating: true,

  addAttributes() {
    return {
      glossId: { default: null },
      colCount: { default: 1 },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="example-gloss"]' }];
  },

  renderHTML({ HTMLAttributes, node }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-type": "example-gloss",
        class: "expex-gloss",
        style: `--expex-col-count: ${Math.max(1, Number(node.attrs.colCount) || 1)}`,
      }),
      0,
    ];
  },

  addNodeView() {
    return ({ node, HTMLAttributes }) => {
      const dom = document.createElement("div");
      Object.entries(
        mergeAttributes(HTMLAttributes, {
          "data-type": "example-gloss",
          class: "expex-gloss",
        }),
      ).forEach(([k, v]) => {
        if (typeof v === "string") dom.setAttribute(k, v);
      });
      const cols = Math.max(1, Number(node.attrs.colCount) || 1);
      dom.style.setProperty("--expex-col-count", String(cols));
      return {
        dom,
        contentDOM: dom,
        update(updatedNode) {
          if (updatedNode.type.name !== "exampleGloss") return false;
          const c = Math.max(1, Number(updatedNode.attrs.colCount) || 1);
          dom.style.setProperty("--expex-col-count", String(c));
          return true;
        },
      };
    };
  },
});

// ---------------------------------------------------------------------------
// alignedGlossRow — gla/glb/glc
// ---------------------------------------------------------------------------

export const AlignedGlossRow = Node.create({
  name: "alignedGlossRow",
  content: "glossCell*",

  addAttributes() {
    return {
      tier: { default: "gla" }, // "gla" | "glb" | "glc"
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="gloss-row-aligned"]' }];
  },

  renderHTML({ HTMLAttributes, node }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-type": "gloss-row-aligned",
        "data-tier": node.attrs.tier || "gla",
        class: `expex-gloss-row expex-gloss-row-${node.attrs.tier || "gla"}`,
      }),
      0,
    ];
  },
});

// ---------------------------------------------------------------------------
// proseGlossRow — glpreamble / glft
// ---------------------------------------------------------------------------

export const ProseGlossRow = Node.create({
  name: "proseGlossRow",
  content: "inline*",

  addAttributes() {
    return {
      tier: { default: "glft" }, // "glpreamble" | "glft"
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="gloss-row-prose"]' }];
  },

  renderHTML({ HTMLAttributes, node }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-type": "gloss-row-prose",
        "data-tier": node.attrs.tier || "glft",
        class: `expex-gloss-row expex-gloss-row-prose expex-gloss-row-${node.attrs.tier || "glft"}`,
      }),
      0,
    ];
  },
});

// ---------------------------------------------------------------------------
// glossCell — one column at one tier
// ---------------------------------------------------------------------------

export const GlossCell = Node.create({
  name: "glossCell",
  content: "inline*",
  isolating: true,

  parseHTML() {
    return [{ tag: 'span[data-type="gloss-cell"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-type": "gloss-cell",
        class: "expex-gloss-cell",
      }),
      0,
    ];
  },
});

// ---------------------------------------------------------------------------
// Numbering + column-count maintenance plugin
// ---------------------------------------------------------------------------

export const ExpexNumbering = Extension.create({
  name: "expexNumbering",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("expexNumbering"),
        appendTransaction(transactions, _oldState, newState) {
          if (!transactions.some((tr) => tr.docChanged)) return null;
          const tr = newState.tr;
          let changed = false;

          let exampleCounter = 0;
          newState.doc.descendants((node, pos) => {
            if (node.type.name === "exampleBlock") {
              exampleCounter++;
              const targetNumber = node.attrs.exnoOverride
                ? node.attrs.exnoOverride
                : exampleCounter;
              if (node.attrs.number !== targetNumber) {
                tr.setNodeMarkup(pos, undefined, {
                  ...node.attrs,
                  number: targetNumber,
                });
                changed = true;
              }
              // Items are children — walk them now and return false to skip
              // re-entry (descendants will still traverse, but we've set
              // our numbering by then).
              let itemCounter = 0;
              node.descendants((child, relPos) => {
                if (child.type.name === "exampleItem") {
                  itemCounter++;
                  const target = toSubLabel(itemCounter);
                  if (child.attrs.subLabel !== target) {
                    tr.setNodeMarkup(pos + 1 + relPos, undefined, {
                      ...child.attrs,
                      subLabel: target,
                    });
                    changed = true;
                  }
                  return false; // don't recurse into item bodies
                }
                return true;
              });
              return false; // don't recurse; we've handled items ourselves
            }
            return true;
          });

          // Maintain colCount on every exampleGloss — the max number of
          // cells across its aligned rows.
          newState.doc.descendants((node, pos) => {
            if (node.type.name === "exampleGloss") {
              let max = 0;
              node.forEach((row) => {
                if (row.type.name === "alignedGlossRow") {
                  if (row.childCount > max) max = row.childCount;
                }
              });
              const target = Math.max(1, max);
              if (node.attrs.colCount !== target) {
                tr.setNodeMarkup(pos, undefined, {
                  ...node.attrs,
                  colCount: target,
                });
                changed = true;
              }
            }
            return true;
          });

          return changed ? tr : null;
        },
      }),
    ];
  },

  addKeyboardShortcuts() {
    return {
      // Tab inside a glossCell moves to next cell (create one at end).
      Tab: ({ editor }) => {
        const { state } = editor;
        const { $from } = state.selection;
        for (let d = $from.depth; d >= 0; d--) {
          const node = $from.node(d);
          if (node.type.name !== "glossCell") continue;
          const rowDepth = d - 1;
          const row = $from.node(rowDepth);
          if (row.type.name !== "alignedGlossRow") return false;
          const cellIndex = $from.index(rowDepth);
          const rowStart = $from.before(rowDepth);
          if (cellIndex < row.childCount - 1) {
            // Move to start of next cell
            const nextCellStart =
              rowStart + 1 + row.child(cellIndex).nodeSize;
            const pos = nextCellStart + 1;
            editor.view.dispatch(
              state.tr.setSelection(TextSelection.create(state.doc, pos)),
            );
            return true;
          }
          // At last cell — insert a new empty cell
          const endOfRow = rowStart + row.nodeSize - 1;
          const cellType = state.schema.nodes.glossCell;
          if (!cellType) return false;
          const tr = state.tr.insert(endOfRow, cellType.create());
          const pos = endOfRow + 2; // inside the new empty cell
          tr.setSelection(TextSelection.create(tr.doc, pos));
          editor.view.dispatch(tr);
          return true;
        }
        return false;
      },
      // Full carriage return inside an `\a` sub-item → append a fresh
      // sibling `\a` item below and move cursor into it. The numbering
      // plugin re-letters the whole sequence on the resulting tx.
      // Shift-Enter still inserts a hard break (TipTap default).
      Enter: ({ editor }) => {
        const { state } = editor;
        const { $from, empty } = state.selection;
        if (!empty) return false;
        let itemDepth = -1;
        for (let d = $from.depth; d >= 0; d--) {
          if ($from.node(d).type.name === "exampleItem") {
            itemDepth = d;
            break;
          }
        }
        if (itemDepth < 0) return false;
        const itemType = state.schema.nodes.exampleItem;
        const paragraphType = state.schema.nodes.paragraph;
        if (!itemType || !paragraphType) return false;
        const item = $from.node(itemDepth);
        const itemStart = $from.before(itemDepth);
        const itemEnd = itemStart + item.nodeSize;
        const newItem = itemType.create(
          { tag: "", label: "", subLabel: "" },
          paragraphType.create(),
        );
        const tr = state.tr.insert(itemEnd, newItem);
        const cursorPos = itemEnd + 2;
        tr.setSelection(TextSelection.create(tr.doc, cursorPos));
        editor.view.dispatch(tr);
        editor.view.focus();
        return true;
      },
      "Shift-Tab": ({ editor }) => {
        const { state } = editor;
        const { $from } = state.selection;
        for (let d = $from.depth; d >= 0; d--) {
          const node = $from.node(d);
          if (node.type.name !== "glossCell") continue;
          const rowDepth = d - 1;
          const row = $from.node(rowDepth);
          if (row.type.name !== "alignedGlossRow") return false;
          const cellIndex = $from.index(rowDepth);
          if (cellIndex === 0) return true; // swallow at first cell
          const rowStart = $from.before(rowDepth);
          let prevStart = rowStart + 1;
          for (let i = 0; i < cellIndex - 1; i++) {
            prevStart += row.child(i).nodeSize;
          }
          // prevStart now points to the start of the (cellIndex-1) cell
          const prevCell = row.child(cellIndex - 1);
          const pos = prevStart + 1 + prevCell.content.size;
          editor.view.dispatch(
            state.tr.setSelection(TextSelection.create(state.doc, pos)),
          );
          return true;
        }
        return false;
      },
    };
  },
});
