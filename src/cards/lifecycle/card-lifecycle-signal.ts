"use client";

/**
 * The card-lifecycle signal channel — the D6 seam (PLAN §1 D6, T4 §3.3/§6,
 * T2 §6).
 *
 * A card's destructive/transforming lifecycle events (DELETE, kind-change
 * MORPH) incur a cross-store obligation: the global `cardStore` selection /
 * hover / expand slots, keyed on `{kind, id}`, must be PRUNED (delete) or
 * RE-KEYED (morph flips `kind`). For the INLINE-ATOM kinds (footnote / citation)
 * this is already discharged by W2b's `useInlineAtomLifecycle` reconciler, which
 * derives liveness from the `DocStructureBus` diff. But the SIDECAR-BACKED kinds
 * (report / note / cutter / revision) have no doc-node whose add/remove the bus
 * reports — their lifecycle is a pure sidecar mutation the bus never sees. So
 * their `cardStore` obligation has no owner.
 *
 * THE SEAM. `runCardLifecycleEvent` (the single delete/morph executor) is the
 * one place every sidecar-card lifecycle event flows through. It hands a
 * `card-deleted` / `card-morphed` signal to its injected `deps.signal` sink;
 * the pane's reconciler (`useCardLifecycleReconciler`) is what BUILDS that sink,
 * bound to the pane's own `cardStore`, and prunes/re-keys it. One emitter, one
 * consumer — and they share an owner (the EditorPane), so the signal travels
 * as an injected dep, never a channel.
 *
 * THIS IS NOT A `DocStructureBus` SUBSCRIPTION. It is a synchronous, explicit
 * user-action channel (fired only on a trash/morph click), so it does NOT touch
 * keystroke sanctity and does NOT count against the +1-not-+3 invariant — the
 * single inline-atom bus consumer is unchanged.
 *
 * NO MODULE BUS (task 739). This file used to hold ONE module-level listener
 * Set that every mounted EditorPane subscribed its own store to. Under
 * multi-doc keep-alive every pane then received every other pane's events, and
 * card ids are only unique per paper — a duplicated paper folder shares them —
 * so deleting note X in the copy collapsed the original's note X, and morphing
 * it re-keyed the original's still-a-note to a kind it isn't. The signal is now
 * DATA only; delivery is the required `CardLifecycleDeps.signal` sink, so a
 * lifecycle event can reach only the store of the pane that ran it, by
 * construction (`module-subscriber-scope-census.test.ts` keeps a future
 * per-doc module bus from reappearing without a doc key).
 */

import type { CardKind } from "../types";

/** A card was hard-deleted (its sidecar entry removed / its atom marker gone).
 *  Consumers prune any `cardStore` ref keyed on `{kind, id}`. */
export interface CardDeletedSignal {
  type: "card-deleted";
  kind: CardKind;
  id: string;
}

/** A card morphed in place (kind flipped, id preserved). Consumers RE-KEY any
 *  `cardStore` ref from `{fromKind, id}` to `{toKind, id}` so the selection halo
 *  / expansion survive the kind change (REP-F6-02 / OMNI-F6-02). */
export interface CardMorphedSignal {
  type: "card-morphed";
  fromKind: CardKind;
  toKind: CardKind;
  id: string;
}

export type CardLifecycleSignal = CardDeletedSignal | CardMorphedSignal;

/** Where the executor hands a lifecycle signal: the ONE pane's own card store
 *  (task 739). A required `CardLifecycleDeps` field, bound per pane by
 *  `useCardLifecycleReconciler` — never a module-level channel. */
export type CardLifecycleSink = (signal: CardLifecycleSignal) => void;
