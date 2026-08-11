"use client";

// The SUPPRESS half of the layout-gesture doctrine (task 317), as a hook.
//
// Two responses to a continuous layout gesture, and the choice is not
// stylistic. A follower whose output nothing user-visible depends on
// mid-gesture PARKS (`parkDuringLayoutGesture`) — it settles once at the end
// and nobody sees the interim. An OPEN, text-anchored overlay cannot: parking
// it leaves a `position:fixed` popup visibly detached from the prose it points
// at, which reads worse than the flicker the parking exists to kill. Those
// SUPPRESS instead — hide for the gesture, restore (recomputed) on the end
// edge. `editor-scrollbar.tsx` has done this for pane drags since the
// LayoutGestureBus landed; this hook is that pattern lifted so the other five
// overlays don't each hand-roll a subscription.
//
// Edge-only, like everything on this bus: renders only on gesture-set edges,
// never one per frame. `useSyncExternalStore` so the value can't tear against
// a concurrent render.
//
// The optional `kinds` filter (perf Wave 2, with the content publisher):
// "suppress only for gestures of these kinds". It subscribes to the SET
// channel and re-reads `hasActiveLayoutGesture(kinds)` per membership change
// — the overlap-sound shape — because a filtered value can flip when an
// inner gesture ends while an outer one of another kind is still live, which
// the outermost-edge channel never reports.

import { useMemo, useSyncExternalStore } from "react";
import {
  hasActiveLayoutGesture,
  isLayoutGestureActive,
  onLayoutGestureSetChange,
  type LayoutGestureKind,
} from "./layout-gesture-bus";

const subscribe = (onStoreChange: () => void): (() => void) =>
  onLayoutGestureSetChange(onStoreChange);

// Server snapshot: no gesture can be in flight during SSR, and returning a
// constant keeps hydration stable.
const getServerSnapshot = (): boolean => false;

/** True while a matching continuous layout gesture is in flight. With no
 *  argument: any kind (pane divider, OS window resize, content drag). With
 *  `kinds`: only those families — e.g. `["pane", "window"]` for a follower
 *  that must stay live during content drags. */
export function useLayoutGestureActive(
  kinds?: readonly LayoutGestureKind[],
): boolean {
  // Key the snapshot closure on the kinds VALUE, not the array identity —
  // call sites pass fresh literals per render.
  const kindsKey = kinds ? kinds.join(",") : null;
  const getSnapshot = useMemo(() => {
    if (kindsKey === null) return isLayoutGestureActive;
    const list = kindsKey.split(",") as LayoutGestureKind[];
    return () => hasActiveLayoutGesture(list);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kindsKey]);
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
