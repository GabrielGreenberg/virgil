import { Node, mergeAttributes, ReactNodeViewRenderer } from "@tiptap/react";
import type { Editor } from "@tiptap/react";
import type { RefObject } from "react";
import { generateShortId } from "@/lib/uuid";
import TexBlockNodeView from "@/components/TexBlockNodeView";

// Options injected from Editor.tsx via `TexBlock.configure({…})` so the
// NodeView can dispatch lift-to-float and read the popped-out state. The
// double-ref shape on `isPoppedRef` mirrors the ExampleBlock convention:
// the outer ref tracks the (sometimes-changing) inner ref's identity, the
// inner ref holds the live predicate. See ParagraphWithTitle node view in
// Editor.tsx for the equivalent paragraph wiring.
export interface TexBlockOptions {
  onLiftRef: RefObject<
    | ((
        uuid: string,
        rect: { x: number; y: number; width: number; height: number },
      ) => void)
    | undefined
  > | null;
  isPoppedRef: RefObject<RefObject<(uuid: string) => boolean> | undefined> | null;
  // Mirrors the paragraph/heading drag-handle pattern: a click on the
  // grip (mouseup within the LIFT_THRESHOLD) opens the passage-action
  // menu anchored to the handle's rect.
  onDragHandleClickRef: RefObject<
    | ((uuid: string, anchorRect: DOMRect) => void)
    | undefined
  > | null;
  // When true, the NodeView renders a compact static preview (no
  // CodeMirror, no grab handle, no edit/delete chrome). Set by every
  // card-bearing rich-text surface (RichTextField + HeadingFloat) so
  // block atoms round-trip through archive / note / cut / heading-float
  // bodies without TipTap silently dropping them as unknown nodes.
  cardContext: boolean;
}

// `texBlock` — a raw LaTeX passthrough block. Contents are stored in the
// `code` attr (an opaque string), shown in a CodeMirror box with LaTeX
// syntax highlighting, and emitted verbatim into the .tex source wrapped
// in `%!vtex:begin <uuid>` / `%!vtex:end <uuid>` comment sentinels so the
// LaTeX compiler treats the contents as real LaTeX (not verbatim).
export const TexBlock = Node.create<TexBlockOptions>({
  name: "texBlock",
  group: "block textObject",
  atom: true,
  draggable: true,
  // PM would otherwise create a NodeSelection on mousedown that scrolls the
  // row before CodeMirror gets focus. Matching footnote.ts rationale.
  selectable: false,

  addOptions() {
    return {
      onLiftRef: null,
      isPoppedRef: null,
      onDragHandleClickRef: null,
      cardContext: false,
    };
  },

  addAttributes() {
    return {
      code: { default: "" },
      // Hidden from HTML; carried in JSON only.
      uuid: { default: null, renderHTML: () => ({}) },
      // Optional user-supplied title shown above the pod via the +T affordance.
      // Persisted in the sidecar YAML (keyed by uuid) — see
      // extractSidecarData/recoverOrphanedUuids. Same attr name as
      // ParagraphWithTitle so the existing pipeline picks it up.
      parTitle: { default: null, renderHTML: () => ({}) },
      // Sticky collapse state — true means render the compact preview
      // (title + first 2 lines of code + "…") instead of the full
      // CodeMirror pod. Persisted via the sidecar pipeline alongside
      // parTitle so it survives reloads.
      collapsed: { default: false, renderHTML: () => ({}) },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="tex-block"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, { "data-type": "tex-block" }),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(TexBlockNodeView);
  },
});

export function collectTexBlockUuids(doc: { descendants: (fn: (n: { type: { name: string }; attrs: Record<string, unknown> }) => boolean | void) => void }): Set<string> {
  const set = new Set<string>();
  doc.descendants((node) => {
    if (node.type.name === "texBlock" && node.attrs.uuid) {
      set.add(node.attrs.uuid as string);
    }
    return true;
  });
  return set;
}

export function freshTexBlockAttrs(existing: Set<string>): { uuid: string; code: string } {
  return { uuid: generateShortId(existing), code: "" };
}

export function insertTexBlock(editor: Editor): void {
  const { from, to, empty } = editor.state.selection;
  // When a selection is present, seed the new block with the selected plain
  // text rather than discarding it. `\n` between block boundaries, and the
  // 4th leafText callback turns Shift+Enter `hardBreak` nodes into `\n` too
  // (default would drop them). Tabs survive automatically — TabIndent
  // ([src/lib/tiptap/tab-indent.ts](src/lib/tiptap/tab-indent.ts)) inserts
  // literal `\t` into text content.
  const seedCode = empty
    ? ""
    : editor.state.doc.textBetween(from, to, "\n", (node) =>
        node.type.name === "hardBreak" ? "\n" : "",
      );
  const attrs = {
    ...freshTexBlockAttrs(collectTexBlockUuids(editor.state.doc)),
    code: seedCode,
  };
  // `.deleteSelection()` first, then `.insertContent()` — without the
  // explicit delete, insertContent silently no-ops when trying to place a
  // block-level atom across an active range inside a paragraph. Matches
  // the wrapSelectionInExample pattern in SelectionActionsMenu.tsx.
  editor.chain().focus().deleteSelection().insertContent({ type: "texBlock", attrs }).run();
}
