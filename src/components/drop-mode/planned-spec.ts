/**
 * `plannedDropSpec` — **the decision is DERIVED from the plan, never restated
 * beside it** (task 321).
 *
 * A `DropSpec` answers the same question at two moments: `classifyDrop` decides
 * (once, at mouseup, inside `commitDropSession`) and `applyDrop` executes. The
 * two were independent functions, and every spec's refusals lived only in the
 * second — a bare `return` from `applyDrop` when the adapter declined, the
 * container fit rejected, a rehydrate threw, or the ctx sub-bag wasn't wired.
 * `classifyDrop` knew none of it, so for a gesture the spec would refuse the
 * user saw:
 *
 *   1. a valid green landing bar under the cursor (it comes from the hit-test);
 *   2. release → `classifyDrop` says `{kind:"apply"}` → `finishApply` runs,
 *      and sets `applied = true` because nothing THREW;
 *   3. `postDrop: "close"` fires → **the popped-out float disappears**;
 *   4. the document is unchanged, with no toast, no cursor change, nothing.
 *
 * The gesture reads as "it worked and then vanished." Nothing failed: the spec
 * was registered, the hit-test was honest about the geometry, the commit ran,
 * and every test was green — because the decision and the execution were each
 * correct about their own half of a question only one of them could answer.
 *
 * So a spec that can refuse states ONE function, `planDrop`, which resolves the
 * whole drop — source lookup, adapter, wrap, container fit, ctx accessors — into
 * a `DropPlan` whose `commit()` only DISPATCHES, or `null` when the drop cannot
 * happen. `classifyDrop` and `applyDrop` are both generated from it here, so
 * they cannot disagree: a refusal reaches the controller as `no-op`, which
 * `commitDropSession` already handles correctly (`cancelDropSession()` — the
 * float is preserved, nothing is dispatched, the session ends).
 *
 * Two rules the plan carries, and both are load-bearing:
 *
 *  - **A plan is PURE.** It reads live state and builds values; it must not
 *    dispatch, mutate a sidecar, or call a ctx factory. It runs TWICE per
 *    gesture (once per door) and, on the confirm path, once before the user has
 *    agreed to anything. Every side effect belongs inside `commit()`.
 *  - **A non-null plan is a PROMISE that `commit()` changes something.** A
 *    `commit` that can still silently do nothing reproduces the very drift this
 *    module exists to remove, one level in — every refusal must be resolved
 *    while the answer can still be `null`.
 *
 * `applyDrop` deliberately RE-PLANS rather than reusing the plan `classifyDrop`
 * built: the two doors are separated by an `await` on the confirm path, so a
 * transaction built at classify time could be dispatched against a document that
 * has moved on. Planning is cheap (once per user gesture, never per hover frame
 * — the per-frame path is the hit-test), so the safe order is the free one.
 *
 * Deliberately NOT offered: a `decide` hook to refine a resolved plan into
 * `{kind:"confirm"}`. No spec built here needs one today, and an option nothing
 * reads is the dead-field class this codebase legislates against (task 227). Add
 * it WITH its first real caller — the derivation below is where it would go.
 */

import type { DropPlanner, DropSpec } from "./types";

// `DropPlan` / `DropPlanner` live on the type leaf (types.ts) beside the
// `DropSpec` field they populate — the contract belongs to the spec, not to the
// factory that happens to be its only builder. Re-exported here so a planner
// imports its own vocabulary from the module it is written against.
export type { DropPlan, DropPlanner } from "./types";

export interface PlannedDropSpecOptions
  extends Omit<DropSpec, "classifyDrop" | "applyDrop" | "planDrop"> {
  planDrop: DropPlanner;
}

/**
 * Build a `DropSpec` whose `classifyDrop` and `applyDrop` are two views of ONE
 * resolution. The planner is also published on the returned spec (`planDrop`),
 * so a guard can ask the LIVE SPEC OBJECT whether its decision is derived —
 * asking the object has neither of a source grep's holes (method-shorthand
 * spellings, and specs authored outside any one directory).
 */
export function plannedDropSpec(opts: PlannedDropSpecOptions): DropSpec {
  const { planDrop, ...rest } = opts;
  return {
    ...rest,
    planDrop,
    classifyDrop(placement, cardKey, ctx) {
      return planDrop(placement, cardKey, ctx)
        ? { kind: "apply" }
        : { kind: "no-op" };
    },
    applyDrop(placement, cardKey, ctx) {
      // Re-plan rather than reuse — see the module header.
      planDrop(placement, cardKey, ctx)?.commit();
    },
  };
}
