import { Node, mergeAttributes, ReactNodeViewRenderer } from "@tiptap/react";
import type { Editor } from "@tiptap/react";
import FigureBlockNodeView from "@/components/FigureBlockNodeView";
import type { FigureBlockOptions } from "./figure-block";
import { UUID_ATTR_SPEC } from "./uuid-attr";
// CHIP 6a: the pure (React-free) fresh-attrs builder moved to `figure-attrs.ts`
// (see figure-block.ts for the rationale — keep the registry's `graphicsRun` +
// node-env vitests off this module's NodeView/storage graph). Re-exported under
// the original names so existing import paths keep working.
export {
  GRAPHICS_STUB_COMMAND,
  freshGraphicsBlockAttrs,
} from "./figure-attrs";
export type { FreshGraphicsBlockAttrs } from "./figure-attrs";
// CHIP 6a: graphics insertion is ONE implementation — `graphicsRun` in the
// action registry (INSERT via the shared `smartInsertBlock`, DA-2, then open the
// source popover). This standalone helper DELEGATES to it, the graphics twin of
// `insertFigureBlock`'s delegation to `figureRun`.
import {
  graphicsRun,
  type ActionContext,
} from "@/lib/actions/action-registry";

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
      figureFloat: false,
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

/**
 * The seed the graphics SOURCE popover opens on for a freshly-inserted block —
 * the graphics twin of `FigurePopoverSeed`. `raw` is the `\includegraphics`
 * command (graphicsBlock's source-of-truth lives on `command`, not a synthesized
 * env body).
 */
export interface GraphicsPopoverSeed {
  kind: "graphicsBlock";
  raw: string;
  pos: number;
  rect: DOMRect;
}

/**
 * Insert a fresh `graphicsBlock` and open its source popover — the graphics twin
 * of `insertFigureBlock` (CHIP 6a). DELEGATES to the registry's `graphicsRun`
 * (the ONE graphics creator: INSERT via the shared `smartInsertBlock`, DA-2, then
 * open the source popover), building a view-only `ActionContext` off the live
 * selection and threading `onOpenPopover` as `ctx.openFigurePopover`. The dual-
 * use `virgil-figure-click` split is owned by `graphicsRun`; the EDIT listener is
 * untouched.
 */
export function insertGraphicsBlock(
  editor: Editor,
  onOpenPopover?: (seed: GraphicsPopoverSeed) => void,
): void {
  const ctx: ActionContext = {
    editor,
    view: editor.view,
    ref: {
      kind: "selection",
      from: editor.state.selection.from,
      to: editor.state.selection.to,
      paragraphId: "",
    },
    surface: "lightning",
    ...(onOpenPopover
      ? { openFigurePopover: onOpenPopover as ActionContext["openFigurePopover"] }
      : {}),
  };
  graphicsRun(ctx);
}
