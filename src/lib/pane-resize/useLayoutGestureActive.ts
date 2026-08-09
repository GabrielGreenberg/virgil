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
// Edge-only, like everything on this bus: exactly two renders per gesture
// (one on begin, one on end), never one per frame. `useSyncExternalStore` so
// the value can't tear against a concurrent render.

import { useSyncExternalStore } from "react";
import {
  isLayoutGestureActive,
  onLayoutGestureChange,
} from "./layout-gesture-bus";

const subscribe = (onStoreChange: () => void): (() => void) =>
  onLayoutGestureChange(onStoreChange);

// Server snapshot: no gesture can be in flight during SSR, and returning a
// constant keeps hydration stable.
const getServerSnapshot = (): boolean => false;

/** True while a pane-divider drag or an OS window resize is in flight. */
export function useLayoutGestureActive(): boolean {
  return useSyncExternalStore(
    subscribe,
    isLayoutGestureActive,
    getServerSnapshot,
  );
}
