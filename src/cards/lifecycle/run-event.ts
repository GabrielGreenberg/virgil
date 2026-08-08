"use client";

/**
 * `runCardLifecycleEvent` — the single executor for a card's destructive /
 * transforming lifecycle events (T4 §3.3). Replaces the open-coded bodies of
 * the morph chokepoint (`convertCardWithRemap`) and centralizes the four
 * obligations a lifecycle event incurs, each read from the declared contract
 * rather than re-derived per call site:
 *
 *   1. CONFIRM  — built from `CARD_REGISTRY[kind].morph.drops` (morph) so the
 *      copy can never be direction-blind or lie (REP-F6-03), and from
 *      `cardHasContent` (delete) so every kind's content is seen (W2d-2).
 *   2. SETTLE   — when the ending record OWNS a live in-document splice (a
 *      `status:"applied"` suggestion's `appliedChange` → the blue
 *      `pending-ai-change` range), resolve that splice — keep or revert — BEFORE
 *      the mutation, so no range can survive its manager (2026-07-27-238). See
 *      "the third state class" below.
 *   3. UNBRIDGE — when the event DROPS aiRequest (a delete of an aiRequest-
 *      bearing kind, or a morph whose `drops` includes "aiRequest"), clear the
 *      pending `ai-requests.json` entry in the SAME logical step — so a
 *      report-request→report morph (or a delete of a flagged report-request)
 *      never strands a phantom inbox entry (REP-F5-01 / REP-F6-01 / REP-F7-02 /
 *      REP-F8-01 / OMNI-F6-01).
 *   4. SIGNAL   — publish ONE `card-deleted` / `card-morphed` signal (the D6
 *      seam) that W2b's reconciler consumes to prune / re-key `cardStore`
 *      (REP-F6-02 / OMNI-F6-02 for the sidecar kinds).
 *
 * THE THIRD STATE CLASS. The obligations above exist because a lifecycle event
 * ends a record that other stores still reference. Three carriers of that class
 * have now been closed at this one chokepoint: the record ENVELOPE (`archived`,
 * task 072), a TEXT FIELD the target shape can't hold (`explanation`, task 199),
 * and — the deepest — a LIVE DOCUMENT SPLICE (task 238). The first two are card
 * data; the third is a range in the user's `.tex`, so dropping it is not a lost
 * field but an unrevertable edit: `isAppliedPending` stops resolving the range
 * (Keep/Revert unreachable), and on reload `reapply-pending-marks` skips the
 * record and the orphan reaper strips the mark. Merely declaring `appliedChange`
 * in `morph.drops` would surface a confirm and STILL leave the range unresolved
 * — the obligation has to settle it, which is why SETTLE is a distinct step and
 * not a `drops` entry. It applies to DELETE as well as morph: both end the
 * record, so both orphan the range.
 *
 * The actual data mutation (the per-doc sidecar `convertCard` / `delete`) and
 * the float-key remap stay with the caller (`convertCardWithRemap` in
 * EditorPane), which owns the per-doc hooks; the executor orchestrates the
 * cross-store obligations around them. It is PURE (no React, no editor) and
 * unit-testable with plain stubs.
 *
 * KEYSTROKE SANCTITY: runs only on an explicit user lifecycle action (trash /
 * kind-chevron click), never per transaction.
 */

import { CARD_REGISTRY } from "../card-registry";
import type { CardKind } from "../types";
import { publishCardDeleted, publishCardMorphed } from "./card-lifecycle-signal";
import {
  ownsAppliedSplice,
  type AppliedSpliceOps,
  type AppliedSpliceSettlePrompt,
  type AppliedSpliceSummary,
} from "./applied-splice";
import type { PendingChangeFamily } from "@/links/apply-suggestion";

/** The injected obligations the executor discharges. The caller (EditorPane)
 *  wires these to the live confirm dialog, the ai-request bridge, and the
 *  per-doc hook ops. */
