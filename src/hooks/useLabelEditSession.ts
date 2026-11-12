"use client";

/**
 * The React adapter of the ONE inline label-edit session (task 1591).
 *
 * `src/lib/tiptap/label-edit-session.ts` owns the session's CORE — the commit
 * decision (`planLabelCommit`) and the rename-then-refocus write
 * (`writeLabelRename`) — and its vanilla adapter serves the heading strip and
 * the expex pods. This hook is the same session for a React NodeView (the
 * figure lozenge, `FigureAnnotation`), which until task 1591 restated the whole
 * thing and had drifted: no refocus after a rename, so focus fell to `<body>`.
 *
 * What the hook owns is React mechanics only: the draft/editing/warning state,
 * the key snapshot taken ONCE at edit start (task 553 — the per-keystroke
 * warning is an O(1) membership test, never a document walk; the commit re-asks
 * the live predicate, so a stale snapshot can only delay the warning, never
 * admit a duplicate), the focus effect, and 529's end-once latch through
 * `useFieldEditSession` (the commit is ASYNC and a confirm dialog's focus steal
 * blurs a still-mounted input).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import type { Node as PMNode } from "@tiptap/pm/model";
import { collectLabelKeys, labelKeyProblemIn, type LabelKeyProblem } from "@/lib/labels";
import type { LabelRenameConfirm } from "@/lib/tiptap/label-rename";
import { planLabelCommit, writeLabelRename } from "@/lib/tiptap/label-edit-session";
import { useFieldEditSession } from "@/lib/field-edit-session";
import { isCommitEnter, isCancelEscape } from "@/lib/key-intent";

export interface UseLabelEditSessionOptions {
  /** The editor the surface lives in — the write target and the editor
   *  refocused after a rename. Absent = a static (read-only) surface. */
  editor: Editor | undefined;
  /** The key the node currently carries ("" / null = unlabelled). */
  label: string | null;
  /** Resolve the declaring node in `editor`, at write time. */
  locate: () => { pos: number; node: PMNode } | null;
  /** The host's rename-ref confirm. */
  confirm: LabelRenameConfirm | null;
  /** The surface's write gate, asked at gesture time (task 1083). */
  mayWrite: () => boolean;
}

export function useLabelEditSession({
  editor,
  label,
  locate,
  confirm,
  mayWrite,
}: UseLabelEditSessionOptions) {
  const own = label || null;
  const [editing, setEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [draft, setDraft] = useState(own ?? "");
  // The live problem with the draft — a key ANOTHER declaration claims, or
  // one TeX cannot read back (task 1435) — or null. One state, one strip.
  const [problem, setProblem] = useState<LabelKeyProblem | null>(null);
  const keysRef = useRef<ReadonlySet<string> | null>(null);
  const session = useFieldEditSession();

  useEffect(() => {
    const input = inputRef.current;
    if (!editing || !input) return;
    input.focus();
    if (own) input.selectionStart = input.selectionEnd = own.length;
    else input.select();
  }, [editing, own]);

  const begin = useCallback(() => {
    if (!editor || !mayWrite()) return;
    keysRef.current = collectLabelKeys(editor);
    setDraft(own ?? "");
    setProblem(null);
    setEditing(true);
  }, [editor, mayWrite, own]);

  const finish = useCallback(() => {
    setEditing(false);
    setDraft(own ?? "");
    setProblem(null);
  }, [own]);

  /** The write. Called only once the session has already ended. */
  const write = useCallback(
    async (newLabel: string | null) => {
      if (!editor) return;
      const outcome = await writeLabelRename({
        target: editor,
        locate,
        newLabel,
        confirm,
        editorToRefocus: editor,
      });
      // Nothing written (cancelled, stale, conflict, unresolved, read-only):
      // the draft goes back to the committed label rather than holding a key
      // the document never took (task 876). A refusal after the user answered
      // is announced by the door itself (task 1436).
      if (outcome !== "renamed") setDraft(own ?? "");
    },
    [confirm, editor, locate, own],
  );

  const onChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setDraft(e.target.value);
      setProblem(labelKeyProblemIn(keysRef.current, e.target.value.trim(), own));
    },
    [own],
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (isCommitEnter(e)) {
        e.preventDefault();
        if (!editor) return;
        const plan = planLabelCommit(editor, draft, own);
        // The refusal keeps the session OPEN, so it is asked BEFORE the
        // ending: `commitAndBlur` always blurs.
        if (plan.kind === "refuse") {
          setProblem(plan.problem);
          inputRef.current?.focus();
          return;
        }
        session.commitAndBlur(e.currentTarget, () => {
          setEditing(false);
          if (plan.kind === "write") void write(plan.newLabel);
        });
      } else if (isCancelEscape(e)) {
        e.preventDefault();
        session.cancel(e.currentTarget, finish);
      }
    },
    [draft, editor, finish, own, session, write],
  );

  const onBlur = useCallback(() => {
    session.commit(() => {
      if (!editor) return finish();
      const plan = planLabelCommit(editor, draft, own);
      // Leaving the field abandons a conflicting draft — refocusing it here
      // would trap focus in the input.
      if (plan.kind === "refuse") return finish();
      setEditing(false);
      if (plan.kind === "write") void write(plan.newLabel);
    });
  }, [draft, editor, finish, own, session, write]);

  return { editing, draft, problem, inputRef, begin, onChange, onKeyDown, onBlur };
}
