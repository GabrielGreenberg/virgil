// Settle by CONVERGENCE — the termination rule for a post-mount geometry
// stabilization loop (task 370).
//
// > **A geometry pass is an OBSERVATION, not a fix.** A trigger says "the world
// > may have moved"; the honest answer is "keep measuring until two consecutive
// > passes AGREE", never "measure once and hope". A loop that stops on a PROXY
// > for settledness stops while the thing it measures is still moving.
//
// THE DEFECT this replaces. `useInTextPositions` healed its cold-start measure
// with a rAF loop that terminated the first frame the editor's `scrollHeight`
// was unchanged (`SETTLE_STABLE_FRAMES = 1`), or after a 30-frame cap. Both
// halves are proxies for the wrong quantity:
//
//   - `scrollHeight` is a TOTAL. Inner layout moves within an unchanged total
//     all the time — a KaTeX span sizing, an expex example reflowing, a figure
//     NodeView swapping its placeholder for an image of the same height — and
//     an absolutely-positioned lane never touches it at all. So the loop
//     routinely declared victory one frame into a settle that had barely begun.
//   - The frame cap is a wall-clock guess wearing a frame counter's clothes
//     (~500ms @60fps, less on a loaded main thread — exactly when a slow settle
//     is slowest).
//
// And after it stopped, NOTHING re-measured until the user scrolled. On a
// card-dense page that is visible as a lane packed contiguously from the top at
// minimum spacing, which SNAPS into place on the first scroll (Gabriel,
// 2026-08-18, screenshots).
//
// THE CRITERION. The consumer already owns a fixed-point definition: task 328's
// hysteresis. A commit that would move a card less than `REPOSITION_EPSILON_PX`
// (or resize it less than `HEIGHT_EPSILON_PX`) keeps the previously committed
// value, so the pass reports NO CHANGE. "Two consecutive passes agree within
// the hysteresis" is therefore not a new rule to keep in sync with anything —
// it is `measure()` reporting `"stable"` twice in a row. The criterion is the
// consumer's own, read through `MeasureOutcome`.
//
// WHY THE CAP IS WALL-CLOCK. A frame budget is a lie on a busy main thread:
// the frames a slow font/math settle needs are precisely the frames it does not
// get. `CONVERGE_MAX_MS` bounds the real thing being waited on.
//
// WHY EVERY TRIGGER ENTERS THE SAME DOOR. Cold mount, `document.fonts.ready`,
// the editor ResizeObserver, the structural bus and the scroll-idle refinement
// all mean one thing — "the world may have moved" — and all previously got
// DIFFERENT answers: the mount got a 30-frame proxy loop, everything else got a
// single rAF-coalesced pass. A single pass is right only when one pass is
// enough, which is exactly the assumption a cold load falsifies. `request()` is
// the one door; the criterion, the pacing and the cap are stated once.
//
// COST, stated rather than implied. A re-arm while a pass is already pending
// ADDS NO PASS — it resets the stability counter and refreshes the deadline, so
// the maximum rate stays one pass per scheduled tick however many triggers
// fire. On the keystroke-adjacent path (the editor RO fires on a wrap-changing
// keystroke) that means the per-fire cost is unchanged from the pre-370
// rAF-coalesced `schedule()`; what is added is the trailing CONFIRMATION passes
// after the last trigger — idle-paced, and bounded by the fixed point at two.
// A measure pass is O(in-band items), never O(doc) (wave-2b C5 + task 327), so
// this is a small constant on a bounded pass, not doc-proportional work.

import { requestLowPriority } from "@/lib/keep-alive/schedule-low-priority";

/**
 * What one measure pass reports back. The controller is BLIND to geometry —
 * it only folds these verdicts — so the fixed-point definition stays entirely
 * with the consumer that owns the hysteresis.
 *
 * - `changed`  — the pass COMMITTED a real change (past the hysteresis).
 *                Not converged; reset the stability count.
 * - `stable`   — the pass ran fully and committed nothing: it AGREES with the
 *                previous commit within the epsilon. This is the convergence
 *                observation.
 * - `deferred` — the pass could not honestly measure (a re-show suppression
 *                window, no pod yet, the user typing into a card, a
 *                self-rejected degenerate read). NOT agreement, and NOT a
 *                reason to stop: the pre-370 loop's `if (!canMeasureNow())
 *                return;` had no reschedule, so ONE unmeasurable frame killed
 *                the settle permanently.
 * - `inert`    — there is nothing to converge on (disabled, an empty item set,
 *                a hidden pane whose re-show will re-arm). Terminal: stop
 *                rather than burn the deadline.
 */
