/**
 * Feature flag for the "pending AI changes" rollout (Phase 1a groundwork).
 *
 * `virgil:pending-changes` (localStorage, default OFF) gates the NEW
 * suggestion-apply behavior: an accepted AI suggestion is spliced into the
 * doc as a blue, revertable range (status `applied`) that awaits an explicit
 * "Keep", instead of landing immediately as `accepted`. It can be A/B'd in the
 * preview and rolled back if a regression surfaces.
 *
 * **Flag OFF MUST preserve current behavior exactly** — every site that reads
 * this flag keeps its legacy path intact so the existing suite stays green; no
 * card ever reaches the `applied`/`stale` statuses without the flag-ON apply
 * path. Read at call time (not memoized) so a test can flip it per-case via
 * `setPendingChangesFlag`. Mirrors the `virgil:force-dev-storage` opt-in
 * convention (a string `"1"` in `localStorage`).
 */

const FLAG_KEY = "virgil:pending-changes";

/**
 * Test/runtime override. `undefined` → fall back to the localStorage value;
 * `true`/`false` → force the flag. A test sets this directly so it doesn't
 * depend on a jsdom `localStorage`; production never touches it.
 */
let override: boolean | undefined;

/** True when the pending-changes apply behavior is enabled. Default OFF. */
export function isPendingChangesOn(): boolean {
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
export function setPendingChangesFlag(value: boolean | undefined): void {
  override = value;
}
