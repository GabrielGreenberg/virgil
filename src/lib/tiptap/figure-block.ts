import { Node, mergeAttributes, ReactNodeViewRenderer } from "@tiptap/react";
import type { Editor } from "@tiptap/react";
import type { MutableRefObject, RefObject } from "react";
import { generateShortId } from "@/lib/uuid";
import FigureBlockNodeView from "@/components/FigureBlockNodeView";
import { UUID_ATTR_SPEC } from "./uuid-attr";

type LabelRenameHandler = (
  oldLabel: string,
  newLabel: string,
  refCount: number,
) => Promise<boolean>;
type DeleteHandler = () => Promise<boolean>;

// Shared between FigureBlock and GraphicsBlock — the NodeView reads
// `extension.options.docIdRef.current` to know which paper folder to
// resolve `\includegraphics` paths against. Configured in Editor.tsx.
//
// `cardContext`: when true, the NodeView renders a compact pill
// (caption / source filename) instead of resolving images. Set by every
// card-bearing rich-text surface so figureBlock/graphicsBlock round-trip
// without losing content and without needing docIdRef forwarded.
//
// The label-rename and delete confirmation refs are mirrored down from
// EditorPane via Editor.tsx so the figure annotation lozenge can prompt
// with the same modal surface as headings.
export interface FigureBlockOptions {
  docIdRef: RefObject<string | null> | null;
  cardContext: boolean;
  onConfirmLabelRenameRef: MutableRefObject<LabelRenameHandler | undefined> | null;
  onConfirmFigureDeleteRef: MutableRefObject<DeleteHandler | undefined> | null;
}

// `figureBlock` — represents a `\begin{figure}...\end{figure}` (or
// `\begin{figure*}...\end{figure*}`) environment. Caption text lives as
// a `figureCaption` child (`content: "inline*"`, so citations and marks
// work inside). Structured attrs drive the rest of the env body.
//
// `extras` carries the parts of the env body we don't model structurally
// (`\centering`, `\includegraphics`, TikZ blocks, raw comments). It is
// derived at parse time by stripping `\caption{…}` and `\label{…}` from
// the env body; the serializer always rebuilds the env as
// `extras + \caption{<from sub-node>} + \label{<from attr>}`.
//
// Subfigures are represented by `sources: FigureSource[]`. The first one
// is exposed as `source` for the common single-image case.
export const FigureBlock = Node.create<FigureBlockOptions>({
  name: "figureBlock",
  group: "block textObject",
  content: "figureCaption?",
  draggable: true,
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
      extras: { default: "" },
      placement: { default: "" },
      starred: { default: false, renderHTML: () => ({}) },
      uuid: UUID_ATTR_SPEC.uuid,
      source: { default: null, renderHTML: () => ({}) },
      widthPercent: { default: null, renderHTML: () => ({}) },
      sources: { default: [], renderHTML: () => ({}) },
      label: { default: "" },
      numbered: { default: true, renderHTML: () => ({}) },
      figureNumber: { default: null, renderHTML: () => ({}) },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="figure-block"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, { "data-type": "figure-block" }),
      0,
    ];
  },

  addNodeView() {
    // `contentDOMElementTag: "span"` so the figureCaption child node renders
    // inline with the bolded `Figure N:` prefix instead of being wrapped in
    // a block-level div (Tiptap's default for block-group nodes).
    return ReactNodeViewRenderer(FigureBlockNodeView, {
      contentDOMElementTag: "span",
    });
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

// Initial `extras` body for a fresh figure: centered `\includegraphics` with
// an empty path so the user has the LaTeX shape to fill in. `\caption{}` and
// `\label{}` are NOT included here — those are stored on the sub-node and
// the `label` attr respectively, and rebuilt by the serializer.
const FIGURE_STUB_EXTRAS =
  "\\centering\n  \\includegraphics[width=0.6\\textwidth]{}\n  ";

export interface FreshFigureBlockAttrs {
  extras: string;
  placement: string;
  starred: boolean;
  source: string | null;
  widthPercent: number;
  sources: unknown[];
  label: string;
  numbered: boolean;
  figureNumber: null;
  uuid: string;
}

export function freshFigureBlockAttrs(existing: Set<string>): FreshFigureBlockAttrs {
  return {
    extras: FIGURE_STUB_EXTRAS,
    placement: "",
    starred: false,
    source: null,
    widthPercent: 60,
    sources: [],
    label: "fig:",
    numbered: true,
    figureNumber: null,
    uuid: generateShortId(existing),
  };
}

// Rebuild a verbatim `\begin{figure}` body from structured attrs + caption
// text. Used by the serializer (at save time) AND by the popover surface
// (when opening the source editor — the popover wants something to display
// /edit even though the canonical content lives in attrs + sub-node).
export function synthesizeFigureRaw(
  extras: string,
  captionTex: string,
  label: string,
): string {
  const parts: string[] = ["\n  "];
  const extrasBody = (extras || "").replace(/\s+$/, "");
  if (extrasBody) {
    // Re-indent so the extras body sits at the same 2-space indent as the
    // rest of the env body we synthesise.
    parts.push(extrasBody.replace(/\n/g, "\n  "));
    parts.push("\n  ");
  }
  parts.push(`\\caption{${captionTex}}`);
  if (label) {
    parts.push("\n  ");
    parts.push(`\\label{${label}}`);
  }
  parts.push("\n");
  return parts.join("");
}

export function insertFigureBlock(editor: Editor): void {
  const attrs = freshFigureBlockAttrs(collectFigureBlockUuids(editor.state.doc));
  // `.deleteSelection()` first to match the `insertTexBlock` / example-block
  // patterns — block-level inserts no-op when straddling a paragraph selection.
  editor
    .chain()
    .focus()
    .deleteSelection()
    .insertContent({
      type: "figureBlock",
      attrs,
      content: [{ type: "figureCaption" }],
    })
    .run();
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
          // The popover takes a `raw` field. Synthesize one from current
          // attrs + (empty) caption so the source-editing surface stays
          // available even though we no longer store the env body as a
          // single string. Commit re-derives everything via extractFigureAttrs.
          raw: synthesizeFigureRaw(attrs.extras, "", attrs.label),
          pos: foundPos,
          rect: dom.getBoundingClientRect(),
        },
      }),
    );
  });
}
