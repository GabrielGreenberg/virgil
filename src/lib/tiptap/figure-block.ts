import { Node, mergeAttributes, ReactNodeViewRenderer } from "@tiptap/react";
import type { Editor } from "@tiptap/react";
import type { RefObject } from "react";
import { generateShortId } from "@/lib/uuid";
import FigureBlockNodeView from "@/components/FigureBlockNodeView";

// Shared between FigureBlock and GraphicsBlock — the NodeView reads
// `extension.options.docIdRef.current` to know which paper folder to
// resolve `\includegraphics` paths against. Configured in Editor.tsx.
//
// `cardContext`: when true, the NodeView renders a compact pill
// (caption / source filename) instead of resolving images. Set by every
// card-bearing rich-text surface so figureBlock/graphicsBlock round-trip
// without losing content and without needing docIdRef forwarded.
export interface FigureBlockOptions {
  docIdRef: RefObject<string | null> | null;
  cardContext: boolean;
}

// `figureBlock` — represents a `\begin{figure}...\end{figure}` (or
// `\begin{figure*}...\end{figure*}`) environment. Holds the verbatim env
// body in `raw` for byte-stable round-trip; structured attrs (`source`,
// `widthPercent`, `caption`, `label`) drive display only.
//
// Subfigures are represented by `sources: FigureSource[]`. The first one
// is exposed as `source` for the common single-image case.
export const FigureBlock = Node.create<FigureBlockOptions>({
  name: "figureBlock",
  group: "block",
  atom: true,
  draggable: true,
  selectable: true,

  addOptions() {
    return {
      docIdRef: null,
      cardContext: false,
    };
  },

  addAttributes() {
    return {
      raw: { default: "" },
      placement: { default: "" },
      starred: { default: false, renderHTML: () => ({}) },
      uuid: { default: null, renderHTML: () => ({}) },
      source: { default: null, renderHTML: () => ({}) },
      widthPercent: { default: null, renderHTML: () => ({}) },
      sources: { default: [], renderHTML: () => ({}) },
      caption: { default: "" },
      label: { default: "" },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="figure-block"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, { "data-type": "figure-block" }),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(FigureBlockNodeView);
  },
});

export function collectFigureBlockUuids(doc: {
  descendants: (
    fn: (n: { type: { name: string }; attrs: Record<string, unknown> }) => boolean | void,
  ) => void;
}): Set<string> {
  const set = new Set<string>();
  doc.descendants((node) => {
    if (node.type.name === "figureBlock" && node.attrs.uuid) {
      set.add(node.attrs.uuid as string);
    }
    return true;
  });
  return set;
}

// Stub `\begin{figure}` body: centered \includegraphics with an empty path,
// plus an empty caption and a `fig:` label prefix so the user has the LaTeX
// shape to fill in rather than reconstructing it from memory.
const FIGURE_STUB_RAW =
  "\n  \\centering\n  \\includegraphics[width=0.6\\textwidth]{}\n  \\caption{}\n  \\label{fig:}\n";

export interface FreshFigureBlockAttrs {
  raw: string;
  placement: string;
  starred: boolean;
  source: string | null;
  widthPercent: number;
  sources: unknown[];
  caption: string;
  label: string;
  uuid: string;
}

export function freshFigureBlockAttrs(existing: Set<string>): FreshFigureBlockAttrs {
  return {
    raw: FIGURE_STUB_RAW,
    placement: "",
    starred: false,
    source: null,
    widthPercent: 60,
    sources: [],
    caption: "",
    label: "fig:",
    uuid: generateShortId(existing),
  };
}

export function insertFigureBlock(editor: Editor): void {
  const attrs = freshFigureBlockAttrs(collectFigureBlockUuids(editor.state.doc));
  // `.deleteSelection()` first to match the `insertTexBlock` / example-block
  // patterns — block-level atom inserts no-op when straddling a paragraph
  // selection.
  editor.chain().focus().deleteSelection().insertContent({ type: "figureBlock", attrs }).run();
  // Pop the tex-mode popover so the user can fill in the empty path
  // immediately. One rAF is enough — matches the popover's own focus rAF.
  // Look up the new node by uuid (unique to this insert) so we don't have
  // to reason about where ProseMirror chose to place the block.
  requestAnimationFrame(() => {
    let foundPos = -1;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "figureBlock" && node.attrs.uuid === attrs.uuid) {
        foundPos = pos;
        return false;
      }
      return true;
    });
    if (foundPos < 0) return;
    const dom = editor.view.nodeDOM(foundPos);
    if (!(dom instanceof HTMLElement)) return;
    window.dispatchEvent(
      new CustomEvent("virgil-figure-click", {
        detail: {
          kind: "figureBlock",
          raw: attrs.raw,
          pos: foundPos,
          rect: dom.getBoundingClientRect(),
        },
      }),
    );
  });
}