export type MeasureOutcome = "changed" | "stable" | "deferred" | "inert";

/** Consecutive agreeing passes required to call it converged.
 *
 *  TWO, not one, and the reason is the defect this file replaces: a single
 *  agreeing observation is a PLATEAU, and a plateau is what the scrollHeight
 *  proxy mistook for a settle. An async layout settle routinely holds still for
 *  a frame between a font swap and the NodeView mounts it triggers. Requiring
 *  the agreement to REPEAT makes the observation about the fixed point rather
 *  than about one frame's luck. */
const STABLE_PASSES = 2;

/** How long after each `request()` passes stay rAF-paced.
 *
 *  The fast phase exists so the CORRECTED deck lands before the user perceives
 *  the compressed one; after it, passes drop to idle pacing, because anything
 *  still moving this late is a slow asset (a web font, a decoding image) and
 *  polling it at 60Hz buys nothing a user can see. Time-based rather than
 *  frame-counted for the same reason the cap is. */
const FAST_MS = 250;

/** Wall-clock budget per arm-chain. Generous on purpose: a cold open of a
 *  math-heavy paper over FSA can genuinely still be settling seconds in, and
 *  the alternative to waiting is the pre-370 behaviour (stop early, look wrong
 *  until the user scrolls). Refreshed by every `request()`, so a document that
 *  keeps genuinely changing keeps being tracked — at the same per-tick cost.
 *
 *  A FRAME cap (what this replaces) is a lie on a busy main thread: the frames
 *  a slow settle needs are precisely the frames it does not get. */
const MAX_MS = 6000;

/** Why a chain stopped. `inert` and `converged` are healthy terminations;
 *  `capped` means the budget ran out with geometry still moving (or still
 *  unmeasurable) — the honest failure mode, and the one worth reading in the
 *  probe during the owed preview pass. */
export type ConvergeStop = "converged" | "capped" | "inert" | "stopped";

export interface ConvergenceController {
  /**
   * "The world may have moved." Idempotent and cheap: resets the stability
   * count, refreshes the deadline and the fast window, and schedules a pass
   * ONLY if none is already pending.
   */
  request(): void;
  /** Teardown — cancel any pending pass. Safe to call repeatedly. */
  stop(): void;
}

// ── Dev probe ───────────────────────────────────────────────────────────────
// Sibling of `__scrollRepositionStats` / `__layoutGestureStats` / `__geometryStats`.
// Read it from the dev console right after opening a card-dense paper:
//
//   window.__settleConvergenceStats()
//   → { arms, passes, outcomes: { changed, stable, deferred, inert },
//       lastChainMs, lastStop }
//
// A healthy cold open reports `lastStop: "converged"` with a small
// `lastChainMs` (time-to-converged — the number task 370 asks to be recorded)
// and `passes` in the single digits. `lastStop: "capped"` means the geometry
// never stopped moving inside the budget, which is the case worth reporting.
// Aggregate rather than per-controller on purpose: several instances are live
// under multi-doc keep-alive (one per omni side per pane), every hidden one
// terminates `inert` immediately, and the question being asked of the console
// — "did the visible deck settle, and how fast?" — is answered by the rollup.

interface ProbeStats {
  arms: number;
  passes: number;
  outcomes: Record<MeasureOutcome, number>;
  lastChainMs: number | null;
  lastStop: ConvergeStop | null;
}

const probeEnabled =
  typeof window !== "undefined" && process.env.NODE_ENV !== "production";

const probe: ProbeStats = {
  arms: 0,
  passes: 0,
  outcomes: { changed: 0, stable: 0, deferred: 0, inert: 0 },
  lastChainMs: null,
  lastStop: null,
};
let probeInstalled = false;

