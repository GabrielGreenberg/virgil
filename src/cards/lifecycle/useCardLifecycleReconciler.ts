"use client";

/**
 * useCardLifecycleReconciler — the D6 consumer (T4 §3.3 step 3, the seam T2/T4
 * both flag). Subscribes to the card-lifecycle signal channel and reconciles the
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
 * discharged from the explicit lifecycle signal the executor publishes.
 *
 * UNFLAGGED — this ships with the W2d morph executor (behavior-correct-by-
 * construction; it touches NO bus and runs only on an explicit lifecycle
 * signal). It does NOT count against the +1-not-+3 invariant (no DocStructureBus
 * subscription) and does NOT touch keystroke sanctity (fires only on a
 * trash / kind-chevron click). Mount once per pane.
 */

import { useEffect } from "react";
import { subscribeCardLifecycle } from "./card-lifecycle-signal";
import {
  pruneCardStoreFor,
  rekeyCardStoreForMorph,
} from "@/links/_shared/inline-atom-lifecycle-policy";

export function useCardLifecycleReconciler(): void {
  useEffect(() => {
    return subscribeCardLifecycle((signal) => {
      if (signal.type === "card-deleted") {
        pruneCardStoreFor(signal.kind, signal.id);
      } else {
        rekeyCardStoreForMorph(signal.fromKind, signal.toKind, signal.id);
      }
    });
  }, []);
}
