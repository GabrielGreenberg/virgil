import { Node, mergeAttributes } from "@tiptap/react";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import katex from "katex";
import { UUID_ATTR_SPEC } from "./uuid-attr";

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
  // Only `isEditable` is read (the read-only-MAIN gate below); typed
  // structurally so the new param adds no `any` (tighter than node/getPos).
  editor: { isEditable: boolean };
  // Which editor surface this NodeView is mounted on; the click→edit bridge
  // fires from "main" only (see the click gate below). Threaded from the
  // node's `surface` option by the factory.
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
  dom.setAttribute("data-type", kind === "inline" ? "inline-math" : "display-math");

  renderMath(dom, node.attrs.latex || "", displayMode);

  dom.addEventListener("click", (e: Event) => {
    e.preventDefault();
    e.stopPropagation();
    // The click→edit bridge (`virgil-math-click` → MathPopover →
    // handleMathSave) edits the MAIN editor by absolute `pos`, so it is only
    // correct when the click originates from the main editor surface. Every
    // float carries a `getPos()` that indexes the FLOAT doc, not the page, so
    // firing from a float mis-targets MAIN at that pos (opens the popover on /
    // can corrupt the WRONG node). This holds for editable floats (a popped
    // paragraph with inline math; a linkedRange float spanning a display
    // equation — reachable since selection-bug A) AND read-only ones (the
    // displayMath "view & move only" lift, decision D). So gate on the MAIN
    // surface: fire from "main" only — inert in EVERY float. This generalizes
    // L3h's `editor.isEditable` gate, which only caught read-only floats; an
    // editable float is `isEditable:true` and slipped through. Keep the
    // `editor.isEditable` check too: the main surface always mounts
    // TipTap-editable (read-only is enforced by the readOnlyEnforcer plugin),
    // so a read-only MAIN doc shouldn't open the editor either. Net: fire iff
    // `surface === "main" && editor.isEditable`. Covers inline + display alike.
    if (surface !== "main") return;
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
        },
      })
    );
  });

  return {
    dom,
    update(updated: any) {
      if (updated.type.name !== node.type.name) return false;
      // Keep the captured node reference up to date so subsequent clicks
      // reflect the latest latex value without waiting for a re-mount.
      Object.assign(node, updated);
      renderMath(dom, updated.attrs.latex || "", displayMode);
      return true;
    },
    selectNode() {
      // A float is a single-node surface: an atom-only float doc has no
      // interior text position, so ProseMirror rests a NodeSelection on the
      // lone atom (NodeSelection{0,1}, unfocused) — firing selectNode() at
      // rest. That would paint `.selected` chrome (a tinted background; an
      // outline for some atoms) the page never shows. Gate it the same way as
      // the click→edit bridge above: suppress on the float surface only (memo
      // L3h.1, generalized from the click bridge to the selection chrome). The
      // MAIN surface keeps its selection chrome unchanged.
      if (surface !== "float") dom.classList.add("selected");
    },
    deselectNode() {
      dom.classList.remove("selected");
    },
  };
}

// `surface`: which editor surface the math node is mounted on. The
// click→edit bridge edits the MAIN editor by absolute `pos`, so the NodeView
// click fires from "main" only (see `mathNodeView`'s click gate). The
// `buildEditorExtensions` factory configures this per-surface
// (`.configure({ surface: isFloat ? "float" : "main" })`), exactly like its
// sibling NodeViews. Default "main" so any stray / non-factory usage behaves
// like the editable main surface.
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
