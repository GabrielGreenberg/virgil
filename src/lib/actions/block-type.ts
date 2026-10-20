import type { Editor } from "@tiptap/react";
import {
  headingLevelVerdict,
  readOnlyRefusal,
} from "./action-registry";
import { lightningContext } from "./lightning-context";
import { refusalPhrase } from "./refusal";
import { headingLevelOptions } from "@/lib/document-class";

// The ¶ block-type menu's VERDICTS (task 1199) — what its rows and its grid
// cell offer. Its COMMIT is `pickBlockType` (MenuBar.tsx); both ask the same
// `headingLevelVerdict` the registry's heading rows answer, so an offered row
// is a row the commit will run.

/** The dropdown's rows: "Body text", then every heading level DERIVED from
 *  `headingLevelOptions` — the vocabulary × the document class, the same rows
 *  the heading lozenge's `HeadingTypeMenu` maps (task 752). This used to be a
 *  hand-listed 0..6 that never learned the class table, so it offered a live
 *  `\chapter` in an `article` the lozenge greyed out. A class-unsupported
 *  level stays VISIBLE (greyed, arrow-skipped, inert) exactly as there.
 *
 *  Task 1199: a row ALSO greys on the registry's heading verdict
 *  (`headingLevelVerdict` — surface schema, read-only, container, list item),
 *  with its reason. Before, only the class could grey a row, so in a footnote
 *  body or a list item every heading row was lit and did nothing. The class
 *  refusal is asked first: it holds wherever the caret goes. */
export interface BlockTypeOption {
  value: string;
  label: string;
  disabled: boolean;
  hint?: string;
}
export const BODY_TEXT_VALUE = "p";

export function blockTypeOptions(
  editor: Editor,
  documentClass: string | null | undefined,
): BlockTypeOption[] {
  const ctx = lightningContext(editor);
  return [
    { value: BODY_TEXT_VALUE, label: "Body text", disabled: false },
    ...headingLevelOptions(documentClass).map((o) => {
      if (o.disabled)
        return { value: String(o.level), label: o.menuLabel, disabled: true, hint: o.hint };
      const v = headingLevelVerdict(ctx, o.level);
      return v.state === "disabled"
        ? { value: String(o.level), label: o.menuLabel, disabled: true, hint: v.reason ?? undefined }
        : { value: String(o.level), label: o.menuLabel, disabled: false };
    }),
  ];
}

/**
 * The ¶ CELL's verdict (task 1199): greyed when picking any row would do
 * nothing — the surface is read-only, or no heading row applies AND "Body
 * text" has no heading to demote. A footnote body (no heading in its schema)
 * or a list-item caret greys ¶ itself with the heading rows' reason instead of
 * opening a menu of dead rows. `canEdit` is the host panel's (the grid's own
 * surface verdict, task 1017). Gesture-rate (grid render), O(selection).
 */
export function blockTypeVerdict(
  editor: Editor,
  documentClass: string | null | undefined,
  canEdit: boolean,
): { disabled: boolean; reason: string | null } {
  if (!canEdit) return { disabled: true, reason: refusalPhrase(readOnlyRefusal(editor)) };
  if (selectionHoldsHeading(editor)) return { disabled: false, reason: null };
  const ctx = lightningContext(editor, canEdit);
  let reason: string | null = null;
  for (const o of headingLevelOptions(documentClass)) {
    if (o.disabled) continue;
    const v = headingLevelVerdict(ctx, o.level);
    if (v.state !== "disabled") return { disabled: false, reason: null };
    reason ??= v.reason;
  }
  return { disabled: true, reason };
}

/** Whether any heading lies in the current selection (the mixed-range test
 *  behind the ¶ dropdown's checkmark — task 1003). Read via `editor.view.state`
 *  and asked only when the doc can answer (a live ProseMirror doc) — the same
 *  "no live doc → no verdict" fallback the registry gates take, so a
 *  doc-less editor renders the dropdown instead of throwing (task 1006). */
export function selectionHoldsHeading(editor: Editor): boolean {
  const state = editor.view?.state;
  const doc = state?.doc as typeof state.doc | undefined;
  if (!state || !doc || typeof doc.nodesBetween !== "function") return false;
  const { from, to } = state.selection;
  let found = false;
  doc.nodesBetween(from, to, (node) => {
    if (found) return false;
    if (node.type.name === "heading") found = true;
    return !node.isTextblock;
  });
  return found;
}

