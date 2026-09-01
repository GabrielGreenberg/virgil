"use client";

/**
 * AN EDIT SESSION ENDS EXACTLY ONCE (task 529).
 *
 * An inline field that commits on blur has two possible endings — COMMIT and
 * CANCEL — and exactly one of them must happen. Virgil had four such fields and
 * every one of them ended TWICE, in one of two directions.
 *
 * ## The mechanism, measured
 *
 * `element.blur()` dispatches `focusout` SYNCHRONOUSLY, and React delegates
 * `onBlur` off `focusout` — so a `.blur()` inside a keydown handler runs that
 * field's own `onBlur` commit *nested inside the still-executing keydown*, from
 * the render closure it was created in. Driven through a real React root, a
 * plain revert-then-blur cancel logs exactly:
 *
 *     ["esc:begin", "commit:80", "esc:end"]     final rendered value: "40"
 *
 * The commit fires between the two halves of the cancel branch and reads the
 * TYPED `80`, because `setDraft("40")` is queued for the next render and cannot
 * touch the binding the handlers captured. The revert then lands and wins the
 * RENDER. **So the box shows the value you cancelled TO while the commit has
 * already fired with the value you cancelled FROM.** That is why this survived
 * for as long as the fields have existed: every one of them looks correct on
 * screen, and a test that asserts the rendered value passes on the broken
 * implementation. The damage is all downstream — a `setNodeMarkup`, a `.tex`
 * write, a scroll.
 *
 * The same synchronous blur breaks the OTHER ending too, and that half is easy
 * to miss because its value is right: `commitDraft(); el.blur();` runs the
 * commit, then the blur runs it AGAIN from the identical stale closure — where
 * the guards that would have caught a no-op (`clamped !== currentPercent`,
 * `pgDraft === row.postnote`) still hold the pre-commit values, so they do not
 * bail. One Enter, two document transactions: two undo steps for one edit, and
 * two autosave arms.
 *
 * ## The law
 *
 * > Whichever ending happens FIRST wins; the other is skipped. The record of
 * > "this session has ended" must live where the commit reads it, and be read
 * > SYNCHRONOUSLY. React state is not such a place.
 *
 * Exactly two things are:
 *
 *   - the **value source itself**, when it is synchronously writable — i.e. an
 *     UNCONTROLLED input whose commit reads `el.value`. Restoring the DOM value
 *     before blurring is a real cancel, and it is what `panel-primitives.tsx`'s
 *     `CardBodyTitle` has always done. It cannot express the *Enter* half,
 *     though: there is no value to restore that makes a duplicate commit safe.
 *   - a **ref**, which every field can use whatever its value source and which
 *     answers both endings with one flag.
 *
 * `useFieldEditSession` is the ref path and every cancelling field in both
 * silos takes it — the one that was already correct by the first mechanism
 * included, because two spellings of one rule is one too many (the rule task
 * 486 earned for the refocus door). `CardBodyTitle` still restores its DOM
 * value; what the door adds is that the commit is skipped BY CONSTRUCTION
 * rather than by the restored value happening to equal the stored one.
 *
 * ## The window is bounded by the blur, not by hope
 *
 * `cancel()` / `commitAndBlur()` clear the flag in a `finally` around the blur,
 * so it is live for exactly the duration of the synchronous `focusout` dispatch
 * — precisely the window in which the duplicate can fire — and no longer. An
 * ending whose blur never happens (a null element, an element that did not have
 * focus) therefore cannot swallow some LATER, unrelated commit, and the field
 * is immediately editable again. A flag cleared by the duplicate instead would
 * depend on the duplicate running, which is the one thing an ending cannot
 * assume.
 *
 * ## The liveness half: a commit that cannot read a live value REFUSES
 *
 * The second failure in this class is a commit whose value SOURCE has vanished.
 * `SourcePodNodeView` deferred its title commit by 100 ms and then read
 * `inputRef.current?.value ?? ""` — after the input had unmounted — and wrote
 * that empty string, which for a title means DELETING one the user never
 * touched. `commitLiveValue` is the rule: no element, no commit. It reports
 * whether it ran, so a caller can tell a refusal from a landed write instead of
 * inferring success from the absence of a throw. Its companion rule is that the
 * value is read while it is ALIVE — a deferral may carry a value already read,
 * it may not go back for one. `BibEntryCard.tsx` already had this shape.
 *
 * ## Not everything that blurs is a member
 *
 * A field with no cancel branch (`PreferenceTree.ColorPref` — Enter blurs, and
 * that is the whole keymap) and a field that commits on every keystroke
 * (`SizeStepper`, `PanelTextSizeRow`, whose Escape is deliberately the same
 * statement as Enter because the value is already live) have no second ending
 * to suppress. The census in `field-edit-session.test.tsx` is scoped to a
 * keydown whose Escape handling is DISTINCT from its Enter handling — which is
 * the honest discriminator, because a branch that treats the two keys
 * identically is not promising a revert. They stay out of the population by
 * construction; the allowlist is EMPTY.
 *
 * ## The same law, already spelled by hand in a medium this hook cannot reach
 *
 * Six vanilla-DOM editors — the par-title and heading-label inputs in
 * `src/lib/editor-extensions.ts` and three in `src/lib/tiptap/expex.ts` — are
 * CORRECT, via a local `let committed = false` set synchronously in the Escape
 * branch and checked in the blur listener. That is this law, in the idiom
 * available to a plain `addEventListener`. They are deliberately NOT converted:
 * they are not React components, so they cannot call a hook, and giving the
 * factory a non-React twin to serve them would touch two of the most
 * delicately-tested files in the repo for no behaviour change. Recorded here so
 * the next reader knows the latch is the same rule and not a stray idiom.
 */

