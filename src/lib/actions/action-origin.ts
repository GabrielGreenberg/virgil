/**
 * action-origin — "which document, and which caret, does this invocation act
 * on?" One question, one owner (task 642).
 *
 * # The split this module exists to keep
 *
 * The PM→React bridge's handle carries two different kinds of thing:
 *
 *   - **app-global React APIs** — `cardCreation`, panel routing, the create-
 *     popover seams. These belong to whichever `EditorPane` is mounted; any
 *     live one will do.
 *   - **the ORIGIN of the gesture** — which document, which caret, which
 *     containing block. This is per-DOCUMENT, and the per-doc-services law
 *     says a per-document value resolves by OWNER, never by "whichever is
 *     active".
 *
 * `getEditorActionsHandleFor(view)` keys only the PANES, so a typed
 * `\cite{}` fired inside a nested editor — a card body, a float, an excerpt —
 * misses the exact lookup and lands on the ACTIVE pane's handle. Falling back
 * for the first kind is right and deliberate. Falling back for the second was
 * the bug: the handle read its OWN `selection.head`, so a citation typed in a
 * note's body was anchored against MAIN's caret, and a main caret parked in a
 * `codeBlock` could suppress the card entirely through the applicability gate.
 *
 * So the bridge derives every document-local field from the ORIGIN view, here,
 * once — and the test that pins the bridge's context-building imports THIS
 * rather than re-deriving it, so the two cannot drift.
 */

import type { Editor } from "@tiptap/core";
import type { EditorView } from "@tiptap/pm/view";
import { paragraphUuidAt } from "@/links/links";
import { owningEditor } from "@/lib/tiptap/owning-editor";
import type { CursorRef } from "./action-registry";

/** The document-local half of an `ActionContext`, resolved from the origin. */
export interface ResolvedActionOrigin {
  /** The view the gesture fired in. */
  view: EditorView;
  /** Its owning TipTap editor, or the pane's when the view is a raw
   *  ProseMirror one (test harnesses / foreign embeds have no owner). */
  editor: Editor;
  /** The collapsed-caret ref the slash / typed surfaces act on. */
  ref: CursorRef;
}

/**
 * Resolve the document-local half of an action invocation.
 *
 * @param paneEditor The editor of the pane whose handle was reached — the
 *                   source of the app-global React APIs, and the fallback for
 *                   a view-less (legacy) invocation.
 * @param origin     The live view the gesture fired in, when the caller had
 *                   one. Every ProseMirror-land caller does; it is absent only
 *                   for a legacy view-less publish, where the pane's own view
 *                   IS the origin and this is inert.
 *
 * NOTE the asymmetry in the fallback: when `origin` names a view TipTap did not
 * create, we substitute the pane's `Editor` for the `editor` field ONLY. The
 * positions still come from `origin.state`, because that is always the right
 * document and is the whole point of carrying the origin at all.
 */
export function resolveActionOrigin(
  paneEditor: Editor,
  origin?: EditorView | null,
): ResolvedActionOrigin {
  const view = origin ?? paneEditor.view;
  const editor = owningEditor(view) ?? paneEditor;
  // `paragraphUuidAt` walks ancestors up from the caret for the containing
  // block's uuid (the Mode-A anchor); "" when the caret is not inside an
  // anchorable block — which is the normal answer inside a card body, whose
  // paragraphs carry no document uuid.
  const pos = view.state.selection.head;
  return {
    view,
    editor,
    ref: {
      kind: "cursor",
      pos,
      paragraphId: paragraphUuidAt(view.state.doc, pos) ?? "",
    },
  };
}
