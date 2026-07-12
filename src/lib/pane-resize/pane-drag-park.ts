// Park-and-settle on the pane-drag bus — the ONE implementation of the
// "stash dirty during a pane-resize gesture, reconcile exactly once on the
// end edge" protocol (plan MEMO_LIBRARY_UI_REFACTOR_2026_07_11 §P3, task 090's
// successor). Geometry observers (ResizeObserver callbacks, measure schedulers,
// event feedback from embedded viewers) route their trigger through
// `fire(...)`; while a pane drag is in flight the call is parked (LATEST args
// win) and replayed exactly once when the gesture ends, instead of cascading
// measure → setState → render per pointer frame.
//
// Discipline notes:
// - Edge-only: the bus listener runs on begin/end edges, never per frame; a
//   parked `fire()` is a two-assignment stash (O(1)).
// - Latest-wins: consumers whose runner takes args (e.g. a lifted viewer page
//   state) settle with the freshest payload; zero-arg runners simply re-run
//   and should re-read their source of truth at settle time.
// - One bus subscription per park; `dispose()` unsubscribes and drops any
//   parked call, so an unmounted consumer can never settle into dead state.

import { isPaneDragging, onPaneDragChange } from "./pane-drag-bus";

export interface PaneDragPark<A extends unknown[]> {
  /** Run the runner now — unless a pane-resize drag is in flight, in which
   *  case the call is parked (latest args win) and replayed ONCE on the
   *  gesture's end edge. */
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
export function parkDuringPaneDrag<A extends unknown[]>(
  run: (...args: A) => void,
): PaneDragPark<A> {
  // The parked call's args, or null when clean. A zero-arg runner parks `[]`,
  // which is non-null — the sentinel is the null itself, not arg presence.
  let parked: A | null = null;
  const off = onPaneDragChange((active) => {
    if (active || parked === null) return;
    const args = parked;
    parked = null;
    run(...args);
  });
  return {
    fire: (...args: A) => {
      if (isPaneDragging()) {
        parked = args;
        return;
      }
      run(...args);
    },
    dispose: () => {
      parked = null;
      off();
    },
  };
}
