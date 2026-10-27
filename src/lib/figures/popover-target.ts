// ---------------------------------------------------------------------------
// The figure SOURCE popover's identity + commit (task 1082)
//
// The figure/graphics popover is the third atom popover on task 1071's door
// (`src/lib/tiptap/atom-edit-target.ts`), and the last that still committed to
// "whatever node of the right type now sits at `pos`". The popover outlives the
// click — the owner can re-seed (the figure float re-syncs from MAIN) or an
// agent/cowork apply can land — so by save time `pos` may hold a NEIGHBOUR. And
// the save fell through kinds: a figure body that found a graphicsBlock at
// `pos` was stored as that graphic's `command`, and a graphic's
// `\includegraphics` saved onto a figure wiped its caption and label.
//
// So the popover names what was CLICKED: its kind, its block `uuid` (minted at
// insert / backfilled, pinned to MAIN's on the float — and figure/graphics
// uuids are minted from separate namespaces, so kind + uuid is the identity),
// and, for a node not yet carrying a uuid, the seed `raw` — compared against
// `figurePopoverRaw(node)`, the ONE seed builder every opening path uses. The
// commit resolves through `resolveAtomEditTarget` and runs ONLY the clicked
// kind's door; anything else refuses.
// ---------------------------------------------------------------------------

import type { Editor, JSONContent } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";

import { serializeFigureEnvBody } from "@/lib/latex-serializer";
import { resolveAtomEditTarget } from "@/lib/tiptap/atom-edit-target";
import type { TrackedPos } from "@/lib/tiptap/tracked-pos";
import {
  applyFigureEnvBodyEdit,
  applyGraphicsCommandEdit,
} from "@/lib/figures/apply-env-body";

/** The two node kinds the figure source popover edits. */
export type FigurePopoverKind = "figureBlock" | "graphicsBlock";

export function isFigurePopoverKind(kind: unknown): kind is FigurePopoverKind {
  return kind === "figureBlock" || kind === "graphicsBlock";
}

/** What the popover remembers of the node it was opened on. */
export interface ClickedFigure {
  kind: FigurePopoverKind;
  /** The block's `uuid`, or null when the node carried none at click time. */
  uuid: string | null;
  /** The seed the popover opened on (`figurePopoverRaw(node)`). */
  raw: string;
}

/** The open figure/graphics popover's session (task 1314): the clicked
 *  identity, its OWNING editor (main or the figure's float — EX-F4-02) and its
 *  position there as a tracker — no raw `pos`. Whoever drops it disposes `at`. */
export interface ActiveFigure extends ClickedFigure {
  at: TrackedPos;
  rect: DOMRect;
  editor: Editor;
}

/** The tex-mode popover seed for a figure/graphics node — the faithful env body
 *  (figureBlock: exactly the bytes the serializer writes) or the verbatim
 *  `\includegraphics` command (graphicsBlock). Shared by EVERY opening path
 *  (the page view, the float view, and the insert-time seed), so the popover
 *  opens on identical raw and the identity fallback below compares like with
 *  like.
 *
 *  Tasks 318/319/1080: the body is the SERIALIZER'S OWN — the same
 *  `serializeFigureEnvBody` the `figureBlock` emitter calls. Each earlier,
 *  more-local seed lost something a save then deleted: a synthesizer that
 *  emitted no `[short]` LoF bracket (task 263's), and then a shared builder fed
 *  the caption's `textContent`, which is "" for every citation, math, footnote
 *  and ref atom and bare text for every mark (task 1080). `NodeEditPopover.commit`
 *  dispatches only when the text differs, so a literally untouched save is
 *  safe; a caption-less figure shows no `\caption` line, which the user can add
 *  or remove here as a first-class edit. */
export function figurePopoverRaw(node: PMNode): string {
  if (node.type.name !== "figureBlock") {
    return (node.attrs.command as string | undefined) || "";
  }
  return serializeFigureEnvBody(node.toJSON() as JSONContent);
}

/** The popover's identity predicate: the clicked KIND, and the clicked `uuid`
 *  when it had one, else the clicked seed. A same-kind neighbour slid onto
 *  `pos` has another uuid (or another body) and is refused; so is a
 *  figure↔graphics swap.
 *
 *  [cost: O(1) with a uuid; O(node) — one figure serialize — without.] */
export function isClickedFigure(clicked: ClickedFigure): (node: PMNode) => boolean {
  return (node) => {
    if (node.type.name !== clicked.kind) return false;
    if (clicked.uuid) return node.attrs.uuid === clicked.uuid;
    return figurePopoverRaw(node) === clicked.raw;
  };
}

/** The figure popover's COMMIT: write `newText` into the clicked node in its
 *  OWNING editor (main or the figure's float — EX-F4-02) through the clicked
 *  kind's door ONLY, refusing unless task 1071's door resolves the clicked node
 *  (owner editable now, `pos` in range, identity matches). Returns whether it
 *  wrote.
 *
 *  [cost: O(log doc) + the identity check + one transaction.] */
export function applyFigurePopoverEdit(
  owner: Editor | null | undefined,
  at: TrackedPos,
  clicked: ClickedFigure,
  newText: string,
): boolean {
  const target = resolveAtomEditTarget(owner, at, isClickedFigure(clicked));
  if (!target) return false;
  const { pos } = target;
  return clicked.kind === "figureBlock"
    ? applyFigureEnvBodyEdit(owner!, pos, newText)
    : applyGraphicsCommandEdit(owner!, pos, newText);
}