import { useMemo, useRef } from "react";

export interface FieldEditSession {
  /**
   * End the session as a CANCEL: record the ending, run `revert` (restore the
   * draft, close the editor — whatever this field's cancel means), then blur
   * `el`. The blur's synchronous `focusout` runs the field's `onBlur` while the
   * flag is set, so `commit()` skips.
   *
   * Pass the element the user is typing in — `e.currentTarget` in a keydown, or
   * a ref.
   */
  cancel(el?: HTMLElement | null, revert?: () => void): void;
  /**
   * End the session as a COMMIT and blur — the ENTER branch. `run` fires once,
   * here; the `onBlur` the blur dispatches sees the session already ended and
   * skips, so one Enter is one commit rather than two.
   *
   * Deliberately still commits EXPLICITLY rather than relying on the blur to do
   * it: `blur()` is a no-op on an element that never had focus, and a field
   * whose Enter silently committed nothing in that case would be a worse bug
   * than the duplicate.
   */
  commitAndBlur(el: HTMLElement | null | undefined, run: () => void): boolean;
  /**
   * The ON-BLUR branch: commit unless the session has already ended. Returns
   * whether `run` fired (THE REPORT IS THE PERMISSION — a caller that must know
   * cannot infer it from the absence of a throw).
   */
  commit(run: () => void): boolean;
  /** True only while an ending is dispatching its blur. */
  isEnding(): boolean;
}

export function useFieldEditSession(): FieldEditSession {
  // The ref IS the whole state, which is the point: nothing here can go stale,
  // and a render-closure guard — what this replaces — always can.
  const ending = useRef(false);
  return useMemo<FieldEditSession>(() => {
    /** Run `first`, then blur, with the session marked ended for exactly the
     *  duration of the blur's synchronous dispatch. */
    const endWith = (
      el: HTMLElement | null | undefined,
      first?: () => void,
    ): void => {
      ending.current = true;
      try {
        first?.();
        el?.blur();
      } finally {
        ending.current = false;
      }
    };
    return {
      cancel(el, revert) {
        endWith(el, revert);
      },
      commitAndBlur(el, run) {
        if (ending.current) return false;
        endWith(el, run);
        return true;
      },
      commit(run) {
        if (ending.current) return false;
        run();
        return true;
      },
      isEnding: () => ending.current,
    };
  }, []);
}

/**
 * Run `apply` with the field's LIVE value, or REFUSE when the element is gone.
 *
 * The refusal is the whole point: a commit that substitutes a default for a
 * value it could not read is not a commit, it is a write of the default — and
 * for a title field the default (`""`) DELETES the stored value. Returns
 * whether it ran.
 */
export function commitLiveValue(
  el: HTMLInputElement | HTMLTextAreaElement | null | undefined,
  apply: (value: string) => void,
): boolean {
  // No element ⇒ no value ⇒ nothing to commit. Never `?? ""`.
  if (!el) return false;
  apply(el.value);
  return true;
}
