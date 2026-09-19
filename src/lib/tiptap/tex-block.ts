import { Node, mergeAttributes, ReactNodeViewRenderer } from "@tiptap/react";
import type { Editor } from "@tiptap/react";
import type { RefObject } from "react";
import { generateShortId } from "@/lib/uuid";
import TexBlockNodeView from "@/components/TexBlockNodeView";
import { UUID_ATTR_SPEC } from "./uuid-attr";
import { sourcePodStaticBody } from "./source-pod-static";
// CHIP 5b: the SINGLE canonical raw-LaTeX-block creator lives in the action
// registry (`texRun` → seed `code` from the selection, mint a collision-free
// uuid, insert the `texBlock`), reached by the slash `\tex` command and by the
// lightning grid's `\tex` cell alike, so the two surfaces can never diverge.
//
// Task 638 deleted this module's `insertTexBlock`, the grid's private door into
// `texRun`. It built its OWN `ActionContext` — the one grid cell not routed
// through `ActionsMenuPanel`'s `runGridAction` — and omitted `canEdit`, which
// `isCollabReadOnly` reads as "not read-only" (the no-over-gating rule), so
// `texRun`'s collab gate silently no-opped while its container gate survived.
// The grid now takes the same door as every other cell; a second ctx-builder is
// what let the two answers drift, so there is one.

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

  renderHTML({ HTMLAttributes, node }) {
    // The code rides the markup as a TEXT child, not only as an attribute —
    // see `sourcePodStaticBody`. Without it the T1 static card tier and the
    // clipboard both project this node to an empty div (task 388).
    return [
      "div",
      mergeAttributes(HTMLAttributes, { "data-type": "tex-block" }),
      sourcePodStaticBody((node.attrs.code as string) || ""),
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

