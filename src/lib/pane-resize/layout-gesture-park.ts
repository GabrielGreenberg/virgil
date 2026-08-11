// Park-and-settle on the layout-gesture bus — the ONE implementation of the
// "stash dirty during a continuous layout gesture, reconcile exactly once on
// the end edge" protocol (plan MEMO_LIBRARY_UI_REFACTOR_2026_07_11 §P3, task
// 090's successor; widened to the OS window resize by task 317). Geometry
// followers (ResizeObserver callbacks, `resize` listeners, measure schedulers,
// event feedback from embedded viewers) route their trigger through `fire(...)`;
// while a gesture is in flight the call is parked (LATEST args win) and
// replayed exactly once when the gesture ends, instead of cascading
// measure → setState → render per pointer/resize frame.
//
// Discipline notes:
// - Edge-only: the bus listener runs on begin/end edges, never per frame; a
//   parked `fire()` is a two-assignment stash (O(1)).
// - Latest-wins: consumers whose runner takes args (e.g. a lifted viewer page
//   state) settle with the freshest payload; zero-arg runners simply re-run
//   and should re-read their source of truth at settle time. A runner that
//   must ACCUMULATE across the gesture (marginalia's dirty-uuid set) keeps its
//   accumulation outside the park and parks the zero-arg scheduler.
// - One bus subscription per park; `dispose()` unsubscribes and drops any
//   parked call, so an unmounted consumer can never settle into dead state.
// - `siteId` is optional but wanted: it names the site in
//   `window.__layoutGestureStats()`, which is how the invariant ("0 settles
//   during the gesture, exactly 1 after release") is checked live.

import {
  isLayoutGestureActive,
  onLayoutGestureChange,
} from "./layout-gesture-bus";
import {
  recordParkedFire,
  recordParkLiveRun,
  recordParkSettle,
} from "../layout-gesture-probe";

export interface LayoutGesturePark<A extends unknown[]> {
  /** Run the runner now — unless a layout gesture (pane drag or window
   *  resize) is in flight, in which case the call is parked (latest args win)
   *  and replayed ONCE on the gesture's end edge. */
  fire: (...args: A) => void;
  /** Unsubscribe from the bus and drop any parked call. Call from the owning
   *  effect's cleanup. */
  dispose: () => void;
}

/**
 * Wrap `run` in the park/settle protocol. Create inside a React effect (or
 * any owned lifetime) and `dispose()` on cleanup — the returned object holds
 * a live bus subscription.
 */
export function parkDuringLayoutGesture<A extends unknown[]>(
  run: (...args: A) => void,
  siteId?: string,
): LayoutGesturePark<A> {
  // The parked call's args, or null when clean. A zero-arg runner parks `[]`,
  // which is non-null — the sentinel is the null itself, not arg presence.
  let parked: A | null = null;
  const off = onLayoutGestureChange((active) => {
    if (active || parked === null) return;
    const args = parked;
    parked = null;
    if (siteId) recordParkSettle(siteId);
    run(...args);
  });
  return {
    fire: (...args: A) => {
      if (isLayoutGestureActive()) {
        parked = args;
        if (siteId) recordParkedFire(siteId);
        return;
      }
      if (siteId) recordParkLiveRun(siteId);
      run(...args);
    },
    dispose: () => {
      parked = null;
      off();
    },
  };
}
