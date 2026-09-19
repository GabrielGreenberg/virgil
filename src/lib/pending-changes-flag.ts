/**
 * `virgil:pending-changes` — the "pending AI changes" rollout flag.
 *
 * Gates the suggestion-apply behavior: an AI suggestion is spliced into the doc
 * as a blue, revertable range (status `applied`) awaiting an explicit "Keep",
 * instead of landing immediately as `accepted`.
 *
 * **Default ON** (graduated after the phased build landed and was verified);
 * the localStorage key is the OPT-OUT back to the legacy accept-immediately
 * path, which the suite still covers. Declared in `src/lib/feature-flags.ts`.
 */
import { readFlag, setFlagOverride } from "@/lib/feature-flags";

/** True when the pending-changes apply behavior is enabled. Default ON. */
export function isPendingChangesOn(): boolean {
  return readFlag("virgil:pending-changes");
}

/** Force the flag (tests, or an explicit toggle). `undefined` clears it. */
export function setPendingChangesFlag(value: boolean | undefined): void {
  setFlagOverride("virgil:pending-changes", value);
}
