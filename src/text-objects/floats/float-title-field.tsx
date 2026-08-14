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
import { autoSizeInput } from "@/lib/autoSizeInput";
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
              const val = (e.target as HTMLInputElement).value.trim();
              onCommit(val || null);
            } else if (e.key === "Escape") {
              e.preventDefault();
              onCancel();
            }
          }}
          onBlur={(e) => {
            const val = e.currentTarget.value.trim();
            onCommit(val || null);
          }}
        />
      </div>
    );
  }

  const handleStart = canEdit ? onStartEdit : () => {};
  const handleClear = canEdit ? onClear : () => {};

  return (
    <div
      className="par-title-annotation"
      onClick={handleStart}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          handleStart();
        }
      }}
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
