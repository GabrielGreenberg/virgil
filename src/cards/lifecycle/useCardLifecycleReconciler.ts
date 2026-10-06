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
 * THE FLOAT HALF (task 789). A popped-out card's window is keyed
 * `float:card:<kind>:<id>` in `poppedOutCards` (+ its rect in
 * `cardFloatPositions`) — the same `{kind, id}` the store is keyed on, so it is
 * the same obligation and discharged by the same sink: delete CLOSES the key
 * (dropping the rect), morph REMAPS it in lockstep. Before this, only the morph
 * chokepoint remapped (by hand, beside the executor) and nothing closed a
 * deleted card's key — the window vanished (its builder resolved nothing) but
 * the key lived on: top of the Cmd-W focus stack (so Cmd-W "closed" an
 * invisible float and did nothing), counted in new-float placement, persisted
 * across reload, and resurrected at its old rect on undo. Every door that
 * reports `card-deleted` / `card-morphed` — the morph chokepoint, every
 * `makeUnbridgingDelete` wrapper (archive's included since task 974 — it had
 * been read as exempt off R18's no-CASCADE flag) and the card-origin archive
 * restore — now closes/re-keys the float from this one place. WHICH poppable
 * kinds reach it, and why the rest don't need to, is pinned per kind by
 * `card-deleted-door-census.test.ts` — not asserted here in prose. (The inline-atom kinds keep their bus-diff close in
 * `inline-atom-lifecycle-policy.ts` §(c): an atom removed by a keystroke or a
 * code-view edit never passes through this executor, so that close is not a
 * duplicate of this one but the same obligation on a different door.)
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
import { cardPopKey } from "@/panels/panel-registry";

/** The pane's float-key ops (its `viewPrefs`). Both are no-ops for a key that
 *  isn't popped, so the sink calls them unconditionally. */
export interface CardLifecycleFloatOps {
  closeCardPopout: (key: string) => void;
  remapCardPopKey: (oldKey: string, newKey: string) => void;
}

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

/** Reconcile the pane's popped-float keys against a lifecycle signal: close on
 *  delete (key + saved rect), lockstep-remap on morph (task 789). */
export function reconcileCardFloat(
  floats: CardLifecycleFloatOps,
  signal: CardLifecycleSignal,
): void {
  if (signal.type === "card-deleted") {
    floats.closeCardPopout(cardPopKey(signal.kind, signal.id));
  } else {
    floats.remapCardPopKey(
      cardPopKey(signal.fromKind, signal.id),
      cardPopKey(signal.toKind, signal.id),
    );
  }
}

/** Bind a lifecycle sink to `store` (and, when the pane has them, its float
 *  ops, read through a getter at signal time). A throwing reconcile is logged, never rethrown: the mutation
 *  it follows has already landed, so a UI-state failure must not turn a
 *  committed delete/morph into a reported failure. Each half is guarded
 *  separately so one failing cannot skip the other. */
export function makeCardLifecycleSink(
  store: CardStore,
  getFloats?: () => CardLifecycleFloatOps | null | undefined,
): CardLifecycleSink {
  return (signal) => {
    try {
      reconcileCardStore(store, signal);
    } catch (err) {
      console.error("card-lifecycle reconcile threw:", err);
    }
    try {
      const floats = getFloats?.();
      if (floats) reconcileCardFloat(floats, signal);
    } catch (err) {
      console.error("card-lifecycle float reconcile threw:", err);
    }
  };
}

/** Call once per pane. `store` is this doc's interaction store (the EditorPane
 *  body resolves it from `getCardStore(docId)`); the RETURNED sink is threaded
 *  into every lifecycle door of the same pane as `CardLifecycleDeps.signal`, so
 *  the delete/morph reconcile can only ever target this doc's
 *  selection/hover/expansion (task 739 — it used to subscribe a module-wide
 *  channel every pane shared). */
export function useCardLifecycleReconciler(
  store: CardStore,
  floats?: CardLifecycleFloatOps | null,
): CardLifecycleSink {
  // Keyed on the two op identities, not the prefs object: both are stable
  // callbacks, where the merged viewPrefs object churns on every prefs write
  // and would re-mint every lifecycle door's memo with it.
  const close = floats?.closeCardPopout;
  const remap = floats?.remapCardPopKey;
  return useMemo(() => {
    const ops =
      close && remap ? { closeCardPopout: close, remapCardPopKey: remap } : null;
    return makeCardLifecycleSink(store, () => ops);
  }, [store, close, remap]);
}
