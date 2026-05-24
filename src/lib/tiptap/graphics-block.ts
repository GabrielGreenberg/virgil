import { Node, mergeAttributes, ReactNodeViewRenderer } from "@tiptap/react";
import type { Editor } from "@tiptap/react";
import { generateShortId } from "@/lib/uuid";
import FigureBlockNodeView from "@/components/FigureBlockNodeView";
import type { FigureBlockOptions } from "./figure-block";
import { UUID_ATTR_SPEC } from "./uuid-attr";

// `graphicsBlock` — represents a standalone `\includegraphics` that lives
// at block level (not inside a `\begin{figure}` env). Common in informal
// figures and quick inclusions. Carries the verbatim command in
// `command` for byte-stable round-trip; structured attrs (`source`,
// `widthPercent`) drive display only.
export const GraphicsBlock = Node.create<FigureBlockOptions>({
  name: "graphicsBlock",
  group: "block textObject",
  atom: true,
  selectable: true,

  addOptions() {
    return {
      docIdRef: null,
      cardContext: false,
      onConfirmLabelRenameRef: null,
      onConfirmFigureDeleteRef: null,
    };
  },

  addAttributes() {
    return {
      command: { default: "" },
      uuid: UUID_ATTR_SPEC.uuid,
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

export function collectGraphicsBlockUuids(doc: {
  descendants: (
    fn: (n: { type: { name: string }; attrs: Record<string, unknown> }) => boolean | void,
  ) => void;
}): Set<string> {
  const set = new Set<string>();
  doc.descendants((node) => {
    if (node.type.name === "graphicsBlock" && node.attrs.uuid) {
      set.add(node.attrs.uuid as string);
    }
    return true;
  });
  return set;
}

const GRAPHICS_STUB_COMMAND = "\\includegraphics[width=0.5\\textwidth]{}";

export interface FreshGraphicsBlockAttrs {
  command: string;
  source: string;
  widthPercent: number;
  uuid: string;
}

export function freshGraphicsBlockAttrs(existing: Set<string>): FreshGraphicsBlockAttrs {
  return {
    command: GRAPHICS_STUB_COMMAND,
    source: "",
    widthPercent: 50,
    uuid: generateShortId(existing),
  };
}

export function insertGraphicsBlock(editor: Editor): void {
  const attrs = freshGraphicsBlockAttrs(collectGraphicsBlockUuids(editor.state.doc));
  editor.chain().focus().deleteSelection().insertContent({ type: "graphicsBlock", attrs }).run();
  // Pop the tex-mode popover — mirrors `insertFigureBlock`. The bridge's
  // `detail.raw` is the textarea seed; for graphicsBlock the source-of-truth
  // string lives on `command`, so we pass that.
  requestAnimationFrame(() => {
    let foundPos = -1;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "graphicsBlock" && node.attrs.uuid === attrs.uuid) {
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
          kind: "graphicsBlock",
          raw: attrs.command,
          pos: foundPos,
          rect: dom.getBoundingClientRect(),
        },
      }),
    );
  });
}