function installProbe(): void {
  if (!probeEnabled || probeInstalled) return;
  probeInstalled = true;
  const w = window as unknown as Record<string, unknown>;
  w.__settleConvergenceStats = () => ({
    ...probe,
    outcomes: { ...probe.outcomes },
  });
  w.__settleConvergenceStatsReset = () => {
    probe.arms = 0;
    probe.passes = 0;
    probe.outcomes = { changed: 0, stable: 0, deferred: 0, inert: 0 };
    probe.lastChainMs = null;
    probe.lastStop = null;
  };
}

function nowMs(): number {
  return typeof performance !== "undefined" &&
    typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

/**
 * Create a settle-by-convergence controller.
 *
 * The controller owns SCHEDULING and TERMINATION only. It never reads the DOM,
 * never inspects geometry, and holds no notion of "settled" beyond the verdicts
 * `measure()` hands it — which is what lets the epsilon live in exactly one
 * place (`reposition-policy`), consumed by the measure pass.
 *
 * `measure` is the whole interface deliberately: there is no options bag. Every
 * knob a caller might have tuned is a decision this file is entitled to make
 * once, and an option nothing reads is the dead-field class (task 227).
 */
export function createConvergenceController(
  measure: () => MeasureOutcome,
): ConvergenceController {
  installProbe();

  let stableCount = 0;
  let deadline = 0;
  let fastUntil = 0;
  let chainStart = 0;
  let rafHandle = 0;
  let cancelIdle: (() => void) | null = null;
  let pending = false;
  let disposed = false;

  const clearPending = (): void => {
    if (rafHandle && typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(rafHandle);
    }
    rafHandle = 0;
    cancelIdle?.();
    cancelIdle = null;
    pending = false;
  };

  const finish = (stop: ConvergeStop): void => {
    clearPending();
    if (probeEnabled) {
      probe.lastStop = stop;
      probe.lastChainMs = chainStart === 0 ? null : nowMs() - chainStart;
    }
    chainStart = 0;
  };

  const step = (): void => {
    if (disposed) return;
    const outcome = measure();
    if (probeEnabled) {
      probe.passes += 1;
      probe.outcomes[outcome] += 1;
    }

    if (outcome === "inert") {
      // Nothing to converge ON. Terminate rather than spin out the deadline —
      // a deck that later gains items, or a pane that is later re-shown,
      // re-arms through its own trigger like anything else.
      finish("inert");
      return;
    }
    // Only AGREEMENT counts toward the fixed point. `deferred` is explicitly
    // not agreement (the pass measured nothing), and it deliberately does not
    // terminate either — that conflation is the pre-370 bug.
    stableCount = outcome === "stable" ? stableCount + 1 : 0;

    if (stableCount >= STABLE_PASSES) {
      finish("converged");
      return;
    }
    if (nowMs() >= deadline) {
      finish("capped");
      return;
    }
    schedule();
  };

  function schedule(): void {
    if (disposed || pending) return;
    pending = true;
    // FAST phase → rAF (a correction the user could see should land in the next
    // frame). TAIL → the shared low-priority scheduler, so the confirmation
    // passes after a settle never compete with paint.
    if (nowMs() < fastUntil && typeof requestAnimationFrame === "function") {
      rafHandle = requestAnimationFrame(() => {
        rafHandle = 0;
        pending = false;
        step();
      });
      return;
    }
    cancelIdle = requestLowPriority(() => {
      cancelIdle = null;
      pending = false;
      step();
    });
  }

  return {
    request(): void {
      if (disposed) return;
      const t = nowMs();
      if (chainStart === 0) chainStart = t;
      if (probeEnabled) probe.arms += 1;
      // A fresh trigger invalidates any agreement observed so far, and buys a
      // fresh budget + a fresh fast window. It does NOT enqueue a second pass:
      // ONE pending pass is the whole rate limit, which is what keeps a trigger
      // storm (a re-show reflow, a run of wrap-changing keystrokes) costing
      // exactly what one rAF-coalesced measure used to.
      stableCount = 0;
      deadline = t + MAX_MS;
      fastUntil = t + FAST_MS;
      schedule();
    },
    stop(): void {
      if (disposed) return;
      disposed = true;
      if (chainStart !== 0) finish("stopped");
      else clearPending();
    },
  };
}
