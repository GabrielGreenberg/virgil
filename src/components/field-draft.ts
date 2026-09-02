"use client";

/**
 * A FIELD WHOSE VALUE IS OWNED ELSEWHERE HOLDS A DRAFT, COMMITS ON A STATED
 * EDGE, AND RECONCILES FROM THE SOURCE WHILE IT IS NOT DIRTY (task 532).
 *
 * Virgil is full of fields that edit a value some OTHER thing owns — a
 * `localStorage` preference store, a sidecar record, a ProseMirror node attr.
 * Such a field needs three things, and every one of Virgil's had at least one
 * of them and at least one site was missing another:
 *
 *  1. **A DRAFT.** The user's intermediate keystrokes are not the value. A
 *     hex box passes through `#`, `#c4`, a 5-char partial and the result of a
 *     backspace on the way to `#c45a5a`, and NONE of those is a color. A field
 *     that writes the source directly from `onChange`, gated on the value
 *     already being complete, does not merely reject the partials — under
 *     React's controlled-input contract it is **not typeable at all**:
 *     `restoreControlledState` resets `node.value` back to the source after the
 *     event batch, so every keystroke visibly disappears. That was
 *     `SmartPreferences`' panel-typography hex box, which could only be
 *     PASTED into, and only with a leading `#`.
 *
 *  2. **A COMMIT EDGE, and a GUARD on it.** A commit that would change nothing
 *     must not happen. This is not tidiness: the owner's setter routinely has
 *     side effects beyond the value — `useTodos.updateItem` also sets
 *     `titleAuto: false` and `pristine.markDirty(id)`, and the two source-pod
 *     title writers dispatch a `setNodeMarkup` transaction (an undo step and an
 *     autosave arm). `CardTitleInput`'s blur write was unconditional, so a bare
 *     **focus+blur that changed nothing** permanently flipped a todo's title
 *     provenance and un-pristined a brand-new empty todo; `FloatTitleField`'s
 *     did the same to the main document. `SourcePodNodeView.setTitle` already
 *     stated the rule in prose at its own setter — one site of four.
 *
 *  3. **A RECONCILIATION RULE.** The source can move while the field is
 *     mounted: an `/editor/*` skill run, a second Virgil window, the sidecar
 *     watcher (task 432 established it IS mounted), a main-document
 *     transaction reaching a float. Panels key rows by id, so the row
 *     re-renders **in place** and an uncontrolled input keeps its old DOM
 *     value — the card shows the stale title AND the next blur writes it back
 *     over the external change. The rule is not "adopt the source": it is
 *     **adopt the source WHILE THE DRAFT IS NOT DIRTY**, so a mid-edit buffer
 *     is preserved and wins on commit.
 *
 * ## The dirty test needs `lastSynced`, not the live source
 *
 * The tempting predicate — dirty ⇔ `draft !== source` — is wrong in exactly
 * the case reconciliation exists for. A clean field showing "old" whose source
 * has just become "xyz" reads as DIRTY by that test and is never reconciled.
 * So the hook keeps `lastSynced`: the value this field last ADOPTED FROM or
 * WROTE TO the source. Dirty ⇔ `draft !== lastSynced`. `TodoRow`'s notes
 * textarea reached the same answer by hand in task 102 (`lastCommittedRef`);
 * this is that ref, published once.
 *
 * The COMMIT guard is a different comparison and deliberately so: it asks
 * whether writing would change anything, so it compares against the **live
 * source**. (`CardBodyTitle`'s hand-written `if (v !== (value ?? "")) onChange(v)`
 * is exactly that, and is preserved byte-for-byte through the door.)
 *
 * ## Normalize BEFORE you commit
 *
 * A field that normalizes — a hex box auto-prefixing `#`, a title trimming
 * whitespace — passes the NORMALIZED value to `commit`, and the hook writes it
 * back into the draft. Two things follow, both load-bearing: the guard
 * compares like with like (a draft of `"A "` against a source of `"A"` is not
 * a change), and the draft cannot be left holding a spelling that differs from
 * what was stored, which would make the field permanently dirty and therefore
 * permanently unreconcilable.
 *
 * ## Where the draft LIVES is the caller's business
 *
 * Two media, one rule. A CONTROLLED field keeps its draft in React state
 * (`readDraft: () => draft`, `writeDraft: setDraft`); an UNCONTROLLED one IS
 * its DOM node (`readDraft: () => ref.current?.value`, `writeDraft` assigning
 * `el.value`). The hook owns the rule and knows nothing about the medium,
 * which is what lets one door serve `HexColorField`, `TodoRow`'s notes
 * textarea and all four uncontrolled title inputs.
 *
 * `readDraft` returning `undefined` means there is no draft to read — the
 * element is unmounted. Reconciliation then adopts the source into `lastSynced`
 * WITHOUT writing anything: with no element there is no user edit in flight to
 * protect, and leaving `lastSynced` behind is what would make the input read as
 * dirty the moment it re-mounts (`CardBodyTitle` unmounts its input whenever
 * the title is empty, so that is an ordinary path, not an edge case).
 *
 * ## The reconcile runs after EVERY render, on purpose
 *
 * The rule is a RELATION between two values, not an event, so it is asserted
 * after every render rather than keyed on a guessed dependency list. That is
 * not a shortcut: `TodoRow`'s hand-written copy needed BOTH `[item.notes,
 * notes]` in its deps — the draft as well as the source — because reverting a
 * local edit back to the committed value is what lets a pending external change
 * through, and the uncontrolled sites have no React-visible draft to name in a
 * dep list at all. Asking after every render is the only formulation that is
 * correct for both media. It costs two comparisons.
 *
 * ## Not a replacement for `useFieldEditSession`
 *
 * That hook (task 529) answers a different question — WHICH ENDING happened,
 * commit or cancel, when a synchronous `.blur()` fires both. The two compose:
 * `CardBodyTitle` and `SourcePodNodeView` take both, the session deciding
 * whether the commit runs at all and the draft deciding what it commits and
 * whether it would change anything.
 */

