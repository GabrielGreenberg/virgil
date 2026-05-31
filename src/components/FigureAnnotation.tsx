"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import { isLabelTaken } from "@/lib/labels";

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
  getFigurePos,
  onConfirmRename,
  onConfirmDelete,
  readOnly = false,
}: Props) {
  const [editing, setEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [draft, setDraft] = useState(label);
  const [conflict, setConflict] = useState(false);

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
      const taken =
        candidate && editor ? isLabelTaken(editor, candidate, label || null) : false;
      setConflict(taken);
    },
    [editor, label],
  );

  const enterEdit = useCallback(() => {
    setDraft(label);
    setConflict(false);
    setEditing(true);
  }, [label]);

  const commit = useCallback(async () => {
    if (!editing) return;
    if (!editor || !getFigurePos) return;
    setEditing(false);
    const newLabel = draft.trim() || null;
    const oldLabel = label || null;
    if (newLabel === oldLabel) return;

    const pos = getFigurePos();
    if (pos == null) return;

    // Collect refs pointing at the old label so we can offer to update them.
    // Only meaningful when renaming a non-empty label to a non-empty label;
    // add/remove cases either have no refs or can't be rewritten usefully.
    const refPositions: number[] = [];
    if (oldLabel && newLabel) {
      editor.state.doc.descendants((nd, p) => {
        if (nd.type.name === "labelRef" && nd.attrs.label === oldLabel) {
          refPositions.push(p);
        }
      });
    }

    let updateRefs = false;
    if (refPositions.length > 0 && oldLabel && newLabel && onConfirmRename) {
      updateRefs = await onConfirmRename(oldLabel, newLabel, refPositions.length);
    }

    const pos2 = getFigurePos();
    if (pos2 == null) return;
    const figNode = editor.state.doc.nodeAt(pos2);
    if (!figNode || figNode.type.name !== "figureBlock") return;

    const tr = editor.state.tr;
    tr.setNodeMarkup(pos2, undefined, {
      ...figNode.attrs,
      label: newLabel || "",
    });

    if (updateRefs) {
      const display =
        (figNode.attrs.figureNumber as string | number | null) != null
          ? String(figNode.attrs.figureNumber)
          : "??";
      for (const rPos of refPositions) {
        const rNode = editor.state.doc.nodeAt(rPos);
        if (
          rNode &&
          rNode.type.name === "labelRef" &&
          rNode.attrs.label === oldLabel
        ) {
          tr.setNodeMarkup(rPos, undefined, {
            ...rNode.attrs,
            label: newLabel,
            displayText: display,
          });
        }
      }
    }

    editor.view.dispatch(tr);
  }, [draft, editing, editor, label, getFigurePos, onConfirmRename]);

  const cancel = useCallback(() => {
    setEditing(false);
    setDraft(label);
    setConflict(false);
  }, [label]);

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
  const onMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <div
      className="figure-annotation"
      contentEditable={false}
      onMouseDown={readOnly ? undefined : onMouseDown}
      onClick={readOnly ? undefined : (e) => e.stopPropagation()}
    >
      <span className="figure-annotation-type-chip" title="Figure">
        Figure
      </span>
      <span
        className={`figure-annotation-numbered-toggle${numbered ? "" : " is-off"}`}
        role={readOnly ? undefined : "button"}
        aria-pressed={readOnly ? undefined : numbered}
        title={
          readOnly
            ? undefined
            : numbered
              ? "Hide figure number"
              : "Show figure number"
        }
        onClick={
          readOnly
            ? undefined
            : (e) => {
                e.stopPropagation();
                toggleNumbered();
              }
        }
      >
        #
      </span>
      {!readOnly && editing ? (
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
                void commit();
              } else if (e.key === "Escape") {
                e.preventDefault();
                cancel();
              }
            }}
            onBlur={() => void commit()}
            size={Math.max(draft.length, 8)}
          />
          {conflict && (
            <span className="figure-label-warning">⚠ label already in use</span>
          )}
        </>
      ) : label ? (
        <>
          <span className="figure-annotation-sep">  ·  label: </span>
          <span
            className="figure-label-text"
            onClick={
              readOnly
                ? undefined
                : (e) => {
                    e.stopPropagation();
                    enterEdit();
                  }
            }
          >
            {label}
          </span>
        </>
      ) : readOnly ? null : (
        <span
          className="figure-label-add"
          onClick={(e) => {
            e.stopPropagation();
            enterEdit();
          }}
        >
          Label +
        </span>
      )}
      {!readOnly && (
        <span
          className="figure-annotation-delete"
          role="button"
          title="Delete figure"
          onClick={(e) => {
            e.stopPropagation();
            void requestDelete();
          }}
        >
          ×
        </span>
      )}
    </div>
  );
}
