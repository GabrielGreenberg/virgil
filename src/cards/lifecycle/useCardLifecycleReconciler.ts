"use client";

/**
 * useCardLifecycleReconciler — the D6 consumer (T4 §3.3 step 3, the seam T2/T4
 * both flag). Builds the pane's card-lifecycle SINK, which reconciles the
 * global `cardStore` (selection / hover / expansion) against a card's
 * delete / morph:
 *
 *  - `card-deleted`  → PRUNE any `cardStore` ref keyed on `{kind, id}` (so a
 *    deleted report/note/cutter/revision card never leaves a stale halo on an
 *    unrelated card).
 *  - `card-morphed`  → RE-KEY any `cardStore` ref from `{fromKind, id}` to
 *    `{toKind, id}` (so the selection halo / expansion survive the kind flip —
 *    REP-F6-02 / OMNI-F6-02).
 *
 * This is the SIDECAR-BACKED-kind analogue of W2b's inline-atom diff prune:
 * report/note/cutter/revision cards have no doc-node whose add/remove the
 * DocStructureBus reports, so their `cardStore` obligation can only be
 * discharged from the explicit lifecycle signal the executor hands its sink.
 *
 * UNFLAGGED — this ships with the W2d morph executor (behavior-correct-by-
 * construction; it touches NO bus and runs only on an explicit lifecycle
 * signal). It does NOT count against the +1-not-+3 invariant (no DocStructureBus
 * subscription) and does NOT touch keystroke sanctity (fires only on a
 * trash / kind-chevron click). Mount once per pane.
 */

import { useMemo } from "react";
import type { CardLifecycleSignal, CardLifecycleSink } from "./card-lifecycle-signal";
import {
  pruneCardStoreFor,
  rekeyCardStoreForMorph,
} from "@/links/_shared/inline-atom-lifecycle-policy";
import type { CardStore } from "@/links/_shared/anchored-card-store";

/** Reconcile ONE store against a lifecycle signal: prune on delete, re-key on
 *  morph. Pure over its arguments — the store is the caller's, never ambient. */
export function reconcileCardStore(
  store: CardStore,
  signal: CardLifecycleSignal,
): void {
  if (signal.type === "card-deleted") {
    pruneCardStoreFor(store, signal.kind, signal.id);
  } else {
    rekeyCardStoreForMorph(store, signal.fromKind, signal.toKind, signal.id);
  }
}

/** Bind a lifecycle sink to `store`. A throwing reconcile is logged, never
 *  rethrown: the mutation it follows has already landed, so a UI-state failure
 *  must not turn a committed delete/morph into a reported failure. */
export function makeCardLifecycleSink(store: CardStore): CardLifecycleSink {
  return (signal) => {
    try {
      reconcileCardStore(store, signal);
    } catch (err) {
      console.error("card-lifecycle reconcile threw:", err);
    }
  };
}

/** Call once per pane. `store` is this doc's interaction store (the EditorPane
 *  body resolves it from `getCardStore(docId)`); the RETURNED sink is threaded
 *  into every lifecycle door of the same pane as `CardLifecycleDeps.signal`, so
 *  the delete/morph reconcile can only ever target this doc's
 *  selection/hover/expansion (task 739 — it used to subscribe a module-wide
 *  channel every pane shared). */
export function useCardLifecycleReconciler(store: CardStore): CardLifecycleSink {
  return useMemo(() => makeCardLifecycleSink(store), [store]);
}
