"use client";

/**
 * `runCardLifecycleEvent` — the single executor for a card's destructive /
 * transforming lifecycle events (T4 §3.3). Replaces the open-coded bodies of
 * the morph chokepoint (`convertCardWithRemap`) and centralizes the three
 * obligations a lifecycle event incurs, each read from the declared contract
 * rather than re-derived per call site:
 *
 *   1. CONFIRM  — built from `CARD_REGISTRY[kind].morph.drops` (morph) so the
 *      copy can never be direction-blind or lie (REP-F6-03), and from
 *      `cardHasContent` (delete) so every kind's content is seen (W2d-2).
 *   2. UNBRIDGE — when the event DROPS aiRequest (a delete of an aiRequest-
 *      bearing kind, or a morph whose `drops` includes "aiRequest"), clear the
 *      pending `ai-requests.json` entry in the SAME logical step — so a
 *      report-request→report morph (or a delete of a flagged report-request)
 *      never strands a phantom inbox entry (REP-F5-01 / REP-F6-01 / REP-F7-02 /
 *      REP-F8-01 / OMNI-F6-01).
 *   3. SIGNAL   — publish ONE `card-deleted` / `card-morphed` signal (the D6
 *      seam) that W2b's reconciler consumes to prune / re-key `cardStore`
 *      (REP-F6-02 / OMNI-F6-02 for the sidecar kinds).
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
  };
  const parts = drops.map((d) => LABELS[d] ?? d);
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
}

/**
 * Run one card lifecycle event end-to-end. Returns true iff the event committed
 * (false on a user-cancelled confirm), so the caller can short-circuit any
 * follow-up (e.g. the float-key remap on morph).
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

    // 2. UNBRIDGE — fire BEFORE the mutation so the pending inbox entry is
    //    cleared in the same logical step. Only when the morph DROPS aiRequest
    //    (the FROM kind had routing, the TO kind doesn't — assertMorphCoverage
    //    pins that "aiRequest" is only declared in exactly that case).
    if (morph.drops.includes("aiRequest")) {
      await deps.unbridgeAiRequest(ev.fromKind, ev.id);
    }

    // 4. MUTATE (the per-doc hook flips the on-disk kind via the morph transform).
    await deps.mutate();

    // 3. SIGNAL — the D6 seam: W2b re-keys cardStore {fromKind,id}→{toKind,id}.
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

  // 2. UNBRIDGE — a delete of an aiRequest-bearing kind drops its flag → clear
  //    the pending inbox entry (REP-F7-02, the symmetric delete leak).
  if (CARD_REGISTRY[ev.kind].aiRequest != null) {
    await deps.unbridgeAiRequest(ev.kind, ev.id);
  }

  // 4. MUTATE.
  await deps.mutate();

  // 3. SIGNAL — the D6 seam: W2b prunes any cardStore ref keyed on {kind,id}.
  publishCardDeleted(ev.kind, ev.id);
  return true;
}
