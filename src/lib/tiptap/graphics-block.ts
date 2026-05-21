import { Node, mergeAttributes, ReactNodeViewRenderer } from "@tiptap/react";
import FigureBlockNodeView from "@/components/FigureBlockNodeView";
import type { FigureBlockOptions } from "./figure-block";

// `graphicsBlock` — represents a standalone `\includegraphics` that lives
// at block level (not inside a `\begin{figure}` env). Common in informal
// figures and quick inclusions. Carries the verbatim command in
// `command` for byte-stable round-trip; structured attrs (`source`,
// `widthPercent`) drive display only.
export const GraphicsBlock = Node.create<FigureBlockOptions>({
  name: "graphicsBlock",
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
      command: { default: "" },
      uuid: { default: null, renderHTML: () => ({}) },
      source: { default: "", renderHTML: () => ({}) },
      widthPercent: { default: null, renderHTML: () => ({}) },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="graphics-block"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, { "data-type": "graphics-block" }),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(FigureBlockNodeView);
  },
});
