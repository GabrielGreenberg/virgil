"use client";

/**
 * `makeUnbridgingDelete` — the ONE composition that turns a panel hook's raw
 * `deleteCard`/`deleteItem`/`deleteNote`/`deleteFootnote` into a delete that
 * discharges the cross-store obligations a card leaving incurs, routed through
 * the single `runCardLifecycleEvent` executor (T4 §3.3).
 *
 * WHY THIS EXISTS. A card with `aiRequest: true` bridges an OPEN row into
 * `ai-requests.json` (`bridgeCardAiRequestFlag`). Three lifecycle transitions
 * must discharge that row when the card leaves — archive (task 093), morph
 * (task 198), and DELETE (REP-F7-02). The delete leg was wired for exactly ONE
 * kind (`report-request`, via an inline wrapper in EditorPane); the other six
 * flag-bearing kinds (note / highlight / todo / cutter-comment /
 * revision-comment / footnote) deleted straight through their raw per-doc hook
 * filter and stranded the linked row forever — a phantom inbox entry that
 * inflates the count and re-serves a dead card on every `/editor/review` drain
 * (task 219). A deleted card can never toggle again, so the bridge header's
 * "self-heals on the next toggle" escape hatch does NOT apply.
 *
 * THE FIX IS A WIRING FIX, NOT NEW LOGIC. The executor's `unbridgeAiRequest`
 * branch is already generic-by-kind (it fires for any kind where
 * `CARD_REGISTRY[kind].aiRequest != null`), so closing the gap means composing
 * every panel hook's raw delete through the SAME executor the report leg
 * already uses — declared ONCE here rather than re-inlined six times.
 *
 * DELETE IS A TERMINAL TRANSITION, LIKE ARCHIVE. The bridge runs in
 * `"terminate"` mode (not the reversible `value=false` drop): the card is
 * *gone*, so — exactly as archive does (task 093) — the linked row must close
 * regardless of current openness, including an answered-L3 proposal
 * (`in-progress`+`resultId`) that a `value=false` toggle deliberately preserves
 * (task 043). A deleted card's proposal can never be accepted/rejected, so
 * leaving that row open would strand it as surely as the plain-open case.
 *
 * SINCE TASK 313 THE MODE COMES FROM THE EXECUTOR, NOT FROM HERE. It used to
 * read "the caller wires the terminate mode; this helper is mode-agnostic" —
 * true, and precisely the shape that let the MORPH leg (whose callback took the
 * same `(kind, id)` signature) omit the argument and silently inherit
 * `"toggle"`. `runCardLifecycleEvent` now derives the mode from the event
 * (`unbridgeModeFor`) and hands it down; `unbridge` is a pure forwarder.
 *
 * KEYSTROKE SANCTITY. Runs only on an explicit user delete (trash / margin
 * marker Delete / pristine click-away discard), never per transaction. The one
 * added cost is a single O(cards) `resolveKind` lookup at delete time.
 */

import type { CardKind } from "../types";
import { runCardLifecycleEvent } from "./run-event";
import type { AppliedSpliceOps } from "./applied-splice";
import type { AiRequestSyncMode } from "@/lib/ai-request-bridge";

export interface UnbridgingDeleteDeps {
  /** Resolve the registry `CardKind` of the card being deleted (e.g. a cutter
   *  card stored as `kind: "comment"` resolves to `"cutter-comment"`). Return
   *  null when the card can't be found — the wrapper then falls back to a plain
   *  raw delete (nothing to unbridge, nothing to signal). */
  resolveKind: (id: string) => CardKind | null;
  /** The raw per-doc hook mutation that removes the card. */
  rawDelete: (id: string) => void | Promise<void>;
  /** Close the linked `ai-requests.json` row. A pure FORWARDER onto the bridge:
   *  the `mode` is decided by the executor from the event (`unbridgeModeFor` —
   *  `"terminate"` for a delete) and must be passed straight through, never
   *  re-picked here (task 313). A no-op for a kind with no routing (the executor
   *  only calls this when `CARD_REGISTRY[kind].aiRequest != null`). */
  unbridge: (
    kind: CardKind,
    id: string,
    mode: AiRequestSyncMode,
  ) => void | Promise<void>;
  /** The SETTLE obligation, forwarded to the executor (task 238). Pass the ONE
   *  host-wide ops bag to EVERY delete door regardless of kind — it is
   *  kind-agnostic and the executor gates it on `ownsAppliedSplice`, so there is
   *  no per-kind wiring decision to get wrong when a kind later joins the
   *  pending-change family. Omitted → the step is skipped. */
  appliedSplice?: AppliedSpliceOps;
}

/**
 * Build a delete that unbridges + signals through the shared executor. The
 * content-confirm is assumed to have already happened upstream (the margin
 * marker's `deleteMarginItem`, the panel's own confirm, or a pristine discard of
 * an empty card), so the executor runs with `hasContent: false` and an
 * always-true confirm — no double-confirm. (The executor may still raise its
 * SETTLE prompt when the card owns a live in-document splice — a different
 * question, about the document rather than the card; see `run-event.ts`.)
 *
 * IT REPORTS WHETHER IT COMMITTED. The delete used to be unrefusable, so
 * fire-and-forget was honest and callers could destroy adjacent state (strip an
 * inline mark) ahead of it. Since SETTLE the delete CAN decline — a cancelled
 * keep/revert prompt leaves the card alive — so the signature says so: it
 * resolves true iff the card was actually removed. A caller that tears down
 * something the card owns must await this and skip the teardown on false, or
 * it mutilates a card the user just chose to keep. Callers that ignore the
 * result still work exactly as before (a `Promise<boolean>` is assignable
 * wherever the old `void` delete was).
 */
export function makeUnbridgingDelete(
  deps: UnbridgingDeleteDeps,
): (id: string) => Promise<boolean> {
  return async (id: string) => {
    const kind = deps.resolveKind(id);
    if (!kind) {
      // Card already gone / unresolvable — nothing to unbridge or signal; just
      // run the raw mutation so a stale caller still gets the delete it asked
      // for.
      await deps.rawDelete(id);
      return true;
    }
    return runCardLifecycleEvent(
      { type: "delete", kind, id, hasContent: false },
      {
        confirm: async () => true, // upstream already confirmed
        unbridgeAiRequest: deps.unbridge,
        mutate: () => deps.rawDelete(id),
        appliedSplice: deps.appliedSplice,
      },
    );
  };
}
