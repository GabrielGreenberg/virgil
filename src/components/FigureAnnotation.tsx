"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import { isLabelTaken, collectLabelKeys, isLabelTakenIn } from "@/lib/labels";
import { renameLabelWithRefs } from "@/lib/tiptap/label-rename";
import { chromeOnly } from "@/lib/view-only-chrome";
import { useFieldEditSession } from "@/lib/field-edit-session";
import { iconHint } from "@/components/Hint";

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
  onConfirmRename?:
    | ((oldLabel: string, newLabel: string, refCount: number) => Promise<boolean>)
    | null;
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
  const [editing, setEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [draft, setDraft] = useState(label);
  const [conflict, setConflict] = useState(false);
  // The keys declared elsewhere, SNAPSHOTTED when the edit opens (task 553):
  // the live warning is an O(1) membership test per keystroke over this set,
  // never a document walk. The commit re-asks the live `isLabelTaken`, so a
  // stale snapshot can only delay the warning, never admit a duplicate.
  const keysRef = useRef<ReadonlySet<string> | null>(null);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      if (label) {
        inputRef.current.selectionStart = inputRef.current.selectionEnd =
          label.length;
      } else {
        inputRef.current.select();
      }
    }
  }, [editing, label]);

  const checkConflict = useCallback(
    (candidate: string) => {
      const keys = keysRef.current;
      const taken = candidate && keys ? isLabelTakenIn(keys, candidate, label || null) : false;
      setConflict(taken);
    },
    [label],
  );

  const enterEdit = useCallback(() => {
    keysRef.current = editor ? collectLabelKeys(editor) : null;
    setDraft(label);
    setConflict(false);
    setEditing(true);
  }, [editor, label]);

  const cancel = useCallback(() => {
    setEditing(false);
    setDraft(label);
    setConflict(false);
  }, [label]);

  // 529's door. This field's `commit` is ASYNC — it awaits the host's rename
  // confirm — and a dialog FOCUSES its cued default (task 389), which blurs an
  // input that is still mounted. Pre-555 `commit` opened with
  // `if (!editing) return`, a captured render-closure read that is PERMANENTLY
  // TRUE for every `commit` the mounted input can reach (the input renders only
  // while `editing`), so the guard its author wrote to stop a second commit
  // could never fire. MEASURED through the real stack: one Enter on a rename
  // with refs to carry produced TWO confirm dialogs and two rename attempts.
  // The door reads a REF — "the live value" the dead guard was reaching for.
  const session = useFieldEditSession();

  /** Would the current draft collide with a key ANOTHER declaration owns?
   *  ONE predicate, asked by the keydown (which must keep the session OPEN so
   *  the user can fix it) and by the blur (which abandons the draft) — the two
   *  endings want opposite answers to the same question, and a second copy is
   *  how they come to disagree. Task 534: pre-534 the warning was advisory and
   *  the commit never read `conflict`, so a duplicate `\label` — always a
   *  LaTeX error ("Label multiply defined") — was committed anyway. */
  const candidateConflicts = useCallback(() => {
    if (!editor) return false;
    const newLabel = draft.trim() || null;
    const oldLabel = label || null;
    return !!(
      newLabel &&
      newLabel !== oldLabel &&
      isLabelTaken(editor, newLabel, oldLabel)
    );
  }, [draft, editor, label]);

  /** The WRITE. Called only once the session has already ended, so it never
   *  decides whether the session ends — that decision is SYNCHRONOUS and lives
   *  at the two endings below, which is what lets `commitAndBlur` blur before
   *  the first `await` yields. */
  const commitRename = useCallback(async () => {
    if (!editor || !getFigurePos) return;
    const newLabel = draft.trim() || null;
    const oldLabel = label || null;
    if (newLabel === oldLabel) return;

    // ONE door for every label rename (task 534): collects the `\ref`s
    // naming the old key over the whole document, asks the host's confirm
    // (`onConfirmRename`, produced by `EditorPane`), and moves the
    // declaration and every ref in ONE transaction. The heading strip and
    // the Outline's label editor enter the same door.
    await renameLabelWithRefs(editor, {
      locate: () => {
        const pos = getFigurePos();
        if (pos == null) return null;
        const node = editor.state.doc.nodeAt(pos);
        return node && node.type.name === "figureBlock" ? { pos, node } : null;
      },
      newLabel,
      confirm: onConfirmRename ?? null,
    });
  }, [draft, editor, label, getFigurePos, onConfirmRename]);

  const toggleNumbered = useCallback(() => {
    if (!editor || !getFigurePos) return;
    const pos = getFigurePos();
    if (pos == null) return;
    const figNode = editor.state.doc.nodeAt(pos);
    if (!figNode || figNode.type.name !== "figureBlock") return;
    const tr = editor.state.tr.setNodeMarkup(pos, undefined, {
      ...figNode.attrs,
      numbered: !numbered,
    });
    editor.view.dispatch(tr);
  }, [editor, numbered, getFigurePos]);

  const requestDelete = useCallback(async () => {
    if (!editor || !getFigurePos) return;
    const ok = onConfirmDelete ? await onConfirmDelete() : true;
    if (!ok) return;
    const pos = getFigurePos();
    if (pos == null) return;
    const figNode = editor.state.doc.nodeAt(pos);
    if (!figNode || figNode.type.name !== "figureBlock") return;
    editor.view.dispatch(editor.state.tr.delete(pos, pos + figNode.nodeSize));
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
          flips, so the two cannot double-announce (the `OmniBlankToggle`
          contract). */}
      {interactive ? (
        <button
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
            onChange={(e) => {
              setDraft(e.target.value);
              checkConflict(e.target.value.trim());
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                // The conflict REFUSAL keeps the session open, so it is asked
                // BEFORE the door: `commitAndBlur` always blurs, which would
                // undo the refocus this branch exists to perform.
                if (candidateConflicts()) {
                  setConflict(true);
                  inputRef.current?.focus();
                  return;
                }
                session.commitAndBlur(e.currentTarget, () => {
                  setEditing(false);
                  void commitRename();
                });
              } else if (e.key === "Escape") {
                e.preventDefault();
                session.cancel(e.currentTarget, cancel);
              }
            }}
            onBlur={() =>
              session.commit(() => {
                // Leaving the field abandons a conflicting draft — refocusing
                // it here would trap focus in the input.
                if (candidateConflicts()) {
                  cancel();
                  return;
                }
                setEditing(false);
                void commitRename();
              })
            }
            size={Math.max(draft.length, 8)}
          />
          {conflict && (
            <span className="figure-label-warning">⚠ label already in use</span>
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
          type="button"
          className="figure-annotation-delete focus-ring"
          {...iconHint({ label: "Delete figure" })}
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
