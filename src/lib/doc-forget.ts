/**
 * DOC FORGET — the IN-MEMORY half of `purgeDoc`'s census (task 1465).
 *
 * `purgeDoc` (doc-index.ts) is the ONE door for "this document's identity is
 * being removed or reset". Its durable half is a short list it owns (IndexedDB
 * rows). Its in-memory half used to be a hand-written list too, and a list is
 * only as complete as the last person who remembered it: task 1277 moved the
 * compile RESULT (log, diagnostics, PDF bytes) into a module-level per-doc map
 * that the list never named, so "Reset example" — which re-seeds under the
 * SAME fixed id — reopened the pristine paper showing the discarded version's
 * PDF, marked up to date.
 *
 * So the census is inverted: each module that holds per-doc state registers
 * its OWN forget here, at module scope, beside the map it forgets. A module
 * never imported this session has registered nothing — and holds nothing, so
 * there is nothing to forget. Which module-level maps must register (and which
 * are deliberately excluded, with their reason) is enforced by
 * `doc-forget-census.test.ts`, so the next per-doc store cannot be added
 * outside the census.
 */

/** Why the identity is going: removed for good, or reset under the same id. */
export type DocForgetMode = "remove" | "reset";

type Forget = (docId: string, mode: DocForgetMode) => void;

const forgets = new Map<string, Forget>();

/**
 * Register a store's forget. Keyed by `name`, so a module re-evaluated (HMR,
 * a test's `vi.resetModules`) replaces its entry rather than stacking a
 * second one against a dead map.
 */
export function registerDocForget(name: string, forget: Forget): void {
  forgets.set(name, forget);
}

/**
 * Run every registered forget for `docId`. One store's throw must not leave
 * the rest — or `purgeDoc`'s durable half — holding the old identity's state,
 * so each runs in isolation and a failure is logged, never propagated.
 */
export function forgetDocInMemory(docId: string, mode: DocForgetMode): void {
  for (const [name, forget] of forgets) {
    try {
      forget(docId, mode);
    } catch (err) {
      console.error(`[doc-forget] ${name} failed for ${docId}:`, err);
    }
  }
}

