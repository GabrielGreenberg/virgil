/**
 * `virgil:identity-cascade` — the IdentityCascade rollout flag (T1 Stages 2–3).
 *
 * The switch itself (default, accepted spellings, failure branches) is declared
 * once in `src/lib/feature-flags.ts`; this module is just the named door its
 * ~20 call sites already use. Flag OFF MUST preserve current behavior exactly —
 * every site that reads it keeps its legacy path intact.
 */
import { readFlag, setFlagOverride } from "@/lib/feature-flags";

/** True when the IdentityCascade behavior is enabled. Default OFF. */
export function isIdentityCascadeOn(): boolean {
  return readFlag("virgil:identity-cascade");
}

/** Force the flag (tests, or an explicit toggle). `undefined` clears it. */
export function setIdentityCascadeFlag(value: boolean | undefined): void {
  setFlagOverride("virgil:identity-cascade", value);
}
