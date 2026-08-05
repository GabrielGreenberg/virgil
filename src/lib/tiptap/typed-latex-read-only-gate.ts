import type { EditorView } from "@tiptap/pm/view";

/**
 * CHIP 7b — the SINGLE collab read-only gate for the typed-LaTeX `handleTextInput`
 * surfaces (inline/display `$…$` math, `\cite{}`, `\footnote{}`, `% ` comment).
 *
 * Each of those raw PM input rules mutates the doc SYNCHRONOUSLY (`view.dispatch`)
 * from inside `handleTextInput`, *before* any registry `run()`. When the collab
 * partner holds the pen, `EditorLayout` calls `editorInstance.setEditable(false)`,
 * so PM already suppresses `handleTextInput` on the non-editable view in the
 * steady state. But that gate lived as an inline `!view.editable` check on only
 * two of the four surfaces (citation/footnote), so a caret-frame where
 * `canEditMainText` has flipped false a render tick BEFORE the `setEditable`
 * effect re-runs could still perform an unguarded synchronous insert on
 * math / `% `.
 *
 * This is the one SSOT: every typed-LaTeX closure calls it as its FIRST statement,
 * so the "uniform collab read-only gate" is structurally uniform — it cannot
 * re-drift onto a subset of surfaces. Pinned by
 * `__tests__/typed-latex-collab-gate.test.ts`.
 *
 * @returns `true` when the typed insert must be REFUSED (read-only view) — call
 *   sites do `if (refuseTypedInsertWhenReadOnly(view)) return false;`.
 */
export function refuseTypedInsertWhenReadOnly(view: EditorView): boolean {
  return !view.editable;
}
