import { isLabelTakenIn } from "@/lib/labels";

/**
 * LABEL KEY WARNING — the live "⚠ label already in use" strip under a label
 * input, ONE helper for every vanilla-DOM label editor (task 553).
 *
 * The warning is ADVISORY: it tells the user, per keystroke, that the key they
 * are typing is one another declaration already claims. Pre-553 the heading
 * strip's copy answered that by calling `isLabelTaken(editor, …)` on every
 * `input` event — a full `doc.descendants` walk plus a regex over every text
 * node carrying `\label{`, per CHARACTER typed into a 10-character chrome
 * field, on a paper that can hold thousands of blocks. And the example pods
 * carried no warning at all: three shapes of one session.
 *
 * The rule: the key set is SNAPSHOTTED once, at edit start, and every keystroke
 * is an O(1) membership test over it. That is sound because the set cannot
 * change while the chrome input holds focus — the NodeView's `stopEvent`
 * keeps ProseMirror out, so nothing edits the document under the edit. (A
 * collaborator's write landing mid-edit is the stated residual; the COMMIT
 * still asks the live `isLabelTaken`, so a stale snapshot can only delay the
 * warning, never let a duplicate through.)
 *
 * What it owns: the warning element, the `has-conflict` class on the input,
 * and the `input` listener. What it does NOT own: the commit gate — that is
 * `renameLabelWithRefs`' own rung, and the caller re-asks the live predicate
 * so the warning and the commit can never disagree.
 */

export interface LabelKeyWarningOptions {
  /** The chrome input being typed into. */
  input: HTMLInputElement;
  /** Where the warning strip mounts (appended). */
  container: HTMLElement;
  /** The keys declared elsewhere in the document — snapshot ONCE at edit
   *  start (`collectLabelKeys(target)`), never re-read per keystroke. */
  keys: ReadonlySet<string>;
  /** This declaration's own current key, excluded from the test. */
  own: string | null;
  /** Class for the warning element (default: the heading strip's). */
  className?: string;
}

export interface LabelKeyWarning {
  /** Re-derive from the input's current value. */
  refresh(): void;
  /** Whether the current value conflicts — what `refresh` last painted. */
  conflict(): boolean;
  /** Remove the strip and the listener. Idempotent. */
  dispose(): void;
}

export const LABEL_KEY_WARNING_TEXT = "⚠ label already in use";

export function createLabelKeyWarning(opts: LabelKeyWarningOptions): LabelKeyWarning {
  const { input, container, keys, own } = opts;
  const el = document.createElement("div");
  el.className = opts.className ?? "heading-label-warning";
  el.textContent = LABEL_KEY_WARNING_TEXT;
  el.style.display = "none";
  container.appendChild(el);

  let taken = false;
  const refresh = () => {
    const candidate = input.value.trim();
    taken = candidate ? isLabelTakenIn(keys, candidate, own) : false;
    el.style.display = taken ? "" : "none";
    input.classList.toggle("has-conflict", taken);
  };
  input.addEventListener("input", refresh);
  refresh();

  let disposed = false;
  return {
    refresh,
    conflict: () => taken,
    dispose() {
      if (disposed) return;
      disposed = true;
      input.removeEventListener("input", refresh);
      el.remove();
    },
  };
}
