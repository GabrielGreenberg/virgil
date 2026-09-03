"use client";

/**
 * Shared title-editing affordance for TextObject float bodies.
 *
 * Originally lived inline inside `ParagraphFloat` and `TexBlockFloat` — same
 * `par-title-*` CSS classes, same focus/blur/autosize harness, same +T / × /
 * pencil semantics. Extracted here so every float body that wants an editable
 * `parTitle` attr can drop it in without copying the editing logic.
 *
 * Kinds without a title (heading, list, exampleBlock) don't import this.
 */

import { useEffect, useRef } from "react";
import { activatableProps } from "@/lib/activatable-props";
import { autoSizeInput, syncInputWidth } from "@/lib/autoSizeInput";
import { useFieldDraft } from "@/components/field-draft";
import { iconHint } from "@/components/Hint";

export interface FloatTitleFieldProps {
  /** Current title text, or null when there's no title. */
  title: string | null;
  /** Whether the field is in input mode (focused, accepting keystrokes). */
  editing: boolean;
  /** Caller-supplied flag — falsy disables the +T / pencil affordance. */
  canEdit: boolean;
  /** Caller flips `editing` to true. */
  onStartEdit: () => void;
  /** Caller persists the new title (null when cleared). */
  onCommit: (next: string | null) => void;
  /** Caller flips `editing` back to false without persisting. */
  onCancel: () => void;
  /** Caller persists `null` (remove title). */
  onClear: () => void;
  /** Optional placeholder for the input. */
  placeholder?: string;
}

export function FloatTitleField({
  title,
  editing,
  canEdit,
  onStartEdit,
  onCommit,
  onCancel,
  onClear,
  placeholder = "Title…",
}: FloatTitleFieldProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  // The DOM node is this field's draft. Two halves, both real here (task 532):
  // the source moves under an OPEN session — `source-pod-body`'s
  // `syncFromMain` re-reads `parTitle` off the main document on every
  // transaction — and the blur commit was UNCONDITIONAL, so a bare focus+blur
  // that changed nothing dispatched a `setNodeMarkup` on the user's document:
  // an undo step and an autosave arm for an edit that did not happen. The CODE
  // sibling six lines from the same commit path (`handleCodeChange`) already
  // guarded exactly this.
  const draft = useFieldDraft<string>({
    source: title ?? "",
    readDraft: () => inputRef.current?.value,
    writeDraft: (next) => {
      const el = inputRef.current;
      if (!el) return;
      el.value = next;
      syncInputWidth(el);
    },
  });

  /** The commit edge, shared by Enter and blur. Normalize BEFORE committing so
   *  the guard compares like with like: a draft of `"A "` against a stored
   *  `"A"` is not a change.
   *
   *  A commit that would change nothing ends the session as a CANCEL: the
   *  caller's `onCommit` is what closes edit mode, so skipping it without
   *  saying so would leave the user staring at an input they had just clicked
   *  away from. Nothing to write ⇒ the ending is a cancel. */
  const commitFrom = (el: HTMLInputElement) => {
    if (!draft.commit(el.value.trim(), (v) => onCommit(v || null))) onCancel();
  };

  useEffect(() => {
    if (!editing) return;
    const input = inputRef.current;
    if (!input) return;
    const cleanup = autoSizeInput(input);
    input.focus();
    input.select();
    return cleanup;
  }, [editing]);

  if (editing) {
    return (
      <div className="par-title-annotation">
        <input
          ref={inputRef}
          type="text"
          className="par-title-input"
          defaultValue={title ?? ""}
          placeholder={placeholder}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") {
              e.preventDefault();
              commitFrom(e.currentTarget);
            } else if (e.key === "Escape") {
              e.preventDefault();
              // Restore the DOM value before leaving edit mode: some browsers
              // fire `focusout` when a focused element is removed, and this
              // input's blur COMMITS. Reverting first makes that stray commit a
              // provable no-op rather than a race (task 529's law, reached
              // through the draft door rather than a second latch).
              draft.revert();
              onCancel();
            }
          }}
          onBlur={(e) => {
            commitFrom(e.currentTarget);
          }}
        />
      </div>
    );
  }

  const handleStart = canEdit ? onStartEdit : () => {};
  const handleClear = canEdit ? onClear : () => {};

  return (
    <div
      className="par-title-annotation focus-ring"
      // A CONTAINER with a nested `<button>` (the × below), so it takes the
      // ONE spelling of the `button` role (task 536); the helper's target
      // guard keeps a key on that × from also opening the editor.
      {...activatableProps(handleStart)}
    >
      {title ? (
        <>
          <span className="par-title-text">{title}</span>
          <button
            type="button"
            className="par-title-delete focus-ring"
            {...iconHint({ label: "Remove title" })}
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              handleClear();
            }}
          >
            ×
          </button>
        </>
      ) : (
        <span className="par-title-add">+T</span>
      )}
    </div>
  );
}
