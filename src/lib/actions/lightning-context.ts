import type { Editor } from "@tiptap/react";
import type { ActionContext } from "./action-registry";
import { surfaceEditableNow } from "@/lib/tiptap/surface-editable";

/**
 * The lightning panel's ONE `ActionContext` constructor (task 1199).
 *
 * Every lightning-grid cell asks and runs its row against the live selection,
 * on the `"lightning"` surface, with the panel's `canEdit`. That ctx used to be
 * built in three places — the grid's `gridCellCtx`, `runGridAction`, and the ¶
 * block-type dropdown's private `applyHeadingFromDropdown` — and a hand-built
 * ctx can omit a field the gates read (task 638: an absent `canEdit` disarms
 * the collab gate). The grid and the dropdown now build it here.
 *
 * `canEdit` asks the surface-editability door HERE (task 1183's census: every
 * builder derives it from `surfaceEditableNow`), so no caller can forget it.
 * `alsoRequire` lets a caller only NARROW it — the grid passes the collab
 * context's `canEditMainText`, a React-side fact this module cannot read.
 *
 * `range` overrides the live selection (the colour commit passes its stashed
 * range, task 1168). Extra fields a caller needs — a payload, a popover seam —
 * are spread over the result.
 */
export function lightningContext(
  editor: Editor,
  alsoRequire = true,
  range?: { from: number; to: number } | null,
): ActionContext {
  // A doc-less editor (a mounted-before-view test stub, task 1006) has no
  // selection to read; the gates' own "no live doc → allow" fallback answers.
  const selection = editor.state?.selection;
  return {
    editor,
    view: editor.view,
    ref: {
      kind: "selection",
      from: range?.from ?? selection?.from ?? 0,
      to: range?.to ?? selection?.to ?? 0,
      paragraphId: "",
    },
    surface: "lightning",
    canEdit: surfaceEditableNow(editor) && alsoRequire,
  } as ActionContext;
}
