/**
 * Feature flag for the "pending AI changes" behavior.
 *
 * `virgil:pending-changes` gates the suggestion-apply behavior: an AI
 * suggestion is spliced into the doc as a blue, revertable range (status
 * `applied`) that awaits an explicit "Keep", instead of landing immediately as
 * `accepted`.
 *
 * **Default ON** (graduated after the phased build landed + was verified). It
 * is now OPT-OUT: set `localStorage["virgil:pending-changes"] = "0"` to fall
 * back to the legacy accept-immediately path (the parity path the suite still
 * covers). Any value other than `"0"` — including unset — is ON.
 *
 * The legacy path is still fully preserved behind the `"0"` opt-out / an
 * override of `false`; no behavior was removed. Read at call time (not
 * memoized) so a test can flip it per-case via `setPendingChangesFlag`.
 */

const FLAG_KEY = "virgil:pending-changes";
/** The single opt-out sentinel — `"0"` in localStorage disables the feature. */
const OPT_OUT = "0";

/**
 * Test/runtime override. `undefined` → fall back to the localStorage value;
 * `true`/`false` → force the flag. A test sets this directly so it doesn't
 * depend on a jsdom `localStorage`; production never touches it.
 */
let override: boolean | undefined;

/** True when the pending-changes apply behavior is enabled. Default ON;
 *  opt out with `localStorage["virgil:pending-changes"] = "0"`. */
export function isPendingChangesOn(): boolean {
  if (override !== undefined) return override;
  // Client-only UI (the editor never SSR-renders its content), so the no-window
  // branch is inconsequential; keep it OFF to avoid any hydration surprise.
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(FLAG_KEY) !== OPT_OUT;
  } catch {
    // localStorage inaccessible → honor the default (ON).
    return true;
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