export interface CardLifecycleDeps {
  /** Show a confirm dialog; resolves true to proceed. */
  confirm: (opts: {
    title?: string;
    message: string;
    confirmLabel?: string;
    cancelLabel?: string;
    tone?: "default" | "danger";
  }) => Promise<boolean>;
  /** Clear the pending `ai-requests.json` entry for an aiRequest-bearing card.
   *  Called with the kind that HAS the routing (the FROM kind on a lossy morph,
   *  the deleted kind on a delete). A no-op if there's no open entry. */
  unbridgeAiRequest: (kind: CardKind, id: string) => void | Promise<void>;
  /** Perform the data mutation (the per-doc hook op). Awaited so the signal /
   *  remap that follow see the post-mutation state. */
  mutate: () => void | Promise<void>;
  /** The SETTLE obligation (obligation 2). OPTIONAL: a host with no
   *  pending-change wiring — a test, or the flag-OFF path where no card can
   *  ever reach `status:"applied"` — omits it and the step is skipped entirely
   *  (byte-identical to pre-238 behaviour). When present it is consulted for
   *  EVERY event whose kind `ownsAppliedSplice`, so no per-kind wiring exists
   *  to forget. */
  appliedSplice?: AppliedSpliceOps;
}

export type LifecycleEvent =
  | { type: "delete"; kind: CardKind; id: string; hasContent: boolean }
  | { type: "morph"; fromKind: CardKind; id: string };

/**
 * Build the generated morph-confirm copy from the declared `drops` set — never
 * hand-mirrored, so it can't drift from the salvage (REP-F6-03). Returns null
 * when nothing drops (a non-lossy morph needs no confirm).
 */
export function morphConfirmMessage(fromKind: CardKind): {
  title: string;
  message: string;
  confirmLabel: string;
} | null {
  const morph = CARD_REGISTRY[fromKind].morph;
  if (!morph || morph.drops.length === 0) return null;
  const toLabel = CARD_REGISTRY[morph.to].label;
  // Human-readable phrase for the dropped fields, generated from `drops`.
  const phrase = describeDrops(morph.drops);
  return {
    title: `Change to ${toLabel}?`,
    message: `This drops ${phrase} (a ${toLabel} can't hold ${
      morph.drops.length > 1 ? "them" : "it"
    }); the text anchor stays. Continue?`,
    confirmLabel: `Make it a ${toLabel}`,
  };
}

/** Render a `drops` set as an English clause. Stable, deterministic ordering
 *  follows the declared array order so the copy is reproducible. */
function describeDrops(drops: readonly string[]): string {
  const LABELS: Record<string, string> = {
    title: "the title",
    byline: "the author byline",
    aiRequest: "the AI-request flag",
    body: "the body",
    keys: "the cite keys",
    formatting: "the rich formatting — citations, math, and lists",
  };
  const parts = drops.map((d) => LABELS[d] ?? d);
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
}

/**
 * Build the SETTLE prompt from declared facts — the registry labels either side
 * of the morph, and the splice's own `mode` — so the copy can no more lie about
 * what is sitting in the document than `morphConfirmMessage` can lie about what
 * a morph drops. Three-way: keep / revert / cancel.
 *
 * Exported for the contract test (and so a surface that wants to preview the
 * copy doesn't re-spell it).
 */
export function appliedSpliceSettleMessage(
  event: "morph" | "delete",
  fromKind: PendingChangeFamily,
  splice: AppliedSpliceSummary,
): AppliedSpliceSettlePrompt {
  // What is ACTUALLY in the document right now — the two splice modes leave
  // visibly different state, and a user deciding "keep or revert" needs the
  // difference (a pending delete looks untouched but struck).
  const state =
    splice.mode === "delete"
      ? "the marked text is struck for deletion but still there"
      : "the suggested text has replaced the original";
  // The affirmative button carries out what the card PROPOSED, which in delete
  // mode means removing the text — so name it. "Keep the change" is true for
  // both modes but reads as "keep the words" over a pending deletion, and this
  // button is the one that can't be undone by a second glance.
  const keepLabel =
    splice.mode === "delete" ? "Keep the deletion" : "Keep the change";
  const morph = CARD_REGISTRY[fromKind].morph;
  if (event === "morph" && morph) {
    const toLabel = CARD_REGISTRY[morph.to].label;
    return {
      title: `Change to ${toLabel}?`,
      message: `This change is still live in your document — ${state}. A ${toLabel} can't manage it, so settle it first.`,
      keepLabel,
      revertLabel: "Revert to original",
      cancelLabel: "Cancel",
    };
  }
  const label = CARD_REGISTRY[fromKind].label;
  return {
    title: `Delete this ${label.toLowerCase()}?`,
    message: `Its change is still live in your document — ${state}. Deleting the card leaves nothing to manage it, so settle it first.`,
    keepLabel,
    revertLabel: "Revert to original",
    cancelLabel: "Cancel",
  };
}

