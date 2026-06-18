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
 * one place every sidecar-card lifecycle event flows through. It PUBLISHES a
 * `card-deleted` / `card-morphed` signal here; W2b's reconciler SUBSCRIBES and
 * prunes/re-keys `cardStore` accordingly. T4 owns the emission; T2/W2b owns the
 * prune (the seam both docs flag). One emitter, one consumer.
 *
 * THIS IS NOT A `DocStructureBus` SUBSCRIPTION. It is a synchronous, explicit
 * user-action channel (fired only on a trash/morph click), so it does NOT touch
 * keystroke sanctity and does NOT count against the +1-not-+3 invariant — the
 * single inline-atom bus consumer is unchanged. Module-scoped (like
 * `cardStore`) so the executor (in EditorPane) and the reconciler (in EditorPane
 * too, but a different effect) share it without a common ancestor.
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

type Listener = (signal: CardLifecycleSignal) => void;

const _listeners = new Set<Listener>();

/** Subscribe to card-lifecycle signals. Returns an unsubscribe fn (effect-
 *  cleanup friendly). */
export function subscribeCardLifecycle(fn: Listener): () => void {
  _listeners.add(fn);
  return () => {
    _listeners.delete(fn);
  };
}

/** Publish a card-lifecycle signal to every subscriber. Synchronous; a throwing
 *  listener must not strand the rest (DATA-LOSS isolation, mirrors the bus
 *  consumer's per-policy try/catch). */
export function publishCardLifecycle(signal: CardLifecycleSignal): void {
  for (const fn of _listeners) {
    try {
      fn(signal);
    } catch (err) {
      console.error("card-lifecycle signal listener threw:", err);
    }
  }
}

/** Convenience emitters (the executor's vocabulary). */
export function publishCardDeleted(kind: CardKind, id: string): void {
  publishCardLifecycle({ type: "card-deleted", kind, id });
}

export function publishCardMorphed(
  fromKind: CardKind,
  toKind: CardKind,
  id: string,
): void {
  publishCardLifecycle({ type: "card-morphed", fromKind, toKind, id });
}
