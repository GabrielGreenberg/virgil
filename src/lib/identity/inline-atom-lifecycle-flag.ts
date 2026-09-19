/**
 * `virgil:inline-atom-lifecycle` — the inline-atom lifecycle rollout flag
 * (T2 Wave 2). When ON, one bus-driven reconciler upserts/clears the footnote
 * orphan record, prunes the `cardStore`/`poppedOutCards` refs, and replaces the
 * `virgil-footnote-orphaned/-suppress-orphan/-panel-dropped` event web — as a
 * POLICY on the single identity-bus consumer, not a new `editor.on('update')`
 * subscriber.
 *
 * NOTE — what the flag does NOT gate: the per-doc orphan STORE itself
 * (`useOrphanedFootnotes(docId)`) is the single store on BOTH paths,
 * unconditionally. Only the WRITER differs by flag: OFF, the legacy per-pane
 * event bridges write it; ON, the reconciler does.
 *
 * **This flag REQUIRES `virgil:identity-cascade`** — the reconciler can only
 * register on the consumer the cascade flag creates, so ON-without-the-parent
 * used to silence BOTH writers and drop the orphan record. That dependency is
 * declared on the registry row in `src/lib/feature-flags.ts` and enforced by
 * `readFlag`, so this reads OFF (with a dev warning) unless the parent is on.
 */
import { readFlag, setFlagOverride } from "@/lib/feature-flags";

/** True when the inline-atom-lifecycle behavior is enabled. Default OFF, and
 *  OFF regardless whenever `virgil:identity-cascade` is off. */
export function isInlineAtomLifecycleOn(): boolean {
  return readFlag("virgil:inline-atom-lifecycle");
}

/** Force the flag (tests, or an explicit toggle). `undefined` clears it.
 *  Forcing it ON does not escape the `identity-cascade` requirement. */
export function setInlineAtomLifecycleFlag(value: boolean | undefined): void {
  setFlagOverride("virgil:inline-atom-lifecycle", value);
}
