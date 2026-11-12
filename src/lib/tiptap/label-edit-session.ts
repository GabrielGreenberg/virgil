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
 */

import type { Editor } from "@tiptap/react";
import type { Node as PMNode } from "@tiptap/pm/model";
import { collectLabelKeys, labelKeyProblem } from "@/lib/labels";
import { createLabelKeyWarning } from "@/lib/tiptap/label-key-warning";
import { renameLabelWithRefs, type LabelRenameConfirm } from "@/lib/tiptap/label-rename";
import { answerFieldKeys } from "@/lib/tiptap/field-keys";
import { refocusEditor } from "@/lib/tiptap/refocus-editor";
import type { ViewLifetime } from "@/lib/tiptap/view-lifetime";

/** A blur inside this window after opening is a focus steal, not a leave. */
export const LABEL_BLUR_ARM_MS = 200;

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
    const newLabel = input.value.trim() || null;
    const oldLabel = getLabel();
    const target = getTarget();

    // A candidate ANOTHER declaration already claims is REFUSED — the door
    // asks the same predicate, but it is asked here first so the input can
    // stay OPEN on Enter (warning lit), while leaving the field abandons the
    // conflicting draft (a blur that re-focused the input would trap focus).
    if (newLabel && newLabel !== oldLabel && labelKeyProblem(target, newLabel, oldLabel)) {
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
    if (newLabel === oldLabel) return;

    // ONE door for every label rename (task 534): moves the declaration and
    // every `\ref` naming the old key in ONE transaction.
    const outcome = await renameLabelWithRefs(target, {
      locate: () => locate(target),
      newLabel,
      confirm: confirm(),
    });
    if (outcome !== "renamed") return;
    // Task 486: the edit happened AT A NODE; the caret is wherever the user
    // left it, so a bare `focus()`'s deferred scroll would drag the document
    // to a stale caret. The refocus door leaves the document where it is.
    refocusEditor(opts.editorToRefocus);
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
