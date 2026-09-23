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

import { owningEditor } from "@/lib/tiptap/owning-editor";

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

/**
 * ## The EDITOR-level door (task 733)
 *
 * `surfaceIsEditable` above needs the `editableRef` handed to it, which only a
 * surface that was BUILT with it can do — the two plugin readers get it as an
 * extension option. Every OTHER affordance holds an `Editor` (a React menu, a
 * dispatcher) or a bare `EditorView` (a PM plugin) and nothing else, so each
 * one spelled the question itself as `editor.isEditable` / `!view.editable` —
 * which is the lie this module's header names, and on MAIN a CONSTANT.
 *
 * The remedy is not a prop drilled through every menu: the answer is a fact
 * about the editor, so the editor PUBLISHES it. `readOnlyEnforcer` (main-only,
 * `editor-extensions.ts`) already closes over the ref it enforces on and now
 * exposes it as its extension STORAGE; a view reaches its editor through
 * `owningEditor` (task 642's back-pointer). A surface with no enforcer — a card
 * body, a float, a raw PM harness — publishes nothing, resolves `null`, and is
 * answered by `view.editable` alone, which is honest there. So the conversion
 * is a no-op everywhere except the surface that was lying.
 *
 * NOT the sidecar axis: what a Library Reader may WRITE to disk is
 * `writableSidecarsFor` / `isSidecarWriteAllowed` / `isCardMutationAllowed`
 * (`chrome-config.ts`). This answers only "may this surface's DOCUMENT be
 * mutated right now", the union of the pen (`view.editable`) and the host
 * (`editableRef`).
 */

/** The storage slot `readOnlyEnforcer` publishes its ref under. */
export const SURFACE_EDITABLE_STORAGE_KEY = "readOnlyEnforcer";

/** What that slot holds. Exported so the extension and the readers agree. */
export interface SurfaceEditableStorage {
  editableRef: RefObject<boolean> | null;
}

/** The shape this door needs of a TipTap `Editor`: its view and its extension
 *  storage. Structural, not an `Editor` import, so this module stays free of
 *  the React/TipTap barrel (the vitest barrel-storage gotcha) and a plain PM
 *  host can still be asked. `storage` is `object` because TipTap types it as an
 *  empty declaration-merged interface, which has no index signature. */
type EditorLike = { view: EditorView; storage: object };

function refFrom(editor: EditorLike | null): RefObject<boolean> | null {
  const slot = (editor?.storage as Record<string, unknown> | undefined)?.[
    SURFACE_EDITABLE_STORAGE_KEY
  ] as Partial<SurfaceEditableStorage> | undefined;
  return slot?.editableRef ?? null;
}

/**
 * May the user edit THIS surface right now — asked from whatever the caller
 * happens to hold: a TipTap `Editor`, a bare `EditorView`, or `null`.
 *
 * `null` answers `true`: "no surface" is not "read-only surface", and the
 * no-over-gating default this app applies to `ActionContext.canEdit` (an absent
 * answer never gates) must not invert here.
 *
 * [cost: O(1) — a DOM property read and two booleans.]
 */
export function surfaceEditableNow(
  target: EditorLike | EditorView | null | undefined,
): boolean {
  if (!target) return true;
  // A bare view: its owner carries the storage. `owningEditor` returns `null`
  // for a view TipTap did not create, which lands on `view.editable` alone.
  return "view" in target
    ? answer(target.view, refFrom(target))
    : answer(target, refFrom(owningEditor(target)));
}

/**
 * The SSOT read, with ONE tolerance: a view that does not MODEL `editable` at
 * all — a hand-built harness view, a foreign embed — is not thereby a read-only
 * view. `surfaceIsEditable` would read `undefined` and answer `false`, turning
 * "this caller handed me something that cannot answer" into "refuse", which
 * inverts the no-over-gating default every other absent answer in this app
 * takes (`ActionContext.canEdit`'s JSDoc states it: absent ⇒ editable). Every
 * real ProseMirror view sets the flag, so this branch is unreachable in the
 * app and the SSOT answers each production call.
 */
function answer(view: EditorView, ref: RefObject<boolean> | null): boolean {
  if (typeof (view as { editable?: unknown })?.editable !== "boolean") {
    return ref ? !!ref.current : true;
  }
  return surfaceIsEditable(view, ref);
}
