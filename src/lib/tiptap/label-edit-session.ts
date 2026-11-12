/**
 * # ONE inline label-edit session, not two copies (task 1588)
 *
 * Two vanilla surfaces edit a `\label` key in an inline `<input>`: the heading
 * label strip (`editor-extensions.ts`) and the expex label pod (block + item,
 * `expex.ts`). Each carried its own copy of the whole session — the pod's doc
 * comment called its commit "the heading strip's byte for byte" — and the
 * copies had drifted the way copies do:
 *
 *   - Only the heading copy handed focus back after a rename (task 486's
 *     `refocusEditor`); renaming an example's label dropped DOM focus to
 *     `<body>`, so the user had to click back into the text to keep typing.
 *   - Neither ended its session when the view was destroyed; the title door
 *     (`title-edit-session.ts`) does. A view re-minted mid-edit left an armed
 *     blur able to run a commit against a dead view.
 *
 * What the door owns: the live "already in use" warning over a key set
 * snapshotted at edit start (task 553), task 529's end-once latch, the
 * duplicate-key REFUSAL (Enter keeps the input open with the warning lit;
 * leaving the field abandons the draft rather than trapping focus in it —
 * task 534), the `renameLabelWithRefs` call against the write TARGET (main in
 * a float), the blur commit armed after `LABEL_BLUR_ARM_MS`, the
 * `answerFieldKeys` commit/cancel, the framed focus + caret placement,
 * `lifetime.onDispose` (a destroyed view ends the session and commits
 * nothing), and `refocusEditor` once the door reports `"renamed"`.
 *
 * What it does NOT own: creating / placing the input, the surface's render
 * (`onFinish` restores it — called on every ending EXCEPT disposal, whose
 * view is gone), and the surface's own extras (the heading strip's sizer and
 * focus keeper, released through `onEnd`).
 *
 * ## The core and its two adapters (task 1591)
 *
 * The figure lozenge (`FigureAnnotation`, a React NodeView) was a THIRD copy
 * of this session — its own snapshot, refusal and rename call — and it had
 * drifted exactly as the expex pods had: no refocus after a rename. So the
 * framework-neutral half is split out as the CORE, which both adapters enter:
 *
 *   - `planLabelCommit` — the ONE commit decision (refuse a key another
 *     declaration owns / nothing changed / write), asked at Enter and at blur;
 *   - `writeLabelRename` — the rename against the write target, then
 *     `refocusEditor` once the door reports `"renamed"`.
 *
 * The adapters own only their framework's mechanics: the vanilla one below
 * (input listeners, `ViewLifetime`, `LABEL_BLUR_ARM_MS`) and the React one,
 * `useLabelEditSession` (`src/hooks/useLabelEditSession.ts`, riding
 * `useFieldEditSession`'s end-once ref).
 */

import type { Editor } from "@tiptap/react";
import type { Node as PMNode } from "@tiptap/pm/model";
import { collectLabelKeys, labelKeyProblem, type LabelKeyProblem } from "@/lib/labels";
import { createLabelKeyWarning } from "@/lib/tiptap/label-key-warning";
import {
  renameLabelWithRefs,
  type LabelRenameConfirm,
  type LabelRenameOutcome,
} from "@/lib/tiptap/label-rename";
import { answerFieldKeys } from "@/lib/tiptap/field-keys";
import { refocusEditor } from "@/lib/tiptap/refocus-editor";
import type { ViewLifetime } from "@/lib/tiptap/view-lifetime";

/** A blur inside this window after opening is a focus steal, not a leave. */
export const LABEL_BLUR_ARM_MS = 200;

/** What a commit of `draft` over a node carrying `oldLabel` should do. */
export type LabelCommitPlan =
  | { kind: "refuse"; problem: LabelKeyProblem }
  | { kind: "unchanged" }
  | { kind: "write"; newLabel: string | null };

/**
 * The ONE commit decision, shared by both adapters. A candidate ANOTHER
 * declaration already claims (or one TeX cannot read back, task 1435) is
 * REFUSED — the rename door asks the same predicate, but it is asked here
 * first so Enter can keep the field OPEN (warning lit) while leaving the field
 * abandons the conflicting draft (a blur that re-focused the input would trap
 * focus). O(1) beyond the predicate's own lookup.
 */
export function planLabelCommit(
  target: Editor,
  draft: string,
  oldLabel: string | null,
): LabelCommitPlan {
  const newLabel = draft.trim() || null;
  if (newLabel === oldLabel) return { kind: "unchanged" };
  const problem = newLabel ? labelKeyProblem(target, newLabel, oldLabel) : null;
  if (problem) return { kind: "refuse", problem };
  return { kind: "write", newLabel };
}

