/**
 * `useUnmountEnding` — "the component unmounting is an ENDING of the gesture"
 * (task 1444; the FloatingPanel precedent is task 1095).
 *
 * A press/drag that arms `window` listeners from a React handler ends, by
 * default, only on the gesture's OWN events — mouseup, the missed-release
 * failsafe, a threshold hand-off. None of those fire when the component that
 * armed it goes away mid-press (its block deleted under a held press, the pane
 * swapped, the window closed), so the listeners outlive it: the press visual
 * stays on a detached element, a body cursor stays wedged, and a later stray
 * release acts on something that no longer exists.
 *
 * The returned ref is the one slot for "how the live gesture ends as a
 * CANCEL". A gesture sets it when it arms and clears it (to `null`) in its own
 * end path; the hook's unmount cleanup runs whatever is still there. One live
 * gesture per component is the contract every adopter already has.
 *
 * `src/lib/__tests__/press-teardown-census.test.ts` requires every React file
 * that arms a `window` `mouseup` to adopt this (or to name its non-React
 * teardown in the census's exemption table).
 */

import { useEffect, useRef, type MutableRefObject } from "react";

export function useUnmountEnding(): MutableRefObject<(() => void) | null> {
  const endingRef = useRef<(() => void) | null>(null);
  useEffect(
    () => () => {
      const end = endingRef.current;
      endingRef.current = null;
      end?.();
    },
    [],
  );
  return endingRef;
}
