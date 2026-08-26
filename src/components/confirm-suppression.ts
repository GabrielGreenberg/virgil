/**
 * "Don't show this again" — the SUPPRESSIBLE-CONFIRM capability, owned by the
 * confirm DOOR rather than by any dialog's caller.
 *
 * ## The class
 *
 * A confirm that guards a DELIBERATE, REVERSIBLE gesture is pure friction once
 * the user has read it. Two of them shipped:
 *
 *  - **archive-atom-marker** — "archiving this footnote removes its marker from
 *    your document". Reversible (unarchive returns the card).
 *  - **reanchor-margin-item** — "this note is anchored to a different paragraph.
 *    Re-anchor to this one?" raised at the end of a full drag, i.e. after the
 *    single most deliberate gesture in the app (Gabriel's report,
 *    2026-08-26).
 *
 * The first grew its OWN answer: a `suppressArchiveAtomWarning` field on
 * `ViewPrefs`, a hand-authored `<input type="checkbox">` inside one dialog's
 * `message`, and a hand-written `if (suppressed) { …; return; }` at the call
 * site. That is three copies of one idea in one caller — and the next confirm
 * that wants the option copies all three. So the capability lives HERE and a
 * confirm opts in with ONE field: `confirm({ …, suppressId })`.
 *
 * ## The rules
 *
 *  - **A DANGER confirm may never be suppressible.** `tone: "danger"` means the
 *    action destroys content without a net (STYLE_GUIDE, "the destructive /
 *    alarm family"); remembering "yes" for a destruction is exactly the trap
 *    task 386 removed from the keyboard, arriving through persistence instead.
 *    The refusal is stated ONCE, in the door: a danger confirm carrying a
 *    `suppressId` renders no checkbox, gates nothing, and `console.error`s in
 *    dev. It fails toward ASKING.
 *  - **A suppression may only be minted by the choice it suppresses.** Cancel
 *    with the box ticked persists NOTHING — an override's lifetime is the
 *    condition it overrides (task 395's mint rule). Ticking the box is a
 *    statement about the answer you are ABOUT to give, not about the dialog.
 *  - **It is never a one-way door.** Preferences renders a restore row whenever
 *    anything is suppressed, so the choice is always recoverable.
 *  - **The id set is a CLOSED union**, so a new suppressible confirm is a
 *    declaration (with a label the restore row can name) rather than a free
 *    string, and a dead id is visible to the census.
 *
 * Global, not per-window: "I have read this warning" is a fact about the user,
 * not about a window — which is also a repair, since the retired
 * `suppressArchiveAtomWarning` was window-scoped and had to be re-ticked in
 * every window. Cross-window sync rides the ONE `storage`-event door
 * (`subscribeToStorageKey`), per the cross-window-store law in AGENTS.md.
 */

import { useSyncExternalStore } from "react";
import { subscribeToStorageKey } from "@/lib/cross-window-storage";

/**
 * Every confirm that may be suppressed. A CLOSED union — adding one is a
 * declaration here plus a `suppressId` at the producer, and nothing else.
 */
export type SuppressibleConfirmId =
  | "reanchor-margin-item"
  | "archive-atom-marker";

/** Human names for the restore row. A `Record` over the union, so a new id
 *  cannot ship without one. */
export const SUPPRESSIBLE_CONFIRM_LABELS: Record<SuppressibleConfirmId, string> =
  {
    "reanchor-margin-item": "Re-anchor a margin item to a different paragraph",
    "archive-atom-marker": "Archive a footnote or citation card",
  };

export const SUPPRESSIBLE_CONFIRM_IDS = Object.keys(
  SUPPRESSIBLE_CONFIRM_LABELS,
) as SuppressibleConfirmId[];

const STORAGE_KEY = "virgil:suppressed-confirms";

/** The label of the checkbox the door renders. One string, so every
 *  suppressible confirm asks the same question the same way. */
export const SUPPRESS_CHECKBOX_LABEL = "Don't show this again";

const EMPTY: readonly SuppressibleConfirmId[] = Object.freeze([]);

function isId(x: unknown): x is SuppressibleConfirmId {
  return typeof x === "string" && x in SUPPRESSIBLE_CONFIRM_LABELS;
}

function readFromStorage(): readonly SuppressibleConfirmId[] {
  if (typeof window === "undefined") return EMPTY;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return EMPTY;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return EMPTY;
    // A retired id in a stored blob is dropped rather than carried: it can
    // never gate anything, and the restore row must not offer to un-hide a
    // dialog that no longer exists.
    const kept = parsed.filter(isId);
    return kept.length ? Object.freeze(kept) : EMPTY;
  } catch {
    return EMPTY;
  }
}

function writeToStorage(ids: readonly SuppressibleConfirmId[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...ids]));
  } catch {
    /* quota / private mode — a lost suppression only costs one more dialog */
  }
}

/**
 * Has this window's store ever been written?
 *
 * Read by the ONE-TIME fold that carries the retired per-window
 * `suppressArchiveAtomWarning` into this store (see `useViewPrefs.loadPrefs`).
 * Keying the fold on "the key is absent" makes it at-most-once by construction
 * with no second bookkeeping field: the moment the user ticks or restores
 * anything the key exists, so a later reload can never resurrect a suppression
 * they just cleared.
 */
export function confirmSuppressionsUntouched(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(STORAGE_KEY) === null;
  } catch {
    return false;
  }
}

// The single canonical snapshot. `useSyncExternalStore` needs referential
// stability: `getSnapshot` must return the SAME array until a real change.
let current: readonly SuppressibleConfirmId[] = readFromStorage();
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

// A peer window's tick must reach this window, or its snapshot goes stale and
// its next write clobbers the peer's from a stale base — the whole reason this
// contract has one home (AGENTS.md, "Cross-window store stability").
subscribeToStorageKey(STORAGE_KEY, () => {
  current = readFromStorage();
  emit();
});

export function subscribeConfirmSuppressions(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function getSuppressedConfirms(): readonly SuppressibleConfirmId[] {
  return current;
}

/** SSR snapshot — stable, so server and first client render agree. */
export function getSuppressedConfirmsServerSnapshot(): readonly SuppressibleConfirmId[] {
  return EMPTY;
}

/** Is this confirm currently suppressed? The ONE predicate; nothing re-derives
 *  it from storage. */
export function isConfirmSuppressed(id: SuppressibleConfirmId): boolean {
  return current.includes(id);
}

/** Remember "yes" for this confirm. Idempotent. */
export function suppressConfirm(id: SuppressibleConfirmId): void {
  if (current.includes(id)) return;
  current = Object.freeze([...current, id]);
  writeToStorage(current);
  emit();
}

/** Forget every remembered answer. WRITES an empty list rather than removing
 *  the key, so the one-time legacy fold above cannot re-run and resurrect a
 *  suppression the user has just cleared. */
export function restoreAllConfirms(): void {
  current = EMPTY;
  writeToStorage(current);
  emit();
}

/** Live snapshot for React. */
export function useSuppressedConfirms(): readonly SuppressibleConfirmId[] {
  return useSyncExternalStore(
    subscribeConfirmSuppressions,
    getSuppressedConfirms,
    getSuppressedConfirmsServerSnapshot,
  );
}

/** Test-only reset — clears the in-memory snapshot AND the stored blob. */
export function __resetConfirmSuppressionsForTest(): void {
  current = EMPTY;
  if (typeof window !== "undefined") {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }
  emit();
}
