import { Node, mergeAttributes } from "@tiptap/react";
import type { Editor } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import katex from "katex";
import { UUID_ATTR_SPEC, stampTextObjectAttrs } from "./uuid-attr";
import { chromeOnly } from "@/lib/view-only-chrome";
import {
  posHostsBlockInsert,
  posHostsInlineAtom,
} from "@/text-objects/text-object-registry";
import { refuseTypedInsertWhenReadOnly } from "./typed-latex-read-only-gate";
// Task 232: the INLINE atom's structural DOM facets (`data-type` / `class`) come
// from the atom SSOT rather than hardcoded literals, so a NodeView rename can't
// drift from ATOM_REGISTRY. displayMath is deliberately NOT an atom (a block, not
// inline) and keeps its literals. Pinned by atom-selectable-parity.test.ts.
import { ATOM_REGISTRY } from "./atom-registry";

const INLINE_MATH_ATOM = ATOM_REGISTRY["inline-math"];

/**
 * The ink KaTeX paints a parse error in, as a TOKEN read rather than a hex.
 *
 * KaTeX writes `errorColor` onto the error span's INLINE style, which beats
 * any stylesheet rule — so a `.katex-error { color: … }` rule could not own
 * this and the value has to arrive here. That makes it a colour two layers
 * must agree on byte-for-byte (this inline style and `.math-error`'s CSS
 * fallback rule), which is the "spelled ONCE" rule `src/lib/latex-markers.ts`
 * earned: both now resolve `--danger-strong`, and the popover preview reads
 * this same constant instead of its own copy (task 2026-07-20-195).
 */
export const KATEX_ERROR_COLOR = "var(--danger-strong)";

// Exported for the static T1 card tier (StaticBorrowedText's one-shot KaTeX
// pass over `[data-type="inline-math"|"display-math"]` spans) — the SAME
// paint the live NodeView runs, placeholder/error sentinels included.
export function renderMath(target: HTMLElement, latex: string, displayMode: boolean) {
  target.innerHTML = "";
  if (!latex) {
    const ph = document.createElement("span");
    // "( empty math )" is a statement about the editor; an empty `$$` prints
    // nothing in LaTeX, so the placeholder is chrome-only (task 535).
    ph.className = chromeOnly("math-placeholder");
    ph.textContent = displayMode ? "( empty display math )" : "( empty math )";
    target.appendChild(ph);
    return;
  }
  try {
    katex.render(latex, target, {
      throwOnError: false,
      displayMode,
      errorColor: KATEX_ERROR_COLOR,
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
  // The `data-type` the NodeView DOM carries. For the inline atom this is
  // sourced from ATOM_REGISTRY["inline-math"].domType (task 232) so it can't
  // drift from the SSOT; displayMath (not an atom) passes its literal.
  dataType: string;
  kind: "inline" | "display";
  displayMode: boolean;
}) {
  const { node, getPos, editor, surface, tag, className, dataType, kind, displayMode } = opts;
  const dom = document.createElement(tag);
  dom.className = className;
  dom.contentEditable = "false";
  dom.draggable = false; // see footnote.ts: keep the grab gesture's mousemove stream
  dom.setAttribute("data-type", dataType);

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
    return [{ tag: `span[data-type="${INLINE_MATH_ATOM.domType}"]` }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-type": INLINE_MATH_ATOM.domType,
        class: INLINE_MATH_ATOM.domClass,
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
            // CHIP 7b: uniform collab read-only gate (SSOT shared with the other
            // typed-LaTeX surfaces — cite/footnote/display-math/comment).
            if (refuseTypedInsertWhenReadOnly(view)) return false;
            if (text !== "$") return false;
            const { state } = view;
            // Container gate (task 150): an inline-math atom is valid in a
            // `titleField` (`inline*`) but SPLITS the `text*` verbatim blocks
            // (codeBlock / latexComment), which admit literal text only. Bail so
            // the `$` falls through as a literal char — the "refuse, don't
            // insert" contract shared with the typed cite/footnote rules (061).
            // Caret form, deliberately (task 428): an input rule's match range
            // lies inside ONE textblock, so `from` names every block it reaches.
            if (!posHostsInlineAtom(state.doc, from, nodeType)) return false;
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
        className: INLINE_MATH_ATOM.domClass,
        dataType: INLINE_MATH_ATOM.domType,
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
            // CHIP 7b: uniform collab read-only gate (SSOT shared with the other
            // typed-LaTeX surfaces — cite/footnote/inline-math/comment).
            if (refuseTypedInsertWhenReadOnly(view)) return false;
            if (text !== "$") return false;
            const { state } = view;
            // Container gate (task 150 / 147): a `displayMath` BLOCK atom splits
            // any container that can't host a block child — titleField (drops
            // the title text → data-loss on reload) and the codeBlock /
            // latexComment verbatim blocks (structural corruption). Bail so the
            // `$` falls through as a literal char. Guards BOTH the `$$`-on-empty
            // (case 1) and the `$$content$$` closing (case 2) branches, which
            // share this `from`.
            if (!posHostsBlockInsert(state.doc, from, nodeType)) return false;
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
        // displayMath is a BLOCK, not an inline atom — the registry correctly
        // omits it, so this stays a literal (task 232).
        dataType: "display-math",
        kind: "display",
        displayMode: true,
      });
  },
});
