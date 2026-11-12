"use client";

import { useCallback } from "react";
import type { Editor } from "@tiptap/react";
import { labelKeyProblemText } from "@/lib/labels";
import type { LabelRenameConfirm } from "@/lib/tiptap/label-rename";
import { surfaceEditableNow } from "@/lib/tiptap/surface-editable";
import { chromeOnly } from "@/lib/view-only-chrome";
import { useLabelEditSession } from "@/hooks/useLabelEditSession";
import { iconHint } from "@/components/Hint";
import { figureDeleteLabel, requestFigureDelete } from "@/lib/figures/delete-figure";

// Blue label lozenge for figureBlock — mirrors the heading annotation in
// `src/components/Editor.tsx` (vanilla-DOM extension) but built as a React
// component since it lives inside a React NodeView. Same CSS family
// (`--heading-annotation-*` tokens), distinct selector (`.figure-annotation`)
// so we can tweak placement without dragging headings along.
interface Props {
  // `editor` / `getFigurePos` / `onConfirm*` drive the interactive (page)
  // lozenge. In `readOnly` mode — the popped-out section float, which has no
  // editor and must not mutate the source — they're omitted and every
  // affordance (rename, delete, numbered toggle) is gated off, leaving a
  // static chip that is byte-for-byte the same markup/style as the page's
  // (Issue-10). Sharing this component, rather than hand-rebuilding the chip
  // in the float, keeps the two renders from drifting again.
  editor?: Editor;
  label: string;
  numbered: boolean;
  /** Can this figure take a number AT ALL? In LaTeX a float is numbered iff it
   *  carries a `\caption`, and since task 319 Virgil stopped inventing one for
   *  a caption-less figure — so on those the `#` toggle has nothing to toggle.
   *  Default true keeps every non-figure caller (and the read-only float, which
   *  mirrors MAIN's already-resolved number) unchanged. */
  canNumber?: boolean;
  getFigurePos?: () => number | null;
  onConfirmRename?: LabelRenameConfirm | null;
  onConfirmDelete?: (() => Promise<boolean>) | null;
  readOnly?: boolean;
}