import { useEffect, useMemo, useRef } from "react";

export interface FieldDraftOptions<T> {
  /** The value owned elsewhere — the preference store, the sidecar record, the
   *  node attr. Read fresh on every render. */
  source: T;
  /**
   * Read the live draft, or `undefined` when there is none (the element is
   * unmounted). Never `?? ""` — a default read as a draft is how a field
   * commits an empty string over a value the user never touched
   * (`commitLiveValue`'s rule in `field-edit-session.ts`, one door over).
   */
  readDraft: () => T | undefined;
  /** Adopt `next` into the draft — `setState`, or an assignment to
   *  `el.value`. Must tolerate being called with no element. */
  writeDraft: (next: T) => void;
  /** Value comparison. Defaults to `Object.is`. */
  equals?: (a: T, b: T) => boolean;
}

export interface FieldDraft<T> {
  /** True while the user has an uncommitted edit in flight. A field with no
   *  readable draft is never dirty — there is nothing to protect. */
  isDirty(): boolean;
  /**
   * Commit `next` (already NORMALIZED by the caller) through `apply`, unless
   * it already equals the source — in which case writing would change nothing
   * and `apply` must not run, because the owner's setter has side effects
   * beyond the value.
   *
   * Either way the draft is normalized to `next` and the field becomes clean.
   * Returns whether `apply` ran: THE REPORT IS THE PERMISSION — a caller that
   * must know cannot infer it from the absence of a throw.
   */
  commit(next: T, apply: (value: T) => void): boolean;
  /** The CANCEL edge: adopt the source unconditionally, discarding the draft. */
  revert(): void;
  /**
   * Adopt the source into the draft when the draft is clean. Run by the hook's
   * own effect after every render; exposed for a field that must also
   * reconcile on some other edge.
   */
  reconcile(): void;
}

export function useFieldDraft<T>(options: FieldDraftOptions<T>): FieldDraft<T> {
  // The latest props, read at effect and event time. Updated by an effect
  // declared BEFORE the reconcile effect, so within one flush the reconcile
  // always sees the render it belongs to; event handlers fire after both.
  const latest = useRef(options);
  useEffect(() => {
    latest.current = options;
  });

  /** The value this field last adopted from, or wrote to, the source. */
  const lastSynced = useRef(options.source);
  /** Was there a draft to read at the previous reconcile? An uncontrolled
   *  field's element comes and goes (`CardBodyTitle` renders a `+T` button
   *  instead whenever the title is empty), and a draft that has just APPEARED
   *  was SEEDED from the source by `defaultValue` — it is a sync point, not an
   *  edit. Without this the re-mounted input reads as permanently dirty
   *  against a `lastSynced` left behind while it was gone, and never
   *  reconciles again. */
  const hadDraft = useRef(false);

  // Stable identity so a consumer may hold it across renders and name it in a
  // `useCallback` dep list without churn — the shape `useFieldEditSession`
  // takes, and for the same reason: a per-render object is easy to capture
  // stale, and a stale draft answers about a source that has moved.
  const api = useMemo<FieldDraft<T>>(() => {
    const eq = (a: T, b: T) => (latest.current.equals ?? Object.is)(a, b);
    const setDraft = (next: T) => {
      const cur = latest.current.readDraft();
      if (cur !== undefined && eq(cur, next)) return;
      latest.current.writeDraft(next);
    };
    return {
      isDirty() {
        const draft = latest.current.readDraft();
        return draft !== undefined && !eq(draft, lastSynced.current);
      },
      commit(next, apply) {
        const { source } = latest.current;
        lastSynced.current = next;
        setDraft(next);
        if (eq(next, source)) return false;
        apply(next);
        return true;
      },
      revert() {
        const { source } = latest.current;
        lastSynced.current = source;
        setDraft(source);
      },
      reconcile() {
        const { source, readDraft } = latest.current;
        const draft = readDraft();
        if (draft === undefined) {
          // No element ⇒ no draft ⇒ nothing to protect and nothing to write.
          hadDraft.current = false;
          return;
        }
        if (!hadDraft.current) {
          // Just appeared: whatever it holds is what `defaultValue` gave it.
          hadDraft.current = true;
          lastSynced.current = draft;
        }
        if (!eq(draft, lastSynced.current)) return; // dirty — the user's edit wins
        if (eq(source, lastSynced.current)) return; // nothing new
        lastSynced.current = source;
        latest.current.writeDraft(source);
      },
    };
  }, []);

  useEffect(() => {
    api.reconcile();
  });

  return api;
}
