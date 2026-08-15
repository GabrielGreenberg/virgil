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
 *    gesture — once per door, never per hover frame — so a side effect here
 *    fires on the classify pass too. Written forward as well: no planned spec
 *    can answer `confirm` today, but the moment one can, the plan runs before
 *    the user has agreed to anything. Every side effect belongs in `commit()`.
 *  - **A non-null plan is a PROMISE that `commit()` changes something.** A
 *    `commit` that can still silently do nothing reproduces the very drift this
 *    module exists to remove, one level in — every refusal must be resolved
 *    while the answer can still be `null`.
 *
 * `applyDrop` deliberately RE-PLANS rather than reusing the plan `classifyDrop`
 * built. For a planned spec today the two calls are back-to-back in ONE tick, so
 * this buys nothing yet — it is the rule that keeps `commitDropSession`'s
 * `await` from becoming a live hazard the moment a planned spec can reach the
 * confirm path, where a transaction built at classify time would be dispatched
 * against a document that has moved on. Planning runs twice per gesture and
 * never per hover frame (the per-frame path is the hit-test), so the safe order
 * is also the cheap one.
 *
 * Deliberately NOT offered: a `decide` hook to refine a resolved plan into
 * `{kind:"confirm"}`. No spec built here needs one today, and an option nothing
 * reads is the dead-field class this codebase legislates against (task 227). Add
 * it WITH its first real caller — the derivation below is where it would go.
 *
 * **The one limit, stated rather than papered over.** `finishApply` reads
 * "applied" as "`applyDrop` did not throw", so a plan that resolved at classify
 * time and refuses at apply time would still be reported as applied. That
 * cannot happen today: a planned spec only ever answers `apply` or `no-op`, so
 * the two calls are back-to-back in ONE tick with no dispatch between them and
 * the second sees the same state as the first. It becomes reachable the moment
 * something here can return `confirm` — the `await` in `commitDropSession` is
 * where the document could move — so whoever adds the `decide` hook above owes
 * `applyDrop` a way to report the refusal, not just the absence of a throw.
 */

// `DropPlan` / `DropPlanner` live on the type leaf (types.ts) beside the
// `DropSpec` field they populate — the contract belongs to the spec, not to the
// factory that happens to be its only builder. Planners import them from there.
import type { DropPlan, DropPlanner, DropSpec } from "./types";

export interface PlannedDropSpecOptions
  extends Omit<DropSpec, "classifyDrop" | "applyDrop" | "planDrop"> {
  planDrop: DropPlanner;
}

/**
 * A planner that THROWS is a refusal, not an escaped exception.
 *
 * This is load-bearing rather than defensive, because the fix moved work across
 * a containment boundary: node construction, wrapping and transaction building
 * used to live only in `applyDrop`, which `finishApply` wraps in a `try/catch`.
 * `planDrop` runs on BOTH doors, and `classifyDrop`'s caller
 * (`controller.commitDropSession`) has no catch — and is `async`, so a throw
 * there becomes a REJECTED PROMISE at `void commitDropSession()` in the
 * controller's own mouseup, and at the two `await`s in `LiftHost`. The session
 * would never reach `endDropSession()`: the window listeners, the
 * `data-drop-mode-active` body attr and the crosshair cursor would all outlive
 * the gesture, and the lift overlay would stay painted with a transient
 * `linkedAnchor` mark orphaned into the `.tex`.
 *
 * So the boundary is restored here, on the door that lacks one. Refusing is also
 * the right ANSWER and not merely the safe one: a resolution that cannot be
 * completed is exactly what `null` means.
 *
 * **This is no longer merely precautionary** (task 328). It was, while every
 * resolution reached ProseMirror through `fitNodesAtInsert`, which is throw-safe
 * end to end. A resolution that builds its own transaction is not:
 * `Transform.replace` resolves both positions (`RangeError: Position N out of
 * range` on a stale `placement.pos`) and `Transform.step` THROWS `TransformError`
 * on a step that fails to apply — and a hit-test position recorded on the last
 * throttled mousemove can be stale by mouseup if the target doc shrank under it.
 * So the containment is exported: `refuseOnThrow` is the ONE rule, and a spec
 * that resolves on both doors WITHOUT being built here — `inlineAtomMoveSpec`,
 * allowlisted for the symmetry of its doors and never for their safety — calls
 * it around its own resolution rather than re-deriving the try/catch.
 */
export function refuseOnThrow<T>(label: string, resolve: () => T | null): T | null {
  try {
    return resolve();
  } catch (err) {
    console.error(`[drop-mode] ${label} threw — refusing the drop:`, err);
    return null;
  }
}

function planOrRefuse(
  planDrop: DropPlanner,
  ...args: Parameters<DropPlanner>
): DropPlan | null {
  return refuseOnThrow("planDrop", () => planDrop(...args));
}

/**
 * Build a `DropSpec` whose `classifyDrop` and `applyDrop` are two views of ONE
 * resolution. The planner is also published on the returned spec (`planDrop`),
 * and the pair is BRANDED, so a guard can ask the LIVE SPEC OBJECT whether its
 * decision is really derived — asking the object has neither of a source grep's
 * holes (method-shorthand spellings, and specs authored outside any one
 * directory), and the brand closes the one hole publishing alone leaves: a spec
 * that spreads a planned one and then overrides `applyDrop` carries a `planDrop`
 * field while running two independent doors again — the original shape, CI green.
 */
const PLANNED_DOORS = new WeakMap<
  DropSpec,
  { classifyDrop: DropSpec["classifyDrop"]; applyDrop: DropSpec["applyDrop"] }
>();

/** True iff `spec` is EXACTLY as `plannedDropSpec` built it — both doors still
 *  the derived ones. Read by `planned-decision-guardrail.test.ts`. */
export function hasDerivedDecision(spec: DropSpec): boolean {
  const doors = PLANNED_DOORS.get(spec);
  return (
    !!doors &&
    spec.classifyDrop === doors.classifyDrop &&
    spec.applyDrop === doors.applyDrop
  );
}

export function plannedDropSpec(opts: PlannedDropSpecOptions): DropSpec {
  const { planDrop, ...rest } = opts;
  const classifyDrop: DropSpec["classifyDrop"] = (placement, cardKey, ctx) =>
    planOrRefuse(planDrop, placement, cardKey, ctx)
      ? { kind: "apply" }
      : { kind: "no-op" };
  const applyDrop: DropSpec["applyDrop"] = (placement, cardKey, ctx) => {
    // Re-plan rather than reuse — see the module header.
    planOrRefuse(planDrop, placement, cardKey, ctx)?.commit();
  };
  const spec: DropSpec = { ...rest, planDrop, classifyDrop, applyDrop };
  PLANNED_DOORS.set(spec, { classifyDrop, applyDrop });
  return spec;
}