export interface LabelRenameWrite {
  /** The write target: main in a float, the view's own editor otherwise. */
  target: Editor;
  /** Resolve the declaring node in `target`, at write time. */
  locate: () => { pos: number; node: PMNode } | null;
  newLabel: string | null;
  confirm: LabelRenameConfirm | null;
  /** The editor the surface lives in — refocused after a rename. */
  editorToRefocus: Editor;
}

/**
 * The WRITE half of the core: ONE door for every label rename (task 534) —
 * moves the declaration and every `\ref` naming the old key in ONE
 * transaction — then hands focus back. Task 486: the edit happened AT A NODE;
 * the caret is wherever the user left it, so a bare `focus()`'s deferred
 * scroll would drag the document to a stale caret. The refocus door leaves the
 * document where it is.
 */
export async function writeLabelRename(w: LabelRenameWrite): Promise<LabelRenameOutcome> {
  const outcome = await renameLabelWithRefs(w.target, {
    locate: w.locate,
    newLabel: w.newLabel,
    confirm: w.confirm,
  });
  if (outcome === "renamed") refocusEditor(w.editorToRefocus);
  return outcome;
}

export interface LabelEditSessionOptions {
  /** The label `<input>`, already in the DOM. */
  input: HTMLInputElement;
  /** Where the warning strip mounts. */
  container: HTMLElement;
  /** The view's lifetime — the arm timer, the focus frame and the session
   *  itself are bounded by it. */
  lifetime: ViewLifetime;
  /** The write target: main in a float, the view's own editor otherwise. */
  getTarget: () => Editor;
  /** The key the node currently carries (null = unlabelled). */
  getLabel: () => string | null;
  /** Resolve the declaring node in `target`. */
  locate: (target: Editor) => { pos: number; node: PMNode } | null;
  /** The host's rename-ref confirm, read at commit time. */
  confirm: () => LabelRenameConfirm | null;
  /** Restore the surface's display — every ending but disposal. */
  onFinish: () => void;
  /** Release the surface's own session extras — every ending, disposal too. */
  onEnd?: () => void;
  /** The editor the NodeView lives in (the float in a float), refocused —
   *  through the refocus door, never a bare `focus()` — after a rename. */
  editorToRefocus: Editor;
}

export function beginLabelEditSession(opts: LabelEditSessionOptions): void {
  const { input, container, lifetime, getTarget, getLabel, locate, confirm, onFinish, onEnd } =
    opts;

  // Snapshotted ONCE, here, against the write target — O(1) per keystroke;
  // the commit re-asks the live predicate, so the two cannot disagree.
  const warning = createLabelKeyWarning({
    input,
    container,
    keys: collectLabelKeys(getTarget()),
    own: getLabel(),
  });

  // The 529 latch: written SYNCHRONOUSLY by whichever ending runs first,
  // before the surface re-renders, so a blur the removal dispatches finds the
  // session already over.
  let ended = false;
  const end = (): void => {
    if (ended) return;
    ended = true;
    unregister();
    warning.dispose();
    onEnd?.();
  };
  // A view destroyed mid-edit takes the session with it and commits nothing.
  const unregister = lifetime.onDispose(end);

  const commit = async (via: "enter" | "blur"): Promise<void> => {
    if (ended) return;
    const target = getTarget();
    const plan = planLabelCommit(target, input.value, getLabel());

    if (plan.kind === "refuse") {
      if (via === "enter") {
        warning.refresh();
        input.focus();
        return;
      }
      end();
      onFinish();
      return;
    }

    end();
    // Restore the display before awaiting a modal so the user is not staring
    // at a stale editable input behind it; the NodeView's `update()`
    // re-renders from the committed attr once the door dispatches.
    onFinish();
    if (plan.kind === "unchanged") return;
    await writeLabelRename({
      target,
      locate: () => locate(target),
      newLabel: plan.newLabel,
      confirm: confirm(),
      editorToRefocus: opts.editorToRefocus,
    });
  };

  input.addEventListener("mousedown", (e) => e.stopPropagation());
  let armed = false;
  input.addEventListener("blur", () => {
    if (armed) void commit("blur");
  });
  lifetime.setTimeout(() => {
    armed = true;
  }, LABEL_BLUR_ARM_MS);
  // Claims the keys it answers (task 1441, `answerFieldKeys`).
  answerFieldKeys(input, {
    commit: () => void commit("enter"),
    cancel: () => {
      if (ended) return;
      end();
      onFinish();
    },
  });

  // Focus in a FRAME: a synchronous focus inside the editor DOM loses to
  // ProseMirror's mouseup selection sync.
  lifetime.requestAnimationFrame(() => {
    if (ended) return;
    input.focus();
    if (getLabel()) {
      input.selectionStart = input.selectionEnd = input.value.length;
    } else {
      input.select();
    }
  });
}
