import { Node, mergeAttributes } from "@tiptap/react";
import type { Editor } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import katex from "katex";
import { UUID_ATTR_SPEC, stampTextObjectAttrs } from "./uuid-attr";

function renderMath(target: HTMLElement, latex: string, displayMode: boolean) {
  target.innerHTML = "";
  if (!latex) {
    const ph = document.createElement("span");
    ph.className = "math-placeholder";
    ph.textContent = displayMode ? "( empty display math )" : "( empty math )";
    target.appendChild(ph);
    return;
  }
  try {
    katex.render(latex, target, {
      throwOnError: false,
      displayMode,
      errorColor: "#cc0000",
      output: "html",
    });
  } catch {
    const err = document.createElement("span");
    err.className = "math-error";
    err.textContent = latex;
    target.appendChild(err);
  }
}

function mathNodeView(opts: {
  node: any;
  getPos: any;
  // The full TipTap editor instance that OWNS this NodeView — i.e. the editor
  // whose pos-space `getPos()` indexes. The click→edit bridge carries this
  // instance so the save routes the write back to THIS editor (main OR an
  // embedded card/float surface), never blindly to MAIN. `isEditable` still
  // gates the click (a read-only surface stays inert). See the click handler.
  editor: Editor;
  // Which editor surface this NodeView is mounted on. The click→edit bridge no
  // longer gates on this (it routes by the owning `editor` instead); `surface`
  // is still read by `selectNode()` to keep the single-node-float selection
  // chrome MAIN-only (R2). Threaded from the node's `surface` option.
  surface: "main" | "float";
  tag: "span" | "div";
  className: string;
  kind: "inline" | "display";
  displayMode: boolean;
}) {
  const { node, getPos, editor, surface, tag, className, kind, displayMode } = opts;
  const dom = document.createElement(tag);
  dom.className = className;
  dom.contentEditable = "false";
  dom.draggable = false; // see footnote.ts: keep the grab gesture's mousemove stream
  dom.setAttribute("data-type", kind === "inline" ? "inline-math" : "display-math");

  renderMath(dom, node.attrs.latex || "", displayMode);

  // 2d: NodeView-owned data-uuid/kind exposure (displayMath is anchorable;
  // MAIN surface only — parity with the deleted UuidAttrDecorator scope).
  if (surface === "main" && node.type.spec.attrs?.uuid !== undefined) {
    stampTextObjectAttrs(dom, node, null);
  }

  dom.addEventListener("click", (e: Event) => {
    e.preventDefault();
    e.stopPropagation();
    // The click→edit bridge (`virgil-math-click` → MathPopover →
    // handleMathSave) edits a math node by absolute `pos`. The OLD gate fired
    // from the "main" surface only, because the save always targeted the MAIN
    // editor: a float's `getPos()` indexes the float doc, not the page, so a
    // MAIN-pos write from a float would corrupt the wrong node — and the gate
    // made math inert in EVERY embedded surface (the EX-F4-02 bug: clicking
    // math inside an example-card body did nothing).
    //
    // The DEEP fix routes by the editor instance that OWNS the clicked node:
    // we carry THIS NodeView's `editor` in the event detail, and the save
    // dispatches `setNodeMarkup(pos)` on THAT editor — so `pos` is always
    // interpreted in the pos-space it was minted in. On MAIN it edits MAIN; on
    // an embedded card/float editor it edits the embed, whose own write-back
    // (`onUpdate` → `writeBackToMain` / `useFloatMainSync`) round-trips the
    // change to the main doc — no MAIN mis-targeting, no corruption. This works
    // uniformly for every editable embedded surface that hosts math: the
    // example-card body, the example-block / paragraph / linked-range floats.
    //
    // The `editor.isEditable` check is preserved (and is now the sole gate):
    // a read-only surface stays inert. This covers the read-only MAIN doc AND
    // the displayMath "view & move only" lift (decision D — its SingleBlockBody
    // float mounts `editable:false`), which both correctly remain non-editable.
    if (editor && !editor.isEditable) return;
    const pos = typeof getPos === "function" ? getPos() : undefined;
    if (pos == null) return;
    window.dispatchEvent(
      new CustomEvent("virgil-math-click", {
        detail: {
          kind,
          latex: node.attrs.latex || "",
          pos,
          rect: dom.getBoundingClientRect(),
          // The owning editor — the save MUST target this instance, not MAIN.
          editor,
        },
      })
    );
  });

  return {
    dom,
    update(updated: any) {
      if (updated.type.name !== node.type.name) return false;
      const uuidChanged = updated.attrs.uuid !== node.attrs.uuid;
      // Keep the captured node reference up to date so subsequent clicks
      // reflect the latest latex value without waiting for a re-mount.
      Object.assign(node, updated);
      renderMath(dom, updated.attrs.latex || "", displayMode);
      if (uuidChanged && surface === "main" && node.type.spec.attrs?.uuid !== undefined) {
        stampTextObjectAttrs(dom, updated, null);
      }
      return true;
    },
    selectNode() {
      // A float is a single-node surface: an atom-only float doc has no
      // interior text position, so ProseMirror rests a NodeSelection on the
      // lone atom (NodeSelection{0,1}, unfocused) — firing selectNode() at
      // rest. That would paint `.selected` chrome (a tinted background; an
      // outline for some atoms) the page never shows. So suppress the chrome
      // on the float surface only (R2 / memo L3h.1). This is INDEPENDENT of the
      // click→edit bridge above, which now routes by the owning editor rather
      // than gating on `surface`. The MAIN surface keeps its chrome unchanged.
      if (surface !== "float") dom.classList.add("selected");
    },
    deselectNode() {
      dom.classList.remove("selected");
    },
  };
}

// `surface`: which editor surface the math node is mounted on. It is read by
// the NodeView's `selectNode()` to keep the single-node-float selection chrome
// MAIN-only (R2). The click→edit bridge NO LONGER gates on `surface` — it
// routes the math edit back to the editor instance that owns the clicked node
// (carried in the `virgil-math-click` event), so math is editable on MAIN and
// on every editable embedded surface (example-card body, example/paragraph/
// linked-range floats) alike, with read-only surfaces inert via `isEditable`.
// The `buildEditorExtensions` factory configures this per-surface
// (`.configure({ surface: isFloat ? "float" : "main" })`), exactly like its
// sibling NodeViews. Default "main" so any stray / non-factory usage behaves
// like the main surface.
export interface MathOptions {
  surface: "main" | "float";
}

export const InlineMath = Node.create<MathOptions>({
  name: "inlineMath",
  group: "inline",
  inline: true,
  atom: true,

  addOptions() {
    return {
      surface: "main",
    };
  },

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
              "￼"
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
    const surface = this.options.surface;
    return ({ node, getPos, editor }) =>
      mathNodeView({
        node,
        getPos,
        editor,
        surface,
        tag: "span",
        className: "inline-math",
        kind: "inline",
        displayMode: false,
      });
  },
});

export const DisplayMath = Node.create<MathOptions>({
  name: "displayMath",
  group: "block textObject",
  atom: true,

  addOptions() {
    return {
      surface: "main",
    };
  },

  addAttributes() {
    return {
      latex: { default: "" },
      uuid: UUID_ATTR_SPEC.uuid,
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
              "￼"
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
    const surface = this.options.surface;
    return ({ node, getPos, editor }) =>
      mathNodeView({
        node,
        getPos,
        editor,
        surface,
        tag: "div",
        className: "display-math",
        kind: "display",
        displayMode: true,
      });
  },
});
