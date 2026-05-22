import { Node, mergeAttributes } from "@tiptap/react";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import katex from "katex";

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
  tag: "span" | "div";
  className: string;
  kind: "inline" | "display";
  displayMode: boolean;
}) {
  const { node, getPos, tag, className, kind, displayMode } = opts;
  const dom = document.createElement(tag);
  dom.className = className;
  dom.contentEditable = "false";
  dom.setAttribute("data-type", kind === "inline" ? "inline-math" : "display-math");

  renderMath(dom, node.attrs.latex || "", displayMode);

  dom.addEventListener("click", (e: Event) => {
    e.preventDefault();
    e.stopPropagation();
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
      dom.classList.add("selected");
    },
    deselectNode() {
      dom.classList.remove("selected");
    },
  };
}

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
    return ({ node, getPos }) =>
      mathNodeView({
        node,
        getPos,
        tag: "span",
        className: "inline-math",
        kind: "inline",
        displayMode: false,
      });
  },
});

export const DisplayMath = Node.create({
  name: "displayMath",
  group: "block textObject",
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
    return ({ node, getPos }) =>
      mathNodeView({
        node,
        getPos,
        tag: "div",
        className: "display-math",
        kind: "display",
        displayMode: true,
      });
  },
});
