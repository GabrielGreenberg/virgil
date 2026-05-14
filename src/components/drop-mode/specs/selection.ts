/**
 * Drop spec for popped-out selection floats (`selection:${id}`).
 *
 * A selection float captures a text range from the main editor. The
 * range is tracked live via the float's own transaction handler and
 * persisted into the selection-floats registry, so this spec can read
 * the current (re-mapped) range without holding a React ref.
 *
 * Placement priority: inline-cursor first, between-blocks fallback.
 * When the cursor is over text, the slice merges into that line; when
 * it's in a gap between blocks, the slice's top-level structure
 * (paragraphs) lands as new blocks. ProseMirror's `tr.replace` does
 * the merging math for both cases using the slice's open depths.
 *
 * postDrop: close — the user "put the selection back," so the float
 * is no longer needed.
 *
 * V1 scope: same-editor moves only (main editor). Cross-editor moves
 * are silently no-op'd; selection floats today only originate from
 * the main editor anyway.
 */

import { TextSelection } from "@tiptap/pm/state";
import { getSelectionFloatData } from "@/components/selection-floats";
import type { DropSpec } from "../types";

export const selectionDropSpec: DropSpec = {
  allowedPlacements: ["inline-cursor", "between-blocks"],
  targetScope: "any-editor",
  classifyDrop(placement, cardKey, ctx) {
    if (placement.kind !== "inline-cursor" && placement.kind !== "between-blocks") {
      return { kind: "no-op" };
    }
    const id = extractId(cardKey);
    if (!id) return { kind: "no-op" };
    const data = getSelectionFloatData(id);
    if (!data) return { kind: "no-op" };
    const mainEditor = ctx.mainEditor;
    if (!mainEditor) return { kind: "no-op" };
    if (placement.editor !== mainEditor) return { kind: "no-op" };
    const { from, to } = data.range;
    if (to <= from) return { kind: "no-op" };
    const docSize = mainEditor.state.doc.content.size;
    if (from < 0 || to > docSize) return { kind: "no-op" };
    // No-op if the drop lands inside the source range.
    const target =
      placement.kind === "inline-cursor" ? placement.pos : placement.insertPos;
    if (target >= from && target <= to) return { kind: "no-op" };
    return { kind: "apply" };
  },
  applyDrop(placement, cardKey, ctx) {
    const id = extractId(cardKey);
    if (!id) return;
    const data = getSelectionFloatData(id);
    if (!data) return;
    const mainEditor = ctx.mainEditor;
    if (!mainEditor || placement.editor !== mainEditor) return;
    const { from, to } = data.range;
    if (to <= from) return;
    const target =
      placement.kind === "inline-cursor"
        ? placement.pos
        : placement.kind === "between-blocks"
          ? placement.insertPos
          : -1;
    if (target < 0) return;
    const slice = mainEditor.state.doc.slice(from, to);
    const tr = mainEditor.state.tr.delete(from, to);
    const mappedTarget = tr.mapping.map(target);
    const beforeSize = tr.doc.content.size;
    tr.replace(mappedTarget, mappedTarget, slice);
    const insertedSize = tr.doc.content.size - beforeSize;
    // Select the inserted slice so the user sees what just moved.
    if (insertedSize > 0) {
      const $start = tr.doc.resolve(mappedTarget);
      const $end = tr.doc.resolve(mappedTarget + insertedSize);
      tr.setSelection(TextSelection.between($start, $end));
    }
    mainEditor.view.dispatch(tr);
    mainEditor.view.focus();
  },
  postDrop: "close",
};

function extractId(cardKey: string): string | null {
  const sep = cardKey.indexOf(":");
  return sep > 0 ? cardKey.slice(sep + 1) : null;
}
