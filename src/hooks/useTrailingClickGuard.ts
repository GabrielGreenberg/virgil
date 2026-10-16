"use client";

/**
 * # A drag's click suppression never outlives the drag (task 1152)
 *
 * A press that turns into a drag still ends in a `click` when the release lands
 * back on the pressed element — mousedown→move→mouseup synthesizes one — so a
 * draggable control swallows that one trailing click rather than also
 * activating. The two hand-rolled copies of that guard (`MarkerButton`'s re-anchor
 * grab, `PanelCard`'s header lift) cleared their flag in only two places: inside
 * the swallowed click itself, or on the NEXT mousedown. A drag released
 * somewhere else — over the destination paragraph, or after the card had popped
 * out under the pointer — dispatches no click on the element, so the flag stayed
 * armed on the surviving instance, and the next activation that does not begin
 * with a mousedown on it (Enter/Space, a menu row's programmatic `.click()`) was
 * silently eaten once. Mouse users never saw it, because their press re-armed
 * the flag first.
 *
 * The fix is the flag's LIFETIME, not another clear site: arming observes the
 * gesture's own end edge (the next `mouseup`, capture phase on `window`, so no
 * `stopPropagation` beneath can hide it) and disarms on the following task. The
 * browser dispatches the trailing click synchronously after that mouseup, in the
 * same task, so a deferred clear still swallows it — and nothing later can be.
 * The timer and the listener are scheduled through the component's ONE
 * `ViewLifetime` (the timer-lifetime law's React half), so an unmount mid-gesture
 * leaves neither behind.
 */

import { useMemo, useRef } from "react";
import { useViewLifetime } from "@/hooks/useViewLifetime";

export interface TrailingClickGuard {
  /** A fresh press: the click path is open again. Call from mousedown. */
  reset(): void;
  /**
   * The gesture consumed this press: swallow its trailing click — and only
   * that one. Idempotent within a gesture; call it when the drag threshold is
   * crossed.
   */
  arm(): void;
  /**
   * The gesture ended without a mouseup this element can count on (a missed
   * release): disarm on the next task. Harmless when not armed.
   */
  release(): void;
  /** In `onClick`: true — and disarmed — iff this is the swallowed click. */
  consume(): boolean;
  /** Probe for tests, never a gate. */
  readonly armed: boolean;
}

export function useTrailingClickGuard(): TrailingClickGuard {
  const lifetime = useViewLifetime();
  const armedRef = useRef(false);
  /** Removes the live end-edge listener, if one is installed. */
  const detachRef = useRef<(() => void) | null>(null);

  return useMemo<TrailingClickGuard>(() => {
    const detach = () => {
      detachRef.current?.();
      detachRef.current = null;
    };
    const release = () => {
      detach();
      if (!armedRef.current) return;
      lifetime.setTimeout(() => {
        armedRef.current = false;
      }, 0);
    };
    return {
      reset() {
        detach();
        armedRef.current = false;
      },
      arm() {
        if (armedRef.current) return;
        armedRef.current = true;
        if (detachRef.current || lifetime.disposed) return;
        const onUp = () => release();
        window.addEventListener("mouseup", onUp, true);
        const unregister = lifetime.onDispose(() =>
          window.removeEventListener("mouseup", onUp, true),
        );
        detachRef.current = () => {
          window.removeEventListener("mouseup", onUp, true);
          unregister();
        };
      },
      release,
      consume() {
        if (!armedRef.current) return false;
        armedRef.current = false;
        detach();
        return true;
      },
      get armed() {
        return armedRef.current;
      },
    };
  }, [lifetime]);
}
