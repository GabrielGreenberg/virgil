/**
 * The ONE keydown door for an editor-chrome input that answers Enter and
 * Escape (task 1441) — the paragraph-title strip, the heading label input and
 * the example label pod.
 *
 * Such an input is the innermost transient thing on screen, so one press must
 * end exactly one thing: the field CLAIMS the keys it answers
 * (`claimGestureKey` — `preventDefault` + `stopPropagation`), and only those.
 * Unclaimed, an Escape that cancelled a label also reached `useMarginEdit`'s
 * window listener (dropping every margin guide dragged and not yet Saved),
 * `system-dialog`'s window-BUBBLE Escape (closing a scrimless Preferences or a
 * half-typed bug report) and `NodeEditPopover`. Task 552 fixed the title strip
 * by hand; its expex and heading twins were never converted, because each site
 * hand-rolled its own keydown. They now share this one, and
 * `chrome-input-key-claim-census.test.ts` fails on a new hand-rolled Escape
 * under `src/lib/tiptap/**` or `editor-extensions.ts` that does not claim.
 *
 * Every other key — Cmd-S, Cmd-P, a character — passes through: the field does
 * not answer them. IME-owned presses (a candidate-commit Enter, a
 * composition-cancel Escape) are the IME's, never the field's.
 */

import { claimGestureKey } from "@/lib/pane-resize/pointer-invariants";
import { isCancelEscape, isCommitEnter } from "@/lib/key-intent";

export interface FieldKeyAnswers {
  /** Return (non-IME): save the draft. */
  commit: () => void;
  /** Escape (non-IME): abandon the draft — never the key that saves. */
  cancel: () => void;
}

export function answerFieldKeys(input: HTMLElement, answers: FieldKeyAnswers): void {
  input.addEventListener("keydown", (ev) => {
    if (isCommitEnter(ev)) {
      claimGestureKey(ev);
      answers.commit();
    } else if (isCancelEscape(ev)) {
      claimGestureKey(ev);
      answers.cancel();
    }
  });
}
