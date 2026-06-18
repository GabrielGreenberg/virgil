/**
 * Feature flag for the IdentityCascade rollout (T1 Stages 2–3).
 *
 * `virgil:identity-cascade` (localStorage, default OFF) gates the NEW
 * identity behavior so it can be A/B'd in the preview and rolled back if a
 * regression surfaces (PLAN.md §6, T1 §9 de-risking):
 *
 *  - sidecars (annotations / bib-review) re-key on `BibEntry.uid` instead of
 *    the renameable citekey, with a non-destructive orphan-bucket migration;
 *  - a citekey rename routes through `IdentityCascade.runIdentityChange` (the
 *    single writer) which also rewrites every `\cite{oldKey}` in the editor
 *    doc (incl. footnote-nested cites) so the panel patch survives a re-sync.
 *
 * **Flag OFF MUST preserve current behavior exactly** — every site that reads
 * this flag keeps its legacy path intact so the existing suite stays green.
 * Read at call time (not memoized) so a test can flip it per-case via
 * `setIdentityCascadeFlag`. Mirrors the `virgil:force-dev-storage` opt-in
 * convention (a string `"1"` in `localStorage`).
 */

const FLAG_KEY = "virgil:identity-cascade";

/**
 * Test/runtime override. `undefined` → fall back to the localStorage value;
 * `true`/`false` → force the flag. A test sets this directly so it doesn't
 * depend on a jsdom `localStorage`; production never touches it.
 */
let override: boolean | undefined;

/** True when the IdentityCascade behavior is enabled. Default OFF. */
export function isIdentityCascadeOn(): boolean {
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
export function setIdentityCascadeFlag(value: boolean | undefined): void {
  override = value;
}
