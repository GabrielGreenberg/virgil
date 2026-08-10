import { Node, mergeAttributes, ReactNodeViewRenderer } from "@tiptap/react";
import type { Editor } from "@tiptap/react";
import type { RefObject } from "react";
import { generateShortId } from "@/lib/uuid";
import TexBlockNodeView from "@/components/TexBlockNodeView";
import { UUID_ATTR_SPEC } from "./uuid-attr";
// CHIP 5b: the SINGLE canonical raw-LaTeX-block creator lives in the action
// registry (`texRun` → seed `code` from the selection, mint a collision-free
// uuid, insert the `texBlock`). The lightning grid `\tex` cell (via
// `insertTexBlock` below) AND the slash `\tex` command both call THIS one
// implementation, so the two surfaces can never diverge — the former dual
// creators (grid here + slash in commands.ts) collapsed to one. `texRun` is
// pure ProseMirror (operates on `ctx.view`), so no bridge is needed.
import {
  texRun,
  type ActionContext,
} from "@/lib/actions/action-registry";

// Options injected from Editor.tsx via `TexBlock.configure({…})` so the
// NodeView can read the popped-out state. Lift + click-to-menu live in
// the editor-mounted TextObjectGrabHandle
// (src/text-objects/TextObjectGrabHandle.tsx); they are no longer per-
// NodeView concerns. The NodeView keeps `isPoppedRef` so the in-doc
// rendering can dim while the popout is open.
//
// `isPoppedRef`'s double-ref shape mirrors the ExampleBlock convention:
// the outer ref tracks the (sometimes-changing) inner ref's identity,
// the inner ref holds the live predicate.
export interface TexBlockOptions {
  /** Stamp gate for the NodeView data-uuid/kind exposure (2d): only the
   *  MAIN document surface carries the attributes (decorator parity). */
  surface: "main" | "float";
  isPoppedRef: RefObject<RefObject<(uuid: string) => boolean> | undefined> | null;
  // When true, the NodeView renders a compact static preview (no
  // CodeMirror, no edit/delete chrome). Set by every card-bearing
  // rich-text surface (RichTextField + HeadingFloat) so block atoms
  // round-trip through archive / note / cut / heading-float bodies
  // without TipTap silently dropping them as unknown nodes.
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
  // PM would otherwise create a NodeSelection on mousedown that scrolls the
  // row before CodeMirror gets focus. Matching footnote.ts rationale.
  selectable: false,

  addOptions() {
    return {
      isPoppedRef: null,
      cardContext: false,
      // Stamp gate for data-uuid/kind (2d): MAIN document surface only.
      surface: "float" as "main" | "float",
    };
  },

  addAttributes() {
    return {
      code: { default: "" },
      uuid: UUID_ATTR_SPEC.uuid,
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
    const surface = this.options.surface;
    // 2d: NodeView-owned data-uuid/kind exposure on the renderer's outer
    // element (MAIN only). TipTap re-applies a function-form `attrs` on every
    // node update, so the backfill's uuid mint lands too.
    return ReactNodeViewRenderer(TexBlockNodeView, {
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

/**
 * Insert a raw-LaTeX `texBlock` from the lightning grid `\tex` cell.
 *
 * CHIP 5b: this is now a THIN delegation to the canonical `texRun` in the action
 * registry — the SAME implementation the slash `\tex` command calls — so the two
 * surfaces share ONE creator (seed `code` from the selection, mint a
 * collision-free uuid, insert the block). The grid previously hand-rolled the
 * seed + uuid-scan here; the slash command hand-rolled a DIFFERENT one
 * (`code:''`, selection discarded). Both are gone; `texRun` is the SSOT.
 *
 * `texRun` is pure ProseMirror (operates on `ctx.view`), so we build a minimal
 * view-only `ActionContext` from `editor.view` — `texRun` reads the live
 * selection off `ctx.view.state` and dispatches there, so the grab-handle
 * `cardCreation`/`ref` slots are intentionally absent (a pure
 * insert needs none). We keep `editor.chain().focus()` first so the editor is
 * focused before the insert (the grid cell is a toolbar button — focus may be
 * on the button, not the doc — matching the former behavior).
 */
export function insertTexBlock(editor: Editor): void {
  editor.chain().focus().run();
  const ctx: ActionContext = {
    editor,
    view: editor.view,
    // The grid cell acts on the live selection; a SelectionRef best names it,
    // but `texRun` reads `ctx.view.state.selection` directly (not the ref), so
    // the ref is informational only. Use the live selection bounds.
    ref: {
      kind: "selection",
      from: editor.state.selection.from,
      to: editor.state.selection.to,
      paragraphId: "",
    },
    surface: "lightning",
  };
  texRun(ctx);
}
