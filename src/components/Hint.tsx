"use client";

/**
 * The ergonomic React surface over the hint attribute protocol. The actual
 * rendering is done once, app-wide, by {@link HintLayer} — these helpers
 * only stamp `data-hint*` attributes onto an element. That keeps hints
 * stateless and free: no per-element listeners, timers, or portals.
 *
 *   const hint = useHint({ label: "Open actions menu", keys: "Mod+/" });
 *   <button {...hint} aria-label="Open actions menu">⚡</button>
 *
 * or, to wrap an existing element without touching its props:
 *
 *   <Hint label="Delete" keys="Backspace"><IconButton …/></Hint>
 *
 * `keys` is a portable shortcut string (see {@link Kbd}); `pos` nudges the
 * preferred placement (default: below, flipping/clamping to fit).
 */

import { cloneElement, useMemo, type ReactElement } from "react";

export type HintPos = "above" | "below" | "left" | "right";

export interface HintOptions {
  /** The tooltip text. */
  label: string;
  /** Optional portable shortcut, e.g. "Mod+/" — rendered as a keycap. */
  keys?: string;
  /** Preferred placement; flips/clamps to stay on-screen. */
  pos?: HintPos;
}

export interface HintAttributes {
  "data-hint": string;
  "data-hint-keys"?: string;
  "data-hint-pos"?: HintPos;
}

/** Returns spreadable `data-hint*` attributes for any element. */
export function useHint({ label, keys, pos }: HintOptions): HintAttributes {
  return useMemo(() => {
    const attrs: HintAttributes = { "data-hint": label };
    if (keys) attrs["data-hint-keys"] = keys;
    if (pos) attrs["data-hint-pos"] = pos;
    return attrs;
  }, [label, keys, pos]);
}

/** Wraps a single child element, injecting the hint attributes onto it. */
export function Hint({
  label,
  keys,
  pos,
  children,
}: HintOptions & { children: ReactElement }): ReactElement {
  const attrs = useHint({ label, keys, pos });
  return cloneElement(children, attrs);
}
