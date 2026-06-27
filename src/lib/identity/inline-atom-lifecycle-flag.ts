/**
 * Feature flag for the inline-atom lifecycle rollout (T2 Wave 2).
 *
 * `virgil:inline-atom-lifecycle` (localStorage, default OFF) gates the
 * bus-driven `useInlineAtomLifecycle` reconciler so it can be A/B'd in the
 * preview and rolled back if a regression surfaces (PLAN.md §6, T2 §9
 * de-risking). When ON, that one reconciler upserts/clears the orphan record,
 * prunes the `cardStore`/`poppedOutCards` refs, and replaces the
 * `virgil-footnote-orphaned/-suppress-orphan/-panel-dropped` event web (W2b —
 * registers as a POLICY on the single identity bus consumer, NOT a new
 * `editor.on('update')` subscriber).
 *
 * NOTE — what the flag does NOT gate any more: the per-doc orphan STORE itself
 * (`useOrphanedFootnotes(docId)`) is now the single store on BOTH paths,
 * UNCONDITIONALLY (the design's low-risk step 2, un-bundled from the gated
 * reconciler). It lives under the `<DocPipeline>` boundary so orphans survive a
 * reload and never bleed across documents (FN-A2-01, FN-A2-03), regardless of
 * this flag. Flag OFF, the legacy event web — now mounted PER-PANE and routed by
 * the event's originating docId (`useFootnoteOrphanBridges`) — writes that
 * store; flag ON, the reconciler does. Only the WRITER differs by flag.
 *
 * **Flag OFF MUST preserve current behavior exactly** — every site that reads
 * this flag keeps its legacy path intact so the existing suite stays green.
 * Read at call time (not memoized) so a test can flip it per-case via
 * `setInlineAtomLifecycleFlag`. Mirrors the `virgil:identity-cascade`
 * convention (a string `"1"` in `localStorage`).
 */

const FLAG_KEY = "virgil:inline-atom-lifecycle";

/**
 * Test/runtime override. `undefined` → fall back to the localStorage value;
 * `true`/`false` → force the flag. A test sets this directly so it doesn't
 * depend on a jsdom `localStorage`; production never touches it.
 */
let override: boolean | undefined;

/** True when the inline-atom-lifecycle behavior is enabled. Default OFF. */
export function isInlineAtomLifecycleOn(): boolean {
  if (override !== undefined) return override;
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(FLAG_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * Force the flag (tests, or an explicit toggle). Pass `undefined` to clear the
 * override and fall back to localStorage. Tests call this in `beforeEach` /
 * `afterEach` to exercise both the flag-ON and the flag-OFF parity paths.
 */
export function setInlineAtomLifecycleFlag(value: boolean | undefined): void {
  override = value;
}
