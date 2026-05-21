import { Node, mergeAttributes, ReactNodeViewRenderer } from "@tiptap/react";
import type { RefObject } from "react";
import FigureBlockNodeView from "@/components/FigureBlockNodeView";

// Shared between FigureBlock and GraphicsBlock — the NodeView reads
// `extension.options.docIdRef.current` to know which paper folder to
// resolve `\includegraphics` paths against. Configured in Editor.tsx.
export interface FigureBlockOptions {
  docIdRef: RefObject<string | null> | null;
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