export default function FigureAnnotation({
  editor,
  label,
  numbered,
  canNumber = true,
  getFigurePos,
  onConfirmRename,
  onConfirmDelete,
  readOnly = false,
}: Props) {
  // Task 1083: ONE write gate for every lozenge verb (`#`, label edit/add,
  // ×) — the figure's twin of the heading chip's `chipMayWrite` (task 1017).
  // The `readOnlyEnforcer` would drop the write anyway, but only AFTER the
  // lozenge offered it (and, for ×, after a confirm the user answered for
  // nothing). Asked at gesture time AND again after every `await` — the pen
  // can be taken while a modal is up. O(1).
  const mayWrite = useCallback(() => !!editor && surfaceEditableNow(editor), [editor]);

  // Task 1591: the label edit is the ONE label-edit session (the heading
  // strip and the expex pods ride its vanilla adapter; this lozenge its React
  // one) — the key snapshot, the duplicate refusal, the end-once latch (task
  // 555), the rename door and the refocus after a rename all live there.
  const locate = useCallback(() => {
    const pos = getFigurePos?.();
    if (!editor || pos == null) return null;
    const node = editor.state.doc.nodeAt(pos);
    return node && node.type.name === "figureBlock" ? { pos, node } : null;
  }, [editor, getFigurePos]);
  const labelEdit = useLabelEditSession({
    editor,
    label: label || null,
    locate,
    confirm: onConfirmRename ?? null,
    mayWrite,
  });
  const { editing, draft, problem: conflict, inputRef } = labelEdit;
  const enterEdit = labelEdit.begin;

  const toggleNumbered = useCallback(() => {
    if (!editor || !getFigurePos || !mayWrite()) return;
    const pos = getFigurePos();
    if (pos == null) return;
    const figNode = editor.state.doc.nodeAt(pos);
    if (!figNode || figNode.type.name !== "figureBlock") return;
    const tr = editor.state.tr.setNodeMarkup(pos, undefined, {
      ...figNode.attrs,
      numbered: !numbered,
    });
    editor.view.dispatch(tr);
  }, [editor, numbered, getFigurePos, mayWrite]);

  // Task 1265: the lozenge's × and the empty-state chrome share ONE delete
  // door — the confirm rule, write gate and live re-read live there.
  const requestDelete = useCallback(async () => {
    if (!editor || !getFigurePos) return;
    await requestFigureDelete({
      editor,
      getPos: getFigurePos,
      typeName: "figureBlock",
      confirm: onConfirmDelete,
    });
  }, [editor, getFigurePos, onConfirmDelete]);

  // Suppress PM focus-steal: mousedown on the lozenge shouldn't plant a caret.
  // On a real `<button>` this ALSO stops a pointer press from moving DOM focus
  // onto the button — which is the same intent (the caret stays where the
  // user left it) — while keyboard focus, which arrives by Tab and not by
  // mousedown, is untouched.
  const onMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  // Every affordance is a REAL `<button type="button">` (task 536): a control
  // that announces itself operable must be focusable in DOM order and must
  // activate on Enter AND Space, and a native button supplies all three —
  // plus `disabled` semantics and the design system's `.focus-ring` — for
  // free. Pre-536 these were `<span onClick>`s, two of them wearing a
  // `role="button"` (the `#` with an `aria-pressed` a keyboard user could not
  // flip) with no `tabIndex` and no key handler: announced as buttons,
  // operable by mouse only. A native button is also what keeps a keystroke on
  // the lozenge OUT of the document: TipTap's default NodeView `stopEvent`
  // answers true for a BUTTON target, so ProseMirror never sees the Enter,
  // where a `tabIndex`ed span would have handed it to the Enter keymap (a
  // paragraph split at the caret). In `readOnly` mode the chip is static:
  // no button, no role, no focus (Issue-10's contract).
  const interactive = !readOnly;
  const canToggle = interactive && canNumber;

  return (
    <div
      // Editor chrome, never paper: the lozenge is a statement about the
      // EDITOR (a label affordance), not about the figure, so it is stamped
      // chrome-only and ONE print rule hides it — exactly as its twin
      // `.heading-annotation` is (task 535; the law in `view-only-chrome.ts`).
      className={chromeOnly("figure-annotation")}
      contentEditable={false}
      onMouseDown={readOnly ? undefined : onMouseDown}
      onClick={readOnly ? undefined : (e) => e.stopPropagation()}
    >
      <span className="figure-annotation-type-chip" data-hint="Figure">
        Figure
      </span>
      {/* A figure with no caption takes no LaTeX number, so the toggle is
          shown INERT rather than silently doing nothing when clicked — the
          affordance and the mechanism are one declaration (task 316's rule).
          `is-unavailable`, not `is-off`: the latter means the user turned
          numbering off, which they can undo. The unavailable button is
          `disabled`: it announces itself so and takes no focus — a control
          that says it is disabled must not be a tab stop.
          The accessible NAME is stable across the toggle ("Figure number");
          `aria-pressed` is the state channel and the sighted tooltip is what
          flips, so the two cannot double-announce (pinned by render in
          accessible-name-agrees-with-visible-control.test.tsx, member 3). */}
      {interactive ? (
        <button
          data-iconbtn-exempt="geometry + states owned by its own node-view stylesheet class"
          type="button"
          className={`figure-annotation-numbered-toggle focus-ring${
            canNumber ? (numbered ? "" : " is-off") : " is-unavailable"
          }`}
          disabled={!canNumber}
          aria-pressed={canNumber ? numbered : undefined}
          aria-disabled={!canNumber ? true : undefined}
          {...iconHint({
            label: "Figure number",
            hint: !canNumber
              ? "No caption — LaTeX gives this figure no number"
              : numbered
                ? "Hide figure number"
                : "Show figure number",
          })}
          onClick={
            canToggle
              ? (e) => {
                  e.stopPropagation();
                  toggleNumbered();
                }
              : undefined
          }
        >
          #
        </button>
      ) : (
        <span
          className={`figure-annotation-numbered-toggle${
            canNumber ? (numbered ? "" : " is-off") : " is-unavailable"
          }`}
        >
          #
        </span>
      )}
      {interactive && editing ? (
        <>
          <span className="figure-annotation-sep">  ·  label: </span>
          <input
            ref={inputRef}
            type="text"
            className={`figure-label-input${conflict ? " has-conflict" : ""}`}
            value={draft}
            placeholder="label key"
            onChange={labelEdit.onChange}
            onKeyDown={labelEdit.onKeyDown}
            onBlur={labelEdit.onBlur}
            size={Math.max(draft.length, 8)}
          />
          {conflict && (
            <span className="figure-label-warning">
              {labelKeyProblemText(conflict, draft)}
            </span>
          )}
        </>
      ) : label ? (
        <>
          <span className="figure-annotation-sep">  ·  label: </span>
          {interactive ? (
            <button
              type="button"
              className="figure-label-text focus-ring"
              onClick={(e) => {
                e.stopPropagation();
                enterEdit();
              }}
            >
              {label}
            </button>
          ) : (
            <span className="figure-label-text">{label}</span>
          )}
        </>
      ) : readOnly ? null : (
        <button
          type="button"
          className="figure-label-add focus-ring"
          onClick={(e) => {
            e.stopPropagation();
            enterEdit();
          }}
        >
          Label +
        </button>
      )}
      {interactive && (
        <button
          data-iconbtn-exempt="geometry + states owned by its own node-view stylesheet class"
          type="button"
          className="figure-annotation-delete focus-ring"
          {...iconHint({ label: figureDeleteLabel("figureBlock") })}
          onClick={(e) => {
            e.stopPropagation();
            void requestDelete();
          }}
        >
          ×
        </button>
      )}
    </div>
  );
}
