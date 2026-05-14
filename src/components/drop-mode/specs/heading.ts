/**
 * Drop spec for popped-out headings (`heading:${uuid}`).
 *
 * A heading float ports both the heading itself AND all the blocks
 * that follow it until the next heading of equal-or-higher rank.
 * On drop, we move the whole section as a unit: delete the source
 * range, insert all collected nodes at the destination.
 *
 * Cross-editor section moves aren't supported in v1 — sections are a
 * top-level main-doc concept. `targetScope: "any-editor"` is still
 * declared because we don't want the indicator to vanish in card
 * bodies; instead, on drop we no-op cross-editor cases.
 */

import { Node as PMNode } from "@tiptap/pm/model";
import { TextSelection } from "@tiptap/pm/state";
import { getSectionRangeByUuid } from "@/lib/section-range";
import type { DropSpec } from "../types";

export const headingDropSpec: DropSpec = {
  allowedPlacements: ["between-blocks"],
  targetScope: "any-editor",
  classifyDrop(placement, cardKey) {
    if (placement.kind !== "between-blocks") return { kind: "no-op" };
    const src = locateSection(placement.editor, cardKey);
    if (!src) return { kind: "no-op" };
    if (
      placement.insertPos >= src.from &&
      placement.insertPos <= src.to
    ) {
      return { kind: "no-op" };
    }
    return { kind: "apply" };
  },
  applyDrop(placement, cardKey) {
    if (placement.kind !== "between-blocks") return;
    const src = locateSection(placement.editor, cardKey);
    if (!src) return;
    const { editor, from, to, nodes } = src;
    const insertPos = placement.insertPos;
    // Compute insertion offset after the deletion. If the destination is
    // after the source, every node in the section deleted from before it
    // shifts the destination left by the section's total length.
    const sectionSize = to - from;
    const adjustedInsert = insertPos > to ? insertPos - sectionSize : insertPos;
    const tr = editor.state.tr.delete(from, to);
    let cursor = adjustedInsert;
    for (const n of nodes) {
      tr.insert(cursor, n);
      cursor += n.nodeSize;
    }
    // Select the moved section so the user sees where it landed.
    const selStart = adjustedInsert + 1;
    const selEnd = cursor - 1;
    if (selEnd > selStart) {
      tr.setSelection(
        TextSelection.between(tr.doc.resolve(selStart), tr.doc.resolve(selEnd)),
      );
    }
    editor.view.dispatch(tr);
    editor.view.focus();
  },
  postDrop: "close",
};

interface SectionInfo {
  editor: import("@tiptap/react").Editor;
  from: number;
  to: number;
  nodes: PMNode[];
}

function locateSection(
  editor: import("@tiptap/react").Editor,
  cardKey: string,
): SectionInfo | null {
  const sep = cardKey.indexOf(":");
  if (sep <= 0) return null;
  const uuid = cardKey.slice(sep + 1);
  const range = getSectionRangeByUuid(editor.state.doc, uuid);
  if (!range) return null;
  return { editor, from: range.start, to: range.end, nodes: range.nodes };
}
