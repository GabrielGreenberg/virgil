/**
 * The SETTLE obligation's MEMBERSHIP — "which card kinds own a live in-document
 * splice that would outlive the card record" — plus the shapes the executor's
 * fourth obligation trades in.
 *
 * WHY THIS IS ITS OWN LEAF. A `status:"applied"` revision/cutter suggestion
 * carries an `appliedChange` descriptor that binds a REAL range in the document
 * (the light-blue `pending-ai-change` mark). That binding is not a field on the
 * card — it is state the card *manages*. So any lifecycle event that ends the
 * record (a morph to a shape with no `appliedChange`, a delete) must settle the
 * splice first, or the range is orphaned: `isAppliedPending`
 * (`pending-change-collect.ts`) requires `kind==="suggestion" && status===
 * "applied" && appliedChange`, so after the event Keep/Revert can no longer
 * resolve the range, and on reload `reapply-pending-marks` skips the record and
 * the orphan reaper strips the mark (2026-07-27-238).
 *
 * MEMBERSHIP IS DERIVED, NOT ENUMERATED. The set of kinds that can own a splice
 * is exactly `PendingChangeFamily` — the union `apply-suggestion.ts` already
 * uses to tag every mark it stamps. So this module keys a `Record` on that
 * union rather than hand-listing kinds: a third family member added there and
 * left unwired here is a COMPILE error, not a silent orphan (the same
 * derived-obligation discipline as `buildInlineAtomCardApis`, task 233). The
 * `kind is PendingChangeFamily` narrowing additionally pins that every family
 * member really is a `CardKind`.
 *
 * PURE. No React, no editor, no registry — importable by the executor, by
 * EditorPane's wiring, and by tests without pulling any of them in.
 */

import type { CardKind } from "../types";
import type { PendingChangeFamily } from "@/links/apply-suggestion";

/** The kinds whose records own a live in-document splice. Keyed on
 *  `PendingChangeFamily` so a new family member must be wired here to compile. */
const APPLIED_SPLICE_KINDS: Record<PendingChangeFamily, true> = {
  "revision-suggestion": true,
  "cutter-suggestion": true,
};

/** True iff `kind`'s record can own a live applied splice (a `status:"applied"`
 *  card with an `appliedChange`). Narrows to `PendingChangeFamily`, which is
 *  also the compile-time proof that every family member is a real `CardKind`. */
export function ownsAppliedSplice(kind: CardKind): kind is PendingChangeFamily {
  return Object.prototype.hasOwnProperty.call(APPLIED_SPLICE_KINDS, kind);
}

/** The kinds that own a splice, as a readonly list — for coverage tests and
 *  any surface that needs to iterate the set rather than test one kind. */
export const APPLIED_SPLICE_KIND_LIST: readonly PendingChangeFamily[] =
  Object.keys(APPLIED_SPLICE_KINDS) as PendingChangeFamily[];

/** How the user chose to settle a live splice before the card record ends. */
export type AppliedSpliceResolution = "keep" | "revert";

/** The minimum the executor needs to know about a live splice: which range it
 *  binds, and which direction it was spliced (so the prompt copy can be honest
 *  about what is actually sitting in the document). A superset of what
 *  `AppliedChangeDescriptor` carries — the ops bag narrows it. */
export interface AppliedSpliceSummary {
  anchorId: string;
  mode: "replace" | "delete";
}

/** The generated settle-prompt copy (built by `run-event.ts` from the declared
 *  registry labels + the splice mode, never hand-mirrored per call site — the
 *  same rule `morphConfirmMessage` follows). Three-way: keep / revert / cancel,
 *  where cancel abandons the whole lifecycle event. */
export interface AppliedSpliceSettlePrompt {
  title: string;
  message: string;
  keepLabel: string;
  revertLabel: string;
  cancelLabel: string;
}

/** The injected SETTLE obligation. The host (EditorPane) wires `get` to the
 *  live card list, `ask` to the three-way confirm dialog, and `settle` to the
 *  `pending-change-actions` SSOT. Kind-agnostic by design: it takes the kind as
 *  an argument, so no per-kind wiring exists to forget. */
export interface AppliedSpliceOps {
  /** The live splice this card owns, or null (not applied / already settled /
   *  pending-changes flag off). */
  get: (kind: PendingChangeFamily, id: string) => AppliedSpliceSummary | null;
  /** Ask the user how to settle. Resolves null when they cancel — which cancels
   *  the ENTIRE lifecycle event, not just the settlement. */
  ask: (prompt: AppliedSpliceSettlePrompt) => Promise<AppliedSpliceResolution | null>;
  /** Land the settlement in the document + clear the card's descriptor. Awaited,
   *  so the mutation that follows sees a record with no live splice.
   *
   *  RETURNS FALSE WHEN IT COULD NOT ACT — no editor mounted, no doc to splice.
   *  The executor then ABORTS the lifecycle event rather than proceeding, because
   *  proceeding is the original bug: the record would end with the range still
   *  live and nothing left to manage it. Refusing is the same rule the inline-atom
   *  rebuild follows (task 233) — a step that can't do its job declines instead of
   *  falling back to the lossy shape. */
  settle: (
    kind: PendingChangeFamily,
    id: string,
    resolution: AppliedSpliceResolution,
  ) => boolean | Promise<boolean>;
}
