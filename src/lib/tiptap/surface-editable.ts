/**
 * SURFACE EDITABILITY — the ONE door for "may the user edit this surface right
 * now?", asked by every editor-derived AFFORDANCE (task 579).
 *
 * The question has two spellings in this app and they disagree by design:
 *
 *   - a float / card body is read-only exactly when `view.editable` is false
 *     (`setEditable` — collab, the example floats, `RichTextField`);
 *   - MAIN pins `view.editable = true` for its whole life (`Editor.tsx` —
 *     PM's own `contenteditable="false"` broke selection routing in the
 *     Reader) and carries the user-facing answer in `editableRef`, which the
 *     `readOnlyEnforcer` reads to refuse doc-changing transactions.
 *
 * So `view.editable` ALONE is a lie on MAIN whenever the host mounted it
 * read-only — the Library Reader above all — and an affordance that asks it
 * offers an edit the enforcer then silently drops. Task 524 found this for the
 * atom grab and wrote the conjunction privately; task 579 found it again for
 * the spellchecker, which squiggled every paper opened in the Reader and
 * offered spelling corrections that did nothing. Two private copies of one
 * question is how the second one came to be missing, so the question lives
 * here and both read it.
 *
 * ## Two triggers, one predicate
 *
 * A `view.editable` flip reaches PM (`setEditable` → `updateState`), so every
 * plugin view's `update()` re-asks on its own. An `editableRef` flip does NOT:
 * it is a React ref that changes on re-render with no transaction behind it.
 * `announceSurfaceEditability` is that flip's witness — a meta-only,
 * history-free transaction whose only purpose is to run every plugin view's
 * `update()` against the new answer. The ONE caller is `Editor.tsx`'s
 * `editable` effect (censused).
 */

import type { EditorView } from "@tiptap/pm/view";
import type { RefObject } from "react";

/**
 * True when the user may edit this surface. `editableRef` is MAIN's mirror of
 * the React `editable` prop; surfaces without one (card bodies, floats) pass
 * `null` and are answered by `view.editable` alone, which is honest there.
 *
 * [cost: O(1) — two boolean reads.]
 */
export const surfaceIsEditable = (
  view: EditorView,
  editableRef: RefObject<boolean> | null,
): boolean => view.editable && (editableRef ? !!editableRef.current : true);

/** The meta key the announcement carries. Read by nobody: the transaction's
 *  whole effect is to run the plugin views' `update()`. */
export const SURFACE_EDITABILITY_META = "virgilSurfaceEditability";

/**
 * Tell every plugin view that `editableRef` may have flipped. Meta-only, so it
 * changes no document, arms no autosave, enters no history, and passes the
 * `readOnlyEnforcer` (which refuses only doc-changing transactions).
 */
export function announceSurfaceEditability(view: EditorView): void {
  if ((view as { isDestroyed?: boolean }).isDestroyed) return;
  const tr = view.state.tr
    .setMeta(SURFACE_EDITABILITY_META, true)
    .setMeta("addToHistory", false);
  view.dispatch(tr);
}
