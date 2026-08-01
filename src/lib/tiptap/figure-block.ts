import { Node, mergeAttributes, ReactNodeViewRenderer } from "@tiptap/react";
import type { Editor } from "@tiptap/react";
import type { MutableRefObject, RefObject } from "react";
import FigureBlockNodeView from "@/components/FigureBlockNodeView";
import { UUID_ATTR_SPEC } from "./uuid-attr";
// CHIP 6a: the pure (React-free) fresh-attrs builders + raw synthesizer moved to
// `figure-attrs.ts` so React-LIGHT consumers (the action registry's `figureRun`,
// node-env vitests) can import them without pulling this module's NodeView +
// `@/lib/storage` graph. Re-exported here under their original names so every
// existing import path (`@/lib/tiptap/figure-block`, the barrel,
// `FigureBlockNodeView`) keeps working unchanged.
export {
  FIGURE_STUB_EXTRAS,
  freshFigureBlockAttrs,
  synthesizeFigureRaw,
} from "./figure-attrs";
export type { FreshFigureBlockAttrs } from "./figure-attrs";
// CHIP 6a: figure insertion is now ONE implementation — `figureRun` in the
// action registry (INSERT via the shared `smartInsertBlock`, DA-2, then open the
// source popover). The grid cell reaches `figureRun` directly through the
// registry; this standalone `insertFigureBlock` DELEGATES to the SAME `figureRun`
// (building a view-only `ActionContext`) so the cell path, the helper path, and
// any future FILE-DROP path can never diverge on the creator. The registry is
// already in the editor-extension barrel graph (via `texRun`), so importing it
// here adds no new graph risk.
import {
  figureRun,
  type ActionContext,
} from "@/lib/actions/action-registry";

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
// `figureFloat`: when true, the NodeView renders the figure's OWN
// lifted-overlay float (L3n) — the shared `FigureVisual` with an EDITABLE
// caption (decision B) but a read-only image and NO chrome. Click-to-edit DOES
// fire (EX-F4-02): the `virgil-figure-click` carries the float's own editor, so
// `handleFigureSave` routes the edit back into the float (round-tripping to
// MAIN via figure-body's write-back) instead of mis-applying a MAIN-pos write.
// Set ONLY by `figure-body.tsx`; takes precedence over `cardContext` in the
// NodeView dispatch.
//
// The label-rename and delete confirmation refs are mirrored down from
// EditorPane via Editor.tsx so the figure annotation lozenge can prompt
// with the same modal surface as headings.
export interface FigureBlockOptions {
  /** Stamp gate for the NodeView data-uuid/kind exposure (2d): only the
   *  MAIN document surface carries the attributes (decorator parity). */
  surface: "main" | "float";
  docIdRef: RefObject<string | null> | null;
  cardContext: boolean;
  figureFloat: boolean;
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
  selectable: true,

  addOptions() {
    return {
      docIdRef: null,
      cardContext: false,
      // Stamp gate for data-uuid/kind (2d): MAIN document surface only.
      surface: "float" as "main" | "float",
      figureFloat: false,
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
      // Opaque raw `\caption[<short>]` list-of-figures argument, preserved for a
      // byte-exact round-trip (task 263); null when the caption had no bracket.
      shortCaption: { default: null, renderHTML: () => ({}) },
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
    const surface = this.options.surface;
    return ReactNodeViewRenderer(FigureBlockNodeView, {
      contentDOMElementTag: "span",
      // 2d: NodeView-owned data-uuid/kind exposure (MAIN only; re-applied on
      // every node update, so the backfill's uuid mint lands too).
      attrs: ({ node }): Record<string, string> =>
        surface === "main" && node.attrs.uuid
          ? {
              "data-uuid": node.attrs.uuid as string,
              "data-text-object-kind": node.type.name,
            }
          : {},
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

/**
 * The seed the figure SOURCE popover opens on for a freshly-inserted block —
 * the `{ kind, raw, pos, rect }` shape EditorLayout's `activeFigure` /
 * `FigurePopover` consume. Re-exported as the typed shape `figureRun`'s
 * `ctx.openFigurePopover` callback receives.
 */
export interface FigurePopoverSeed {
  kind: "figureBlock";
  raw: string;
  pos: number;
  rect: DOMRect;
}

/**
 * Insert a fresh `figureBlock` and (after the NodeView mounts) open its source
 * popover so the user can fill in the empty `\includegraphics` path.
 *
 * CHIP 6a: this standalone helper now DELEGATES to the registry's `figureRun`
 * (the ONE figure creator — INSERT via the shared `smartInsertBlock`, DA-2, then
 * open the source popover). It builds a view-only `ActionContext` off the live
 * selection and threads `onOpenPopover` as `ctx.openFigurePopover`, so the cell
 * path (grid → `figureRun`), this helper, and any future FILE-DROP path can
 * never diverge on the creator.
 *
 * Popover-open path (the dual-use `virgil-figure-click` split) is owned by
 * `figureRun`: when `onOpenPopover` is supplied, the popover opens DIRECTLY
 * through that callback (the INSERT-time `virgil-figure-click` emit is RETIRED);
 * when absent, `figureRun` falls back to the legacy CustomEvent. The
 * EDIT-existing-figure `virgil-figure-click` listener (marker-clicks.ts) is
 * UNTOUCHED either way.
 */
export function insertFigureBlock(
  editor: Editor,
  onOpenPopover?: (seed: FigurePopoverSeed) => void,
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
  figureRun(ctx);
}
