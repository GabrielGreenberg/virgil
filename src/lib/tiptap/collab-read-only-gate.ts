import type { EditorView } from "@tiptap/pm/view";

/**
 * CHIP 7b — THE collab read-only gate. One question, one door:
 *
 *   > May this editor be MUTATED right now, or does the collab partner hold
 *   > the pen?
 *
 * ## Where the answer comes from
 *
 * `EditorLayout` flips `editorInstance.setEditable(collab.canEditMainText)`
 * whenever the pen changes hands, so `view.editable` / `editor.isEditable` IS
 * the in-editor mirror of the pen — for MAIN and for every card body / float,
 * each of which owns its own `setEditable`. That mirror is the authoritative
 * signal the `ActionContext.canEdit` JSDoc names, and it is LIVE: unlike a
 * React value captured when a menu was built, it is re-read at the moment of
 * the mutation.
 *
 * ## Why the door exists (task 638)
 *
 * The registry's sixteen `run()` bodies open with `isCollabReadOnly(ctx)` and
 * the file called that the "uniform collab gate". It was not uniform: three of
 * the live invocation paths never enter `run()` at all —
 *
 *   1. both MENU surfaces dispatch card rows through the legacy
 *      `useDragHandleActions().dispatch`, not through `spec.run()`;
 *   2. the DEFERRED create-popover commits (`\ref`, `\cite`) land their atom
 *      many seconds after the gated `run()` that opened the popover;
 *   3. a ctx built without `canEdit` reads as "not read-only" (the
 *      no-over-gating rule), so one missing field silently disarms the gate.
 *
 * — and on those paths the only thing standing between a read-only
 * collaborator and a mutation was a `disabled` flag computed once at menu-build
 * time. `readOnlyEnforcer` is not the backstop: it rejects doc-changing PM
 * transactions, and a card registration is React state plus a SIDECAR write,
 * which never passes through PM.
 *
 * So the gate is asked HERE, at the deepest seam each path must cross — the
 * same remedy task 396 applied to the CONTAINER question, whose gate lives
 * inside `insertInlineAtom` on the stated ground that it is "the DEEPEST point,
 * and the only one the deferred commit passes through". Keeping the `run()`-side
 * gates is belt-and-suspenders; the point is that they are no longer the ONLY
 * gate.
 *
 * ## What this is NOT
 *
 * NOT the HOST-WRITABILITY question. A Library Reader pane mounts MAIN with the
 * React `editable` prop false while PM's `view.editable` stays true on purpose
 * (`Editor.tsx` — `contenteditable="false"` broke selection routing), and it
 * DELIBERATELY still lets the user write note cards
 * (`READER_CHROME.editableCardKinds`). That axis has its own SSOT —
 * `writableSidecarsFor` / `isSidecarWriteAllowed` / `isCardMutationAllowed`
 * (`chrome-config.ts`) — and `surfaceIsEditable` (`surface-editable.ts`) is the
 * conjunction the AFFORDANCES ask. Asking THIS door about that question would
 * over-gate the Reader's one editable feature; asking that one about the pen
 * would under-gate every non-Reader surface. Two axes, two doors.
 *
 * No over-gating: a non-collab document is always editable, so every call here
 * answers `false` outside collaborator read-only.
 *
 * @returns `true` when the mutation must be REFUSED. Call sites read as
 *   `if (collabReadOnly(view)) return false;`.
 */
export function collabReadOnly(target: EditorView | { view: EditorView }): boolean {
  // `Editor` (TipTap) carries `.view`; an `EditorView` is its own target. A
  // structural check rather than an `Editor` import keeps this module free of
  // the React/TipTap barrel (`vitest-extension-barrel-storage-mock` gotcha) and
  // lets a plain PM host call it.
  const view = "view" in target ? target.view : target;
  return !view.editable;
}