/**
 * Obligation 2 — SETTLE. Returns false when the event must NOT proceed, which
 * cancels it whole (nothing mutated, nothing signalled). Two ways that happens,
 * and they are the same judgement: the splice is still live and we are not
 * allowed to end the record over it.
 *
 *   - the user CANCELLED the prompt ("I don't want to decide yet"), or
 *   - `settle` REFUSED — it could not act (no editor mounted), so proceeding
 *     would leave exactly the orphan this obligation exists to prevent.
 *
 * Skipped in three ways, each a genuine no-op rather than a silent pass:
 * no ops bag injected, a kind that can't own a splice (`ownsAppliedSplice`), or
 * a card that owns none right now (never applied / already kept or reverted).
 */
async function settleAppliedSplice(
  ev: LifecycleEvent,
  deps: CardLifecycleDeps,
): Promise<boolean> {
  const ops = deps.appliedSplice;
  if (!ops) return true;
  const kind = ev.type === "morph" ? ev.fromKind : ev.kind;
  if (!ownsAppliedSplice(kind)) return true;
  const splice = ops.get(kind, ev.id);
  if (!splice) return true;
  const resolution = await ops.ask(
    appliedSpliceSettleMessage(ev.type, kind, splice),
  );
  if (!resolution) return false;
  return await ops.settle(kind, ev.id, resolution);
}

/**
 * Run one card lifecycle event end-to-end. Returns true iff the event committed
 * (false on a user-cancelled confirm OR a cancelled settlement), so the caller
 * can short-circuit any follow-up (e.g. the float-key remap on morph).
 */
export async function runCardLifecycleEvent(
  ev: LifecycleEvent,
  deps: CardLifecycleDeps,
): Promise<boolean> {
  if (ev.type === "morph") {
    const morph = CARD_REGISTRY[ev.fromKind].morph;
    if (!morph) return false; // non-morphing kind — defensive no-op

    // 1. CONFIRM (generated from drops).
    const copy = morphConfirmMessage(ev.fromKind);
    if (copy) {
      const ok = await deps.confirm({
        title: copy.title,
        message: copy.message,
        confirmLabel: copy.confirmLabel,
        cancelLabel: "Keep as is",
        tone: "default",
      });
      if (!ok) return false;
    }

    // 2. SETTLE — resolve any live in-document splice this record owns BEFORE
    //    the kind flips, so the range can never outlive its manager (238).
    if (!(await settleAppliedSplice(ev, deps))) return false;

    // 3. UNBRIDGE — fire BEFORE the mutation so the pending inbox entry is
    //    cleared in the same logical step. Only when the morph DROPS aiRequest
    //    (the FROM kind had routing, the TO kind doesn't — assertMorphCoverage
    //    pins that "aiRequest" is only declared in exactly that case).
    if (morph.drops.includes("aiRequest")) {
      await deps.unbridgeAiRequest(ev.fromKind, ev.id);
    }

    // 4. MUTATE (the per-doc hook flips the on-disk kind via the morph transform).
    await deps.mutate();

    // 5. SIGNAL — the D6 seam: W2b re-keys cardStore {fromKind,id}→{toKind,id}.
    publishCardMorphed(ev.fromKind, morph.to, ev.id);
    return true;
  }

  // DELETE.
  // 1. CONFIRM — the caller resolved `hasContent` from the kind-aware predicate.
  if (ev.hasContent) {
    const ok = await deps.confirm({
      message: "This item has text. Delete it?",
      confirmLabel: "Delete",
      tone: "danger",
    });
    if (!ok) return false;
  }

  // 2. SETTLE — a delete ends the record exactly as a morph does, so the live
  //    splice it manages must be resolved here too, or the blue range is
  //    orphaned identically (238). The upstream content-confirm has already run
  //    (`makeUnbridgingDelete` passes `hasContent:false` + an always-true
  //    confirm), so this prompt is the only dialog the executor raises; it asks
  //    a genuinely different question — what happens to the document, not
  //    whether the card goes.
  if (!(await settleAppliedSplice(ev, deps))) return false;

  // 3. UNBRIDGE — a delete of an aiRequest-bearing kind drops its flag → clear
  //    the pending inbox entry (REP-F7-02, the symmetric delete leak).
  if (CARD_REGISTRY[ev.kind].aiRequest != null) {
    await deps.unbridgeAiRequest(ev.kind, ev.id);
  }

  // 4. MUTATE.
  await deps.mutate();

  // 5. SIGNAL — the D6 seam: W2b prunes any cardStore ref keyed on {kind,id}.
  publishCardDeleted(ev.kind, ev.id);
  return true;
}
